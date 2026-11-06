// Impacto Ads — entrada de criativos sem Google Drive
//
// Ações (POST, JSON; só equipe logada ou cron):
//   { action: "register_upload", client_id, path, name, mime, size, thumb_path? } → arquivo já enviado ao Storage (bucket creative-uploads)
//   { action: "from_instagram", client_id, url }                                → acha o post/reels no Instagram do cliente e cadastra
//   { action: "send_to_meta", asset_id, ad_account_id }                         → leva o material para a conta de anúncios
//   { action: "remove", asset_id }                                              → tira o material da biblioteca
//   { action: "ig_check", client_id? }                                          → diagnóstico: contas de Instagram e permissão de leitura

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const API_VERSION = Deno.env.get("META_API_VERSION") ?? "v25.0";
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
const RAW_TOKEN = clean(Deno.env.get("META_ACCESS_TOKEN"));
const RAW_SECRET = clean(Deno.env.get("META_APP_SECRET"));
const SWAPPED = !RAW_TOKEN.startsWith("EAA") && RAW_SECRET.startsWith("EAA");
const TOKEN = SWAPPED ? RAW_SECRET : RAW_TOKEN;
const APP_SECRET = SWAPPED ? RAW_TOKEN : RAW_SECRET;
const BUCKET = "creative-uploads";

type Json = Record<string, unknown>;
const nowIso = () => new Date().toISOString();

// ---------------- Meta ----------------
let proof = "";
async function appSecretProof() {
  if (!APP_SECRET) return "";
  if (proof) return proof;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(TOKEN));
  proof = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return proof;
}

class MetaError extends Error { constructor(msg: string, public code: number) { super(msg); } }

