// Novo criativo em 2 passos: (1) o material — arquivo ou link do Instagram; (2) para onde vai e quando entra no ar
import { useMemo, useRef, useState } from "react";
import type { CreativeAsset } from "../lib/autopilot";
import { getClientAdsets } from "../lib/autopilot";
import { addCreative, creativeFromInstagram, getAssets, uploadCreative, type Placement, type When } from "../lib/manager";
import { useAsync } from "../lib/hooks";

export function SourceBadge({ a }: { a: CreativeAsset }) {
  const s = a.source ?? "drive";
  return <span className={`src-badge src-${s}`}>{s === "instagram" ? "Instagram" : s === "upload" ? "Enviado" : "Drive"}</span>;
}

// ---------- passo 1: entrada do material ----------
export function CreativeIntake({ clientId, onAsset }: { clientId: string; onAsset: (a: CreativeAsset) => void }) {
  const [tab, setTab] = useState<"file" | "ig">("file");
  const [progress, setProgress] = useState<{ name: string; p: number } | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setErr(null); setProgress({ name: f.name, p: 0 });
    try { onAsset(await uploadCreative(clientId, f, (p) => setProgress({ name: f.name, p }))); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setProgress(null); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function onLink() {
    if (!link.trim()) return;
    setErr(null); setBusy(true);
    try { onAsset(await creativeFromInstagram(clientId, link.trim())); setLink(""); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="intake">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === "file"} className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>Enviar arquivo</button>
        <button role="tab" aria-selected={tab === "ig"} className={tab === "ig" ? "on" : ""} onClick={() => setTab("ig")}>Link do Instagram</button>
      </div>
      {tab === "file" ? (
        <div
          className="dropzone big"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
          onDragLeave={(e) => e.currentTarget.classList.remove("over")}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); onFiles(e.dataTransfer.files); }}
          role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        >
          {progress ? (
            <div className="up-row"><span className="up-name">{progress.name}</span><span className="gauge wide"><i style={{ width: `${Math.round(progress.p * 100)}%` }} /></span></div>
          ) : (
            <>
              <b>Arraste o vídeo ou a imagem aqui</b>
              <span className="muted">ou clique para escolher · MP4, MOV, JPG ou PNG · até 50 MB</span>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => onFiles(e.target.files)} />
        </div>
      ) : (
        <div className="ig-box">
          <label className="field-label" htmlFor="ig-link">Cole o link do post ou reels do cliente</label>
          <div className="dates">
            <input id="ig-link" className="input" placeholder="https://www.instagram.com/reel/…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onLink()} />
            <button className="btn small primary" onClick={onLink} disabled={busy || !link.trim()}>{busy ? "Buscando…" : "Usar este post"}</button>
          </div>
          <p className="hint">O anúncio usa o próprio post: curtidas e comentários continuam aparecendo. Precisa ser do Instagram do cliente.</p>
        </div>
      )}
      {err && <p className="err-text" role="alert">{err}</p>}
    </div>
  );
}

