// Impacto Ads — biblioteca de materiais no Google Drive
//
// Uma conta Google da agência é conectada uma vez (OAuth). O sistema cria a pasta
// "Impacto Ads — Criativos" e uma subpasta por cliente. O time sobe os materiais pelo painel
// (vão direto para o Drive) ou arrasta para a pasta no próprio Drive; o painel lista tudo
// e envia a mídia para a conta de anúncios do Meta quando for usar.
//
// GET  ?code=...&state=...                      → retorno do Google (conexão)
// POST { action: "status" }                      → conta conectada?
// POST { action: "auth_url", return_to }         → link para conectar a conta Google
// POST { action: "disconnect" }
// POST { action: "ensure_folder", client_id }    → cria (ou devolve) a pasta do cliente
// POST { action: "set_folder", client_id, folder }  → usa uma pasta já existente (link ou id)
// POST { action: "list", client_id }             → lê a pasta e atualiza a biblioteca
// POST { action: "upload_session", client_id, name, mime, size } → link para o navegador enviar o arquivo ao Drive
// POST { action: "send_to_meta", asset_id, ad_account_id }        → envia ao Meta (vídeo grande: chamar de novo até "done")
//
// Segredos: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, META_ACCESS_TOKEN, META_APP_SECRET

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/drive`;
const GOOGLE_ID = (Deno.env.get("GOOGLE_CLIENT_ID") ?? "").trim();
const GOOGLE_SECRET = (Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "").trim();
const SCOPES = "openid email https://www.googleapis.com/auth/drive";
const ROOT_NAME = "Impacto Ads — Criativos";
const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

const API_VERSION = Deno.env.get("META_API_VERSION") ?? "v25.0";
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
const RAW_TOKEN = clean(Deno.env.get("META_ACCESS_TOKEN"));
const RAW_SECRET = clean(Deno.env.get("META_APP_SECRET"));
const SWAPPED = !RAW_TOKEN.startsWith("EAA") && RAW_SECRET.startsWith("EAA");
const META_TOKEN = SWAPPED ? RAW_SECRET : RAW_TOKEN;
const META_SECRET = SWAPPED ? RAW_TOKEN : RAW_SECRET;

const VIDEO_CHUNK_BUDGET_MS = 110_000;   // para antes do limite da função; o painel chama de novo e continua

type Json = Record<string, unknown>;
const nowIso = () => new Date().toISOString();
function encodeBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------- Google ----------------
let cachedToken: { value: string; exp: number } | null = null;

async function googleToken(sb: SupabaseClient): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const { data } = await sb.from("google_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data?.refresh_token) throw new Error("Google Drive não conectado. Conecte em Materiais.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, refresh_token: data.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google: ${j.error_description ?? j.error ?? res.status}. Conecte o Drive de novo em Materiais.`);
  cachedToken = { value: j.access_token, exp: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function drive(sb: SupabaseClient, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await googleToken(sb);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const url = path.startsWith("http") ? path : `${DRIVE}/${path}`;
  return fetch(url, { ...init, headers });
}

async function driveJson(sb: SupabaseClient, path: string, init: RequestInit = {}): Promise<Json> {
  const res = await drive(sb, path, init);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Drive: ${(j as { error?: { message?: string } }).error?.message ?? res.status}`);
  return j as Json;
}

async function createFolder(sb: SupabaseClient, name: string, parent?: string) {
  return await driveJson(sb, "files?supportsAllDrives=true&fields=id,name", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
}

async function folderOk(sb: SupabaseClient, id: string) {
  const res = await drive(sb, `files/${id}?supportsAllDrives=true&fields=id,name,mimeType,trashed`);
  if (!res.ok) return null;
  const f = await res.json();
  return f.mimeType === FOLDER && !f.trashed ? f : null;
}

async function ensureRoot(sb: SupabaseClient) {
  const { data } = await sb.from("google_connection").select("root_folder_id").eq("id", 1).single();
  if (data?.root_folder_id && await folderOk(sb, data.root_folder_id)) return data.root_folder_id as string;
  const f = await createFolder(sb, ROOT_NAME);
  await sb.from("google_connection").update({ root_folder_id: f.id }).eq("id", 1);
  return f.id as string;
}

async function ensureClientFolder(sb: SupabaseClient, clientId: string) {
  const { data: c } = await sb.from("clients").select("id, name, drive_folder_id").eq("id", clientId).single();
  if (!c) throw new Error("Cliente não encontrado");
  if (c.drive_folder_id && await folderOk(sb, c.drive_folder_id)) return c.drive_folder_id as string;
  const root = await ensureRoot(sb);
  const f = await createFolder(sb, c.name, root);
  await sb.from("clients").update({ drive_folder_id: f.id }).eq("id", clientId);
  return f.id as string;
}

const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`;

// ---------------- biblioteca ----------------
const FILE_FIELDS = "id,name,mimeType,size,thumbnailLink,webViewLink,modifiedTime,parents,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)";

async function listFiles(sb: SupabaseClient, q: string) {
  const out: Json[] = [];
  let page = "";
  do {
    const j = await driveJson(sb, `files?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=200&q=${encodeURIComponent(q)}&fields=nextPageToken,files(${FILE_FIELDS})${page ? `&pageToken=${page}` : ""}`);
    out.push(...((j.files as Json[]) ?? []));
    page = (j.nextPageToken as string) ?? "";
  } while (page);
  return out;
}

async function cacheThumb(sb: SupabaseClient, f: Json) {
  const link = f.thumbnailLink as string | undefined;
  if (!link) return null;
  const path = `${f.id}-${new Date(f.modifiedTime as string).getTime()}.jpg`;
  const res = await drive(sb, link.replace(/=s\d+$/, "=s480"));
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { error } = await sb.storage.from("creative-thumbs").upload(path, bytes, { contentType: res.headers.get("content-type") ?? "image/jpeg", upsert: true });
  if (error) return null;
  return sb.storage.from("creative-thumbs").getPublicUrl(path).data.publicUrl;
}

async function syncLibrary(sb: SupabaseClient, clientId: string) {
  const folder = await ensureClientFolder(sb, clientId);
  // A pasta do cliente e as subpastas dela (ex.: "Outubro", "Vídeos")
  const subs = await listFiles(sb, `'${folder}' in parents and mimeType='${FOLDER}' and trashed=false`);
  const folderName = new Map<string, string>([[folder, ""], ...subs.map((s) => [s.id as string, s.name as string] as [string, string])]);
  const parents = [...folderName.keys()];
  const files: Json[] = [];
  for (let i = 0; i < parents.length; i += 20) {
    const group = parents.slice(i, i + 20).map((p) => `'${p}' in parents`).join(" or ");
    files.push(...await listFiles(sb, `(${group}) and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')`));
  }

  const { data: existing } = await sb.from("creative_assets").select("id, drive_file_id, drive_modified_at, thumbnail_url").eq("client_id", clientId);
  const byFile = new Map((existing ?? []).map((e) => [e.drive_file_id as string, e]));

  // Miniaturas: só de arquivos novos ou alterados (até 30 por vez, 4 em paralelo)
  const needThumb = files.filter((f) => {
    const e = byFile.get(f.id as string);
    return !e || !e.thumbnail_url || new Date(e.drive_modified_at as string).getTime() !== new Date(f.modifiedTime as string).getTime();
  }).slice(0, 30);
  const thumbs = new Map<string, string | null>();
  for (let i = 0; i < needThumb.length; i += 4) {
    const batch = needThumb.slice(i, i + 4);
    const urls = await Promise.all(batch.map((f) => cacheThumb(sb, f).catch(() => null)));
    batch.forEach((f, j) => thumbs.set(f.id as string, urls[j]));
  }

  const rows = files.map((f) => {
    const img = (f.imageMediaMetadata as Json | undefined) ?? {};
    const vid = (f.videoMediaMetadata as Json | undefined) ?? {};
    const parent = ((f.parents as string[] | undefined) ?? [])[0] ?? folder;
    return {
      client_id: clientId, drive_file_id: f.id, name: f.name, mime_type: f.mimeType,
      kind: String(f.mimeType).startsWith("video/") ? "video" : "image",
      size_bytes: f.size ? Number(f.size) : null,
      width: (img.width ?? vid.width ?? null) as number | null, height: (img.height ?? vid.height ?? null) as number | null,
      duration_ms: vid.durationMillis ? Number(vid.durationMillis) : null,
      thumbnail_url: thumbs.has(f.id as string) ? thumbs.get(f.id as string) : byFile.get(f.id as string)?.thumbnail_url ?? null,
      web_view_link: f.webViewLink, folder_name: folderName.get(parent) || null,
      drive_modified_at: f.modifiedTime, removed: false, updated_at: nowIso(),
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("creative_assets").upsert(rows.slice(i, i + 200), { onConflict: "drive_file_id" });
    if (error) throw new Error(error.message);
  }
  const present = new Set(files.map((f) => f.id as string));
  const gone = (existing ?? []).filter((e) => !present.has(e.drive_file_id as string)).map((e) => e.id);
  if (gone.length) await sb.from("creative_assets").update({ removed: true }).in("id", gone);

  return { folder_id: folder, folder_link: folderLink(folder), files: files.length, thumbnails_pending: Math.max(0, files.length - rows.filter((r) => r.thumbnail_url).length) };
}

// ---------------- Meta ----------------
let proof = "";
async function metaProof() {
  if (!META_SECRET) return "";
  if (proof) return proof;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(META_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(META_TOKEN));
  proof = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return proof;
}

async function metaPost(host: "graph" | "graph-video", path: string, form: FormData): Promise<Json> {
  form.set("access_token", META_TOKEN);
  const p = await metaProof();
  if (p) form.set("appsecret_proof", p);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${host}.facebook.com/${API_VERSION}/${path}`, { method: "POST", body: form });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j as Json;
    const err = (j as { error?: { message?: string; error_user_msg?: string; code?: number; is_transient?: boolean } }).error ?? {};
    if ((err.is_transient || [1, 2, 4, 17, 32, 613].includes(err.code ?? 0)) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue;
    }
    throw new Error(`Meta (${err.code ?? res.status}): ${err.error_user_msg ?? err.message ?? res.statusText}`);
  }
}

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

async function sendToMeta(sb: SupabaseClient, assetId: string, act: string) {
  const { data: asset } = await sb.from("creative_assets").select("*").eq("id", assetId).single();
  if (!asset) throw new Error("Material não encontrado");
  const { data: acc } = await sb.from("ad_accounts").select("id").eq("id", act).eq("client_id", asset.client_id).maybeSingle();
  if (!acc) throw new Error("Esta conta de anúncios não pertence ao cliente do material.");
  const meta = (asset.meta as Json) ?? {};
  const cur = (meta[act] as Json | undefined) ?? {};
  if (cur.image_hash || (cur.video_id && !cur.upload)) return { done: true, ...cur };

  const save = async (v: Json) => {
    // relê para não sobrescrever envios a outras contas feitos ao mesmo tempo
    const { data: fresh } = await sb.from("creative_assets").select("meta").eq("id", assetId).single();
    await sb.from("creative_assets").update({ meta: { ...((fresh?.meta as Json) ?? {}), [act]: v }, updated_at: nowIso() }).eq("id", assetId);
  };

  if (asset.kind === "image") {
    const res = await drive(sb, `files/${asset.drive_file_id}?alt=media&supportsAllDrives=true`);
    if (!res.ok) throw new Error(`Google Drive: não foi possível baixar o arquivo (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const j = await metaPost("graph", `${act}/adimages`, fd({ bytes: encodeBase64(bytes), name: asset.name }));
    const img = Object.values((j.images as Record<string, Json>) ?? {})[0] ?? {};
    if (!img.hash) throw new Error("O Meta não devolveu o código da imagem.");
    const v = { image_hash: img.hash, url: img.url ?? null, sent_at: nowIso() };
    await save(v);
    return { done: true, ...v };
  }

  // Vídeo: envio em partes (retoma de onde parou se a função atingir o limite de tempo)
  const started = Date.now();
  let up = (cur.upload as Json | undefined) ?? null;
  if (!up) {
    if (!asset.size_bytes) throw new Error("Tamanho do vídeo desconhecido no Drive.");
    const s = await metaPost("graph-video", `${act}/advideos`, fd({ upload_phase: "start", file_size: String(asset.size_bytes) }));
    up = { session: s.upload_session_id, video_id: s.video_id, start: Number(s.start_offset), end: Number(s.end_offset) };
  }
  while (Number(up.start) < Number(up.end)) {
    if (Date.now() - started > VIDEO_CHUNK_BUDGET_MS) {
      await save({ video_id: up.video_id, upload: up });
      return { done: false, progress: Number(up.start) / Number(asset.size_bytes) };
    }
    const res = await drive(sb, `files/${asset.drive_file_id}?alt=media&supportsAllDrives=true`, {
      headers: { range: `bytes=${up.start}-${Number(up.end) - 1}` },
    });
    if (!res.ok && res.status !== 206) throw new Error(`Google Drive: falha ao ler o vídeo (${res.status})`);
    const chunk = await res.blob();
    const form = fd({ upload_phase: "transfer", upload_session_id: String(up.session), start_offset: String(up.start) });
    form.set("video_file_chunk", chunk, "chunk");
    const t = await metaPost("graph-video", `${act}/advideos`, form);
    up = { ...up, start: Number(t.start_offset), end: Number(t.end_offset) };
  }
  await metaPost("graph-video", `${act}/advideos`, fd({ upload_phase: "finish", upload_session_id: String(up.session), title: asset.name }));
  const v = { video_id: up.video_id, sent_at: nowIso() };
  await save(v);
  return { done: true, ...v };
}

// ---------------- handler ----------------
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ----- retorno do Google -----
  if (req.method === "GET") {
    const u = new URL(req.url);
    const state = u.searchParams.get("state") ?? "";
    const { data: st } = await sb.from("oauth_states").select("*").eq("state", state).maybeSingle();
    if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60_000) return new Response("Link expirado. Volte ao painel e clique em Conectar de novo.", { status: 400 });
    await sb.from("oauth_states").delete().eq("state", state);
    const back = (q: string) => redirect(`${st.return_to}${st.return_to.includes("?") ? "&" : "?"}${q}`);
    const code = u.searchParams.get("code");
    if (!code) return back(`drive=erro&motivo=${encodeURIComponent(u.searchParams.get("error") ?? "cancelado")}`);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ code, client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
    });
    const tok = await res.json();
    if (!res.ok || !tok.refresh_token) return back(`drive=erro&motivo=${encodeURIComponent(tok.error_description ?? tok.error ?? "sem refresh token")}`);
    const info = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
    await sb.from("google_connection").upsert({ id: 1, email: info.email ?? null, refresh_token: tok.refresh_token, connected_at: nowIso(), connected_by: st.email, root_folder_id: null });
    cachedToken = { value: tok.access_token, exp: Date.now() + Number(tok.expires_in ?? 3600) * 1000 };
    await ensureRoot(sb).catch(() => null);
    return back("drive=ok");
  }

  // ----- painel: só equipe -----
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: auth } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
  if (!auth.user) return reply({ error: "não autorizado" }, 401);
  const email = (auth.user.email ?? "").toLowerCase();
  const { data: member } = await sb.from("team_members").select("email").eq("email", email).maybeSingle();
  if (!member) return reply({ error: "Este e-mail não faz parte da equipe Impacto" }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    if (!GOOGLE_ID || !GOOGLE_SECRET) {
      if (body.action === "status") return reply({ configured: false, connected: false });
      return reply({ error: "Faltam os segredos GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no Supabase." }, 500);
    }
    switch (body.action) {
      case "status": {
        const { data } = await sb.from("google_connection").select("email, connected_at, root_folder_id, refresh_token").eq("id", 1).maybeSingle();
        return reply({ configured: true, connected: !!data?.refresh_token, email: data?.email ?? null, connected_at: data?.connected_at ?? null,
          root_link: data?.root_folder_id ? folderLink(data.root_folder_id) : null });
      }
      case "auth_url": {
        const back = String(body.return_to ?? "");
        if (!/^https:\/\/|^http:\/\/localhost/.test(back)) return reply({ error: "endereço de retorno inválido" }, 400);
        const state = crypto.randomUUID();
        await sb.from("oauth_states").insert({ state, email, return_to: back });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        for (const [k, v] of Object.entries({ client_id: GOOGLE_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPES,
          access_type: "offline", prompt: "consent", include_granted_scopes: "true", state })) url.searchParams.set(k, v);
        return reply({ url: url.toString() });
      }
      case "disconnect":
        await sb.from("google_connection").update({ refresh_token: null, connected_at: null }).eq("id", 1);
        cachedToken = null;
        return reply({ ok: true });
      case "ensure_folder": {
        const id = await ensureClientFolder(sb, body.client_id);
        return reply({ folder_id: id, folder_link: folderLink(id) });
      }
      case "set_folder": {
        const raw = String(body.folder ?? "");
        const id = raw.match(/folders\/([\w-]{10,})/)?.[1] ?? raw.match(/[?&]id=([\w-]{10,})/)?.[1] ?? (/^[\w-]{10,}$/.test(raw) ? raw : null);
        if (!id) return reply({ error: "Cole o link de uma pasta do Google Drive." }, 400);
        const f = await folderOk(sb, id);
        if (!f) return reply({ error: "Pasta não encontrada ou sem acesso pela conta conectada." }, 400);
        await sb.from("clients").update({ drive_folder_id: id }).eq("id", body.client_id);
        return reply({ folder_id: id, folder_link: folderLink(id), name: f.name });
      }
      case "list":
        return reply(await syncLibrary(sb, body.client_id));
      case "upload_session": {
        const folder = await ensureClientFolder(sb, body.client_id);
        const origin = req.headers.get("origin") ?? "";
        const res = await drive(sb, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=UTF-8",
            "x-upload-content-type": String(body.mime || "application/octet-stream"),
            ...(body.size ? { "x-upload-content-length": String(body.size) } : {}),
            ...(origin ? { origin } : {}),   // permite ao navegador enviar o arquivo direto ao Google
          },
          body: JSON.stringify({ name: String(body.name ?? "material"), parents: [folder] }),
        });
        if (!res.ok) throw new Error(`Google Drive: ${(await res.text()).slice(0, 200)}`);
        return reply({ upload_url: res.headers.get("location") });
      }
      case "send_to_meta":
        return reply(await sendToMeta(sb, body.asset_id, body.ad_account_id));
      default:
        return reply({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