async function graph(path: string, params: Record<string, string> = {}, method: "GET" | "POST" = "GET", host = "graph"): Promise<Json> {
  const body = new URLSearchParams(params);
  body.set("access_token", TOKEN);
  const p = await appSecretProof();
  if (p) body.set("appsecret_proof", p);
  const url = `https://${host}.facebook.com/${API_VERSION}/${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = method === "GET" ? await fetch(`${url}?${body}`) : await fetch(url, { method: "POST", body });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j as Json;
    const err = (j as { error?: { message?: string; error_user_msg?: string; code?: number; is_transient?: boolean } }).error ?? {};
    if ((err.is_transient || [1, 2, 4, 17, 32, 613].includes(err.code ?? 0)) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue;
    }
    throw new MetaError(`Meta (${err.code ?? res.status}): ${err.error_user_msg ?? err.message ?? res.statusText}`, err.code ?? res.status);
  }
}

// ---------------- Instagram ----------------
// O link do post traz o "shortcode" (instagram.com/p/XXXX ou /reel/XXXX). A API não busca por shortcode,
// então listamos os posts recentes das contas de Instagram usadas nos anúncios do cliente e comparamos.
function shortcodeOf(url: string) {
  return url.match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]{5,})/i)?.[1] ?? null;
}

async function igAccountsOf(sb: SupabaseClient, clientId: string) {
  const { data: accs } = await sb.from("ad_accounts").select("id").eq("client_id", clientId);
  const found = new Map<string, { id: string; username?: string; act: string; page_id?: string }>();
  for (const a of accs ?? []) {
    try {
      const r = await graph(`${a.id}/adcreatives`, { fields: "instagram_user_id,actor_id,object_story_spec{page_id,instagram_user_id,instagram_actor_id}", limit: "60" });
      for (const c of (r.data as Json[]) ?? []) {
        const oss = (c.object_story_spec as Json) ?? {};
        const ig = (c.instagram_user_id ?? oss.instagram_user_id ?? oss.instagram_actor_id) as string | undefined;
        const page = (oss.page_id ?? c.actor_id) as string | undefined;
        if (ig && !found.has(ig)) found.set(ig, { id: ig, act: a.id, page_id: page });
        else if (ig && page && !found.get(ig)!.page_id) found.get(ig)!.page_id = page;
      }
    } catch { /* conta sem permissão: ignora */ }
  }
  return [...found.values()];
}

const MEDIA_FIELDS = "id,shortcode,permalink,media_type,media_product_type,media_url,thumbnail_url,caption,timestamp";

async function findMedia(igId: string, code: string) {
  let after = "";
  for (let page = 0; page < 6; page++) {
    const r = await graph(`${igId}/media`, { fields: MEDIA_FIELDS, limit: "50", ...(after ? { after } : {}) });
    for (const m of (r.data as Json[]) ?? []) {
      if (m.shortcode === code || String(m.permalink ?? "").includes(`/${code}`)) return m;
    }
    after = (((r.paging as Json)?.cursors as Json)?.after as string) ?? "";
    if (!after || !((r.paging as Json)?.next)) break;
  }
  return null;
}

async function cacheThumb(sb: SupabaseClient, url: string, key: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `ig/${key}.jpg`;
    const { error } = await sb.storage.from("creative-thumbs").upload(path, bytes, { contentType: res.headers.get("content-type") ?? "image/jpeg", upsert: true });
    if (error) return null;
    return sb.storage.from("creative-thumbs").getPublicUrl(path).data.publicUrl;
  } catch { return null; }
}

async function fromInstagram(sb: SupabaseClient, clientId: string, url: string, who: string) {
  const code = shortcodeOf(url);
  if (!code) throw new Error("Esse não parece um link de post ou reels do Instagram. Exemplo: https://www.instagram.com/p/ABC123/");
  const accounts = await igAccountsOf(sb, clientId);
  if (!accounts.length) throw new Error("Não encontrei o Instagram deste cliente nos anúncios. O cliente precisa ter ao menos um anúncio rodando com o Instagram dele.");
  let media: Json | null = null, owner: (typeof accounts)[number] | null = null;
  const denied: string[] = [];
  for (const acc of accounts) {
    try {
      media = await findMedia(acc.id, code);
      if (media) { owner = acc; break; }
    } catch (e) {
      if (e instanceof MetaError) denied.push(e.message); else throw e;
    }
  }
  if (!media || !owner) {
    if (denied.length === accounts.length) {
      throw new Error("O Meta não liberou a leitura dos posts do Instagram para o sistema (falta a permissão instagram_basic no app). Enquanto isso, use \"Enviar arquivo\": baixe o vídeo/imagem e arraste aqui.");
    }
    throw new Error("Não achei esse post entre os últimos 300 do Instagram ligado aos anúncios deste cliente. Confira se o post é do perfil do cliente.");
  }
  const isVideo = media.media_type === "VIDEO" || media.media_product_type === "REELS";
  const thumb = await cacheThumb(sb, String(media.thumbnail_url ?? media.media_url ?? ""), String(media.id));
  const name = `Instagram ${media.media_product_type === "REELS" ? "reels" : "post"} — ${String(media.caption ?? code).replace(/\s+/g, " ").slice(0, 60)}`;
  const row = {
    client_id: clientId, source: "instagram", name, kind: isVideo ? "video" : "image", mime_type: null,
    thumbnail_url: thumb, web_view_link: String(media.permalink ?? url), ig_media_id: String(media.id), ig_user_id: owner.id,
    caption: (media.caption as string) ?? null, created_by: who, folder_name: "Instagram",
    meta: { [owner.act]: { ig_media_id: media.id, ig_user_id: owner.id, page_id: owner.page_id ?? null, sent_at: nowIso() } },
  };
  const { data: existing } = await sb.from("creative_assets").select("id").eq("client_id", clientId).eq("ig_media_id", String(media.id)).maybeSingle();
  const q = existing
    ? sb.from("creative_assets").update({ ...row, removed: false, updated_at: nowIso() }).eq("id", existing.id).select("*").single()
    : sb.from("creative_assets").insert(row).select("*").single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

// ---------------- upload direto ----------------
async function registerUpload(sb: SupabaseClient, b: Json, who: string) {
  const path = String(b.path ?? "");
  if (!path.startsWith(`${b.client_id}/`)) throw new Error("Caminho do arquivo inválido.");
  const mime = String(b.mime ?? "");
  const kind = mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : null;
  if (!kind) throw new Error("Envie uma imagem (JPG/PNG) ou um vídeo (MP4/MOV).");
  const thumb = b.thumb_path ? sb.storage.from("creative-thumbs").getPublicUrl(String(b.thumb_path)).data.publicUrl : null;
  const { data, error } = await sb.from("creative_assets").insert({
    client_id: b.client_id, source: "upload", storage_path: path, name: String(b.name ?? "material"), mime_type: mime, kind,
    size_bytes: Number(b.size ?? 0) || null, width: Number(b.width ?? 0) || null, height: Number(b.height ?? 0) || null,
    duration_ms: Number(b.duration_ms ?? 0) || null, thumbnail_url: thumb, created_by: who, folder_name: "Enviados no painel",
    drive_modified_at: nowIso(),
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

async function sendToMeta(sb: SupabaseClient, assetId: string, act: string) {
  const { data: asset } = await sb.from("creative_assets").select("*").eq("id", assetId).single();
  if (!asset) throw new Error("Material não encontrado");
  const { data: acc } = await sb.from("ad_accounts").select("id").eq("id", act).eq("client_id", asset.client_id).maybeSingle();
  if (!acc) throw new Error("Esta conta de anúncios não pertence ao cliente do material.");
  const meta = (asset.meta as Json) ?? {};
  const cur = (meta[act] as Json | undefined) ?? {};
  const save = async (v: Json) => {
    const { data: fresh } = await sb.from("creative_assets").select("meta").eq("id", assetId).single();
    await sb.from("creative_assets").update({ meta: { ...((fresh?.meta as Json) ?? {}), [act]: v }, updated_at: nowIso() }).eq("id", assetId);
  };

  if (asset.source === "instagram") {
    if (cur.ig_media_id) return { done: true, ...cur };
    // mesmo post em outra conta de anúncios do cliente: vale o mesmo Instagram
    const any = Object.values(meta).find((v) => (v as Json)?.ig_media_id) as Json | undefined;
    if (!any) throw new Error("Post do Instagram sem identificação. Cole o link de novo.");
    await save({ ...any, sent_at: nowIso() });
    return { done: true, ...any };
  }
  if (asset.source !== "upload") throw new Error("Material do Drive: use o envio pela biblioteca do Drive.");
  if (cur.image_hash || cur.video_id) return { done: true, ...cur };

  if (asset.kind === "image") {
    const { data: file, error } = await sb.storage.from(BUCKET).download(asset.storage_path);
    if (error || !file) throw new Error("Não foi possível ler o arquivo enviado.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const j = await graph(`${act}/adimages`, { bytes: encodeBase64(bytes), name: asset.name }, "POST");
    const img = Object.values((j.images as Record<string, Json>) ?? {})[0] ?? {};
    if (!img.hash) throw new Error("O Meta não devolveu o código da imagem.");
    const v = { image_hash: img.hash, url: img.url ?? null, sent_at: nowIso() };
    await save(v);
    return { done: true, ...v };
  }
  // vídeo: o Meta baixa direto do Storage por um link temporário
  const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(asset.storage_path, 6 * 3600);
  if (error || !signed) throw new Error("Não foi possível gerar o link do vídeo.");
  const j = await graph(`${act}/advideos`, { file_url: signed.signedUrl, name: asset.name, title: asset.name }, "POST", "graph-video");
  if (!j.id) throw new Error("O Meta não devolveu o código do vídeo.");
  const v = { video_id: j.id, sent_at: nowIso() };
  await save(v);
  return { done: true, ...v };
}

// ---------------- handler ----------------
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let who = "sistema";
  const cronHeader = req.headers.get("x-cron-secret");
  const { data: cronOk } = cronHeader ? await sb.rpc("check_cron_secret", { s: cronHeader }) : { data: false };
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const internal = jwt && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");   // chamada do piloto automático
  if (internal) who = "piloto automático";
  else if (!cronOk) {
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!data.user) return reply({ error: "não autorizado" }, 401);
    const { data: member } = await sb.from("team_members").select("email").eq("email", (data.user.email ?? "").toLowerCase()).maybeSingle();
    if (!member) return reply({ error: "Este e-mail não faz parte da equipe Impacto" }, 403);
    who = data.user.email ?? data.user.id;
  }
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "register_upload": return reply(await registerUpload(sb, b, who));
      case "from_instagram": return reply(await fromInstagram(sb, String(b.client_id), String(b.url ?? ""), who));
      case "send_to_meta": return reply(await sendToMeta(sb, String(b.asset_id), String(b.ad_account_id)));
      case "remove": {
        await sb.from("creative_assets").update({ removed: true, updated_at: nowIso() }).eq("id", b.asset_id);
        return reply({ ok: true });
      }
      case "ig_check": {
        const { data: clients } = b.client_id
          ? await sb.from("clients").select("id, name").eq("id", b.client_id)
          : await sb.from("clients").select("id, name").eq("active", true);
        const out: Json[] = [];
        for (const c of clients ?? []) {
          const accs = await igAccountsOf(sb, c.id);
          const tests: Json[] = [];
          for (const a of accs.slice(0, 2)) {
            try {
              const r = await graph(`${a.id}/media`, { fields: "id,shortcode,permalink", limit: "3" });
              tests.push({ ig: a.id, ok: true, sample: ((r.data as Json[]) ?? []).map((m) => m.permalink) });
            } catch (e) { tests.push({ ig: a.id, ok: false, error: e instanceof Error ? e.message : String(e) }); }
          }
          out.push({ client: c.name, accounts: accs.length, tests });
        }
        return reply({ results: out });
      }
      default: return reply({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
