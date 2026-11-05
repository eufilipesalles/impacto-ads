import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAccounts, getClients } from "../lib/api";
import { useAsync } from "../lib/hooks";
import {
  createAdFromAsset, driveConnect, driveDisconnect, driveStatus, getClientAdsets, getLibrary, sendToMeta, setClientFolder, uploadToDrive,
  type AdsetOption, type CreativeAsset,
} from "../lib/autopilot";
import type { AdAccount } from "../lib/types";

const size = (b: number | null) => (b === null ? "" : b >= 1e6 ? `${(b / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.round(b / 1e3)} KB`);
const ratio = (w: number | null, h: number | null) => {
  if (!w || !h) return "";
  const r = w / h;
  return Math.abs(r - 9 / 16) < 0.03 ? "9:16" : Math.abs(r - 4 / 5) < 0.03 ? "4:5" : Math.abs(r - 1) < 0.03 ? "1:1" : Math.abs(r - 16 / 9) < 0.03 ? "16:9" : `${w}×${h}`;
};
const secs = (ms: number | null) => (ms ? `${Math.round(ms / 1000)} s` : "");

function CreateAdDialog({ asset, clientId, accounts, onClose, onDone }: {
  asset: CreativeAsset; clientId: string; accounts: AdAccount[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const adsets = useAsync(() => getClientAdsets(clientId), [clientId]);
  const [adsetId, setAdsetId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState(asset.name.replace(/\.[a-z0-9]+$/i, ""));
  const [message, setMessage] = useState("");
  const [activate, setActivate] = useState(true);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = adsets.data ?? [];
  const adset: AdsetOption | undefined = list.find((s) => s.id === adsetId) ?? list[0];
  useEffect(() => { if (adset && !adsetId) setAdsetId(adset.id); }, [adset, adsetId]);
  useEffect(() => { if (adset) setTemplateId(adset.ads[0]?.id ?? ""); }, [adset]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  async function submit() {
    if (!adset || !templateId) return;
    setErr(null);
    try {
      if (!asset.meta[adset.ad_account_id]?.image_hash && !(asset.meta[adset.ad_account_id]?.video_id && !asset.meta[adset.ad_account_id]?.upload)) {
        setStep("Enviando o material ao Meta…");
        await sendToMeta(asset.id, adset.ad_account_id, (p) => setStep(`Enviando o vídeo ao Meta… ${Math.round(p * 100)}%`));
      }
      setStep("Criando o anúncio…");
      await createAdFromAsset({ client_id: clientId, ad_account_id: adset.ad_account_id, adset_id: adset.id, template_ad_id: templateId,
        asset_id: asset.id, name: name.trim() || undefined, activate, message: message.trim() || undefined });
      onDone(activate ? "Anúncio criado e ativado. O Meta vai revisar antes de veicular." : "Anúncio criado pausado.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStep(null); }
  }

  return (
    <div className="drawer-wrap center" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Criar anúncio" onClick={(e) => e.stopPropagation()}>
        <div className="nc-head"><h2>Criar anúncio com este material</h2><button className="dr-close dark" onClick={onClose} aria-label="Fechar">×</button></div>
        <p className="help">O anúncio novo usa a página, o Instagram, o texto e o botão de um anúncio que já existe no conjunto, trocando só a mídia por <b>{asset.name}</b>.</p>
        {adsets.loading && <p className="muted">Carregando conjuntos…</p>}
        {!adsets.loading && list.length === 0 && <p className="err-text">Nenhum conjunto com anúncios neste cliente. Crie a primeira campanha no Gerenciador.</p>}
        {list.length > 0 && (
          <div className="modal-grid">
            <div className="field span-3">
              <label htmlFor="ad-set">Conjunto de anúncios</label>
              <select id="ad-set" className="select" value={adset?.id ?? ""} onChange={(e) => setAdsetId(e.target.value)}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.effective_status === "ACTIVE" ? "● " : "○ "}{s.campaign_name} › {s.name}{accounts.length > 1 ? ` (${s.ad_account_id})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field span-3">
              <label htmlFor="ad-tpl">Anúncio modelo (texto e botão)</label>
              <select id="ad-tpl" className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {adset?.ads.map((a) => <option key={a.id} value={a.id}>{a.effective_status === "ACTIVE" ? "● " : "○ "}{a.name}</option>)}
              </select>
            </div>
            <div className="field span-3">
              <label htmlFor="ad-name">Nome do anúncio</label>
              <input id="ad-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field span-3">
              <label htmlFor="ad-msg">Texto principal <span className="opt">opcional — vazio usa o do modelo</span></label>
              <textarea id="ad-msg" className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
            <label className="switch span-3"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Ativar o anúncio ao criar</label>
          </div>
        )}
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="nc-foot">
          <p className="help">{step ?? "Fica registrado no histórico do Piloto automático, onde pode ser desfeito."}</p>
          <button className="btn primary" onClick={submit} disabled={!!step || !adset || !templateId}>{step ? "Aguarde…" : "Criar anúncio"}</button>
        </div>
      </div>
    </div>
  );
}

export function MaterialsPage() {
  const [params, setParams] = useSearchParams();
  const clientId = params.get("cliente") ?? "";
  const clients = useAsync(getClients, []);
  const accounts = useAsync(getAccounts, []);
  const status = useAsync(driveStatus, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const lib = useAsync(() => (clientId && status.data?.connected ? getLibrary(clientId, true) : Promise.resolve(null)), [clientId, status.data?.connected, refreshKey]);
  const [toast, setToast] = useState<string | null>(null);
  const [uploads, setUploads] = useState<{ name: string; p: number; err?: string }[]>([]);
  const [sending, setSending] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<CreativeAsset | null>(null);
  const [folderInput, setFolderInput] = useState<string | null>(null);
  const [kind, setKind] = useState<"todos" | "image" | "video">("todos");
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };
  const accs = (accounts.data ?? []).filter((a) => a.client_id === clientId && !a.last_sync_error);

  // Volta da conexão com o Google
  useEffect(() => {
    const d = params.get("drive");
    if (!d) return;
    flash(d === "ok" ? "Google Drive conectado." : `Não foi possível conectar: ${params.get("motivo") ?? "erro"}`);
    const p = new URLSearchParams(params); p.delete("drive"); p.delete("motivo"); setParams(p, { replace: true });
    status.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files?.length || !clientId) return;
    const list = [...files].filter((f) => /^(image|video)\//.test(f.type));
    if (list.length < files.length) flash("Só imagens e vídeos são enviados.");
    setUploads(list.map((f) => ({ name: f.name, p: 0 })));
    for (let i = 0; i < list.length; i++) {
      try { await uploadToDrive(clientId, list[i], (p) => setUploads((u) => u.map((x, j) => (j === i ? { ...x, p } : x)))); }
      catch (e) { setUploads((u) => u.map((x, j) => (j === i ? { ...x, err: e instanceof Error ? e.message : String(e) } : x))); }
    }
    setRefreshKey((k) => k + 1);
    setTimeout(() => setUploads((u) => u.filter((x) => x.err)), 2500);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send(a: CreativeAsset, acc: string) {
    setSending((s) => ({ ...s, [a.id]: "Enviando…" }));
    try {
      await sendToMeta(a.id, acc, (p) => setSending((s) => ({ ...s, [a.id]: `${Math.round(p * 100)}%` })));
      flash(`"${a.name}" está na biblioteca de mídia do Meta.`);
      setRefreshKey((k) => k + 1);
    } catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setSending((s) => { const n = { ...s }; delete n[a.id]; return n; }); }
  }

  async function saveFolder() {
    if (!folderInput?.trim()) return;
    try { const r = await setClientFolder(clientId, folderInput.trim()); flash(`Usando a pasta "${r.name ?? "do Drive"}".`); setFolderInput(null); setRefreshKey((k) => k + 1); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
  }

  const st = status.data;
  const assets = (lib.data?.assets ?? []).filter((a) => kind === "todos" || a.kind === kind);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Biblioteca de criativos</p>
          <h1>Materiais</h1>
          <p className="sub">Uma pasta no Google Drive por cliente. O que entra na pasta aparece aqui e vai para o Meta em um clique.</p>
        </div>
        <div className="head-actions">
          <select className="select" value={clientId} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set("cliente", e.target.value); else p.delete("cliente"); setParams(p, { replace: true }); }} aria-label="Cliente">
            <option value="">Escolha o cliente</option>
            {(clients.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </header>

      <section className="card drive-bar">
        <span className={`drive-dot ${st?.connected ? "on" : ""}`} />
        {status.loading ? <span className="muted">Verificando o Google Drive…</span>
          : !st?.configured ? <span>Google Drive ainda não configurado no servidor (faltam as credenciais do Google).</span>
          : !st.connected ? (<><span>Google Drive não conectado.</span><button className="btn primary small" onClick={() => driveConnect().catch((e) => flash(e.message))}>Conectar Google Drive</button></>)
          : (<>
              <span>Conectado como <b>{st.email}</b></span>
              {st.root_link && <a className="hint" href={st.root_link} target="_blank" rel="noreferrer">pasta principal ↗</a>}
              <button className="link-btn" onClick={async () => { if (confirm("Desconectar o Google Drive?")) { await driveDisconnect(); status.reload(); } }}>desconectar</button>
            </>)}
      </section>

      {st?.connected && !clientId && <div className="card empty" style={{ marginTop: 16 }}>Escolha um cliente para ver a pasta de materiais dele.</div>}

      {st?.connected && clientId && (
        <section className="section">
          <div className="mat-toolbar">
            <div className="chips">
              {(["todos", "video", "image"] as const).map((k) => (
                <button key={k} className={`chip ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k === "todos" ? "Todos" : k === "video" ? "Vídeos" : "Imagens"}
                </button>
              ))}
            </div>
            <div className="cr-tools">
              {lib.data?.folder_link && <a className="btn small" href={lib.data.folder_link} target="_blank" rel="noreferrer">Abrir pasta no Drive ↗</a>}
              <button className="btn small" onClick={() => setFolderInput(folderInput === null ? "" : null)}>Usar outra pasta</button>
              <button className="btn small" onClick={() => setRefreshKey((k) => k + 1)} disabled={lib.loading}>{lib.loading ? "Lendo o Drive…" : "Atualizar"}</button>
              <button className="btn small primary" onClick={() => fileRef.current?.click()}>Enviar arquivos</button>
              <input ref={fileRef} type="file" multiple accept="image/*,video/*" hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
          </div>

          {folderInput !== null && (
            <div className="card folder-set">
              <label className="field-label" htmlFor="folder-link">Link de uma pasta do Drive (o cliente passa a usar essa pasta)</label>
              <div className="dates">
                <input id="folder-link" className="input" placeholder="https://drive.google.com/drive/folders/…" value={folderInput} onChange={(e) => setFolderInput(e.target.value)} />
                <button className="btn small primary" onClick={saveFolder}>Usar</button>
              </div>
            </div>
          )}

          {uploads.length > 0 && (
            <div className="card uploads">
              {uploads.map((u, i) => (
                <div key={i} className="up-row">
                  <span className="up-name">{u.name}</span>
                  {u.err ? <span className="err-text">{u.err}</span> : <span className="gauge wide"><i style={{ width: `${Math.round(u.p * 100)}%` }} /></span>}
                </div>
              ))}
            </div>
          )}

          <div
            className="dropzone"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
            onDragLeave={(e) => e.currentTarget.classList.remove("over")}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); onFiles(e.dataTransfer.files); }}
          >
            {lib.error && <div className="card empty err-text">{lib.error}</div>}
            {!lib.loading && !lib.error && assets.length === 0 && (
              <div className="card empty">Pasta vazia. Arraste imagens e vídeos para cá ou coloque na pasta do cliente no Drive.</div>
            )}
            <div className="cr-grid">
              {assets.map((a) => {
                const sentTo = accs.filter((acc) => a.meta[acc.id]?.image_hash || (a.meta[acc.id]?.video_id && !a.meta[acc.id]?.upload));
                return (
                  <article key={a.id} className="card mat">
                    <div className="cr-thumb">
                      {a.thumbnail_url ? <img src={a.thumbnail_url} alt="" loading="lazy" /> : <span>{a.kind === "video" ? "Vídeo" : "Imagem"}</span>}
                      <div className="cr-tags">
                        <span className="verdict v-mediano">{a.kind === "video" ? "Vídeo" : "Imagem"}</span>
                        {sentTo.length > 0 && <span className="verdict v-bom">No Meta</span>}
                      </div>
                    </div>
                    <div className="cr-body">
                      <div>
                        {a.web_view_link
                          ? <a className="cr-name mat-link" href={a.web_view_link} target="_blank" rel="noreferrer" title={`${a.name} — abrir no Drive`}>{a.name}</a>
                          : <div className="cr-name" title={a.name}>{a.name}</div>}
                        <div className="cr-sub">{[ratio(a.width, a.height), secs(a.duration_ms), size(a.size_bytes), a.folder_name].filter(Boolean).join(" · ")}</div>
                      </div>
                      <div className="mat-btns">
                        {accs.length > 0 && sentTo.length < accs.length && (
                          <button className="btn small" disabled={!!sending[a.id]} onClick={() => send(a, accs.find((x) => !sentTo.includes(x))!.id)}>
                            {sending[a.id] ?? "Enviar ao Meta"}
                          </button>
                        )}
                        <button className="btn small primary" onClick={() => setCreating(a)} disabled={!accs.length}>Criar anúncio</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {creating && (
        <CreateAdDialog asset={creating} clientId={clientId} accounts={accs} onClose={() => setCreating(null)}
          onDone={(m) => { setCreating(null); flash(m); setRefreshKey((k) => k + 1); }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