// ---------- passo 2: destino e momento ----------
export function PlaceCreative({ clientId, asset, preset, onDone, onBack }: {
  clientId: string; asset: CreativeAsset; preset?: { campaign_id?: string; adset_id?: string };
  onDone: (msg: string) => void; onBack?: () => void;
}) {
  const sets = useAsync(() => getClientAdsets(clientId), [clientId]);
  const [mode, setMode] = useState<Placement["mode"]>(preset?.campaign_id ? "campaign" : "best");
  const [campaignId, setCampaignId] = useState(preset?.campaign_id ?? "");
  const [adsetId, setAdsetId] = useState(preset?.adset_id ?? "");
  const [when, setWhen] = useState<When>("now");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // campanhas ativas com conjuntos que têm anúncio (o anúncio serve de modelo de texto e botão)
  const camps = useMemo(() => {
    const m = new Map<string, { id: string; name: string; status: string | null; sets: { id: string; name: string | null; status: string | null }[] }>();
    for (const s of sets.data ?? []) {
      const key = s.campaign_name ?? "";
      const cid = s.campaign_id ?? key;
      const e = m.get(cid) ?? { id: cid, name: key, status: s.campaign_status, sets: [] };
      e.sets.push({ id: s.id, name: s.name, status: s.effective_status });
      m.set(cid, e);
    }
    return [...m.values()].sort((a, b) => (a.status === "ACTIVE" ? 0 : 1) - (b.status === "ACTIVE" ? 0 : 1));
  }, [sets.data]);
  const camp = camps.find((c) => c.id === campaignId);

  async function go() {
    setErr(null); setBusy(true);
    try {
      const where: Placement = mode === "campaign" ? { mode, campaign_id: campaignId, adset_id: adsetId || null } : mode === "new" ? { mode } : { mode: "best" };
      onDone(await addCreative(clientId, asset, where, when));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const ready = mode !== "campaign" || !!campaignId;
  return (
    <div className="place">
      <div className="place-asset">
        {asset.thumbnail_url ? <img src={asset.thumbnail_url} alt="" /> : <span className="ph">{asset.kind === "video" ? "Vídeo" : "Imagem"}</span>}
        <div><b>{asset.name}</b><div className="muted"><SourceBadge a={asset} /> {asset.kind === "video" ? "vídeo" : "imagem"}</div></div>
      </div>

      <fieldset className="opts">
        <legend>Para onde vai?</legend>
        <label className={`opt ${mode === "best" ? "on" : ""}`}>
          <input type="radio" name="mode" checked={mode === "best"} onChange={() => setMode("best")} />
          <span><b>O sistema escolhe</b><small>Entra no conjunto com o menor custo por resultado dos últimos 14 dias, com o texto e o botão do anúncio que mais converte ali.</small></span>
        </label>
        <label className={`opt ${mode === "campaign" ? "on" : ""}`}>
          <input type="radio" name="mode" checked={mode === "campaign"} onChange={() => setMode("campaign")} />
          <span><b>Escolher a campanha</b><small>Você escolhe a campanha; o conjunto é opcional.</small></span>
        </label>
        {mode === "campaign" && (
          <div className="opt-sub">
            <select className="select" value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setAdsetId(""); }} aria-label="Campanha">
              <option value="">{sets.loading ? "Carregando campanhas…" : "Escolha a campanha"}</option>
              {camps.map((c) => <option key={c.id} value={c.id}>{c.status === "ACTIVE" ? "● " : "○ "}{c.name}</option>)}
            </select>
            {camp && camp.sets.length > 1 && (
              <select className="select" value={adsetId} onChange={(e) => setAdsetId(e.target.value)} aria-label="Conjunto">
                <option value="">Melhor conjunto desta campanha (automático)</option>
                {camp.sets.map((s) => <option key={s.id} value={s.id}>{s.status === "ACTIVE" ? "● " : "○ "}{s.name}</option>)}
              </select>
            )}
          </div>
        )}
        <label className={`opt ${mode === "new" ? "on" : ""}`}>
          <input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} />
          <span><b>Campanha nova</b><small>Montada pelo perfil do cliente (regiões, idade, verba e posicionamentos que mais convertem), a partir da melhor campanha.</small></span>
        </label>
      </fieldset>

      <fieldset className="opts">
        <legend>Quando entra no ar?</legend>
        <label className={`opt ${when === "now" ? "on" : ""}`}>
          <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} />
          <span><b>Agora</b><small>Sobe ativo. O Meta revisa em alguns minutos.</small></span>
        </label>
        <label className={`opt ${when === "approve" ? "on" : ""}`}>
          <input type="radio" name="when" checked={when === "approve"} onChange={() => setWhen("approve")} />
          <span><b>Deixar pronto, eu ativo depois</b><small>Fica em Piloto automático › Aguardando você. Um toque em "Aprovar" coloca no ar.</small></span>
        </label>
        {mode !== "new" && (
          <label className={`opt ${when === "auto" ? "on" : ""}`}>
            <input type="radio" name="when" checked={when === "auto"} onChange={() => setWhen("auto")} />
            <span><b>Deixar com o piloto</b><small>Clientes em Autônomo sobem na hora; nos demais vira proposta para aprovar.</small></span>
          </label>
        )}
      </fieldset>

      {err && <p className="err-text" role="alert">{err}</p>}
      <div className="nc-foot right">
        {onBack && <button className="btn" onClick={onBack} disabled={busy}>Voltar</button>}
        <button className="btn primary" onClick={go} disabled={busy || !ready}>
          {busy ? "Subindo…" : when === "now" ? (mode === "new" ? "Lançar campanha" : "Colocar no ar") : "Confirmar"}
        </button>
      </div>
    </div>
  );
}

// ---------- diálogo completo (usado no gerenciador) ----------
export function AddCreativeDialog({ clientId, preset, onClose, onDone }: {
  clientId: string; preset?: { campaign_id?: string; adset_id?: string; label?: string };
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [asset, setAsset] = useState<CreativeAsset | null>(null);
  const lib = useAsync(() => getAssets(clientId), [clientId]);
  const unused = (lib.data ?? []).filter((a) => !a.used_at).slice(0, 8);
  return (
    <div className="drawer-wrap center" onClick={onClose}>
      <div className="card modal wide" role="dialog" aria-modal="true" aria-label="Novo criativo" onClick={(e) => e.stopPropagation()}>
        <div className="nc-head">
          <div>
            <p className="eyebrow">{asset ? "Passo 2 de 2" : "Passo 1 de 2"}</p>
            <h2>{asset ? "Para onde e quando" : "Novo criativo"}{preset?.label ? <span className="muted"> · {preset.label}</span> : null}</h2>
          </div>
          <button className="dr-close dark" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        {!asset ? (
          <>
            <CreativeIntake clientId={clientId} onAsset={setAsset} />
            {unused.length > 0 && (
              <div className="lib-pick">
                <p className="field-label">Ou use um que já está na biblioteca</p>
                <div className="lib-row">
                  {unused.map((a) => (
                    <button key={a.id} className="lib-item" onClick={() => setAsset(a)} title={a.name}>
                      {a.thumbnail_url ? <img src={a.thumbnail_url} alt="" /> : <span>{a.kind === "video" ? "Vídeo" : "Imagem"}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <PlaceCreative clientId={clientId} asset={asset} preset={preset} onBack={() => setAsset(null)} onDone={onDone} />
        )}
      </div>
    </div>
  );
}
