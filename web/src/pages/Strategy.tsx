import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getClientDaily, getClients, getCreatives } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { count, money } from "../lib/format";
import { scoreCreatives } from "../lib/creative";
import { decideAction } from "../lib/autopilot";
import { getLibrary, driveStatus, type CreativeAsset } from "../lib/autopilot";
import { DEMO } from "../lib/supabase";
import {
  aiEnabled, getAnalysis, getClientCampaignsList, getStrategy, images64, lastAi, planLaunch, refreshXray, runAi, saveStrategy, searchCities,
  type Analysis, type ClientStrategy, type Cut, type Funnel, type Kind, type Region,
} from "../lib/strategy";

const RES: Record<Kind, { many: string; cost: string; one: string }> = {
  purchase: { many: "Vendas", cost: "Custo por venda", one: "venda" }, conversation: { many: "Conversas", cost: "Custo por conversa", one: "conversa" },
  lead: { many: "Leads", cost: "Custo por lead", one: "lead" }, click: { many: "Cliques", cost: "Custo por clique", one: "clique" },
};
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })}%`);
const rate = (v: number | null) => (v === null ? "—" : v > 1 ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : pct(v, 2));
const tone = (i: number | null | undefined) => (i === null || i === undefined ? "" : i >= 1.1 ? "good" : i <= 0.8 ? "bad" : "");
function deltaTxt(now: number | null, prev: number | null, lowerIsBetter = false) {
  if (now === null || prev === null || !prev) return null;
  const p = (now - prev) / prev;
  return { text: `${p > 0 ? "▲" : "▼"} ${Math.abs(Math.round(p * 100))}%`, cls: Math.abs(p) < 0.03 ? "" : (lowerIsBetter ? p < 0 : p > 0) ? "good" : "bad" };
}

function FunnelCard({ f }: { f: Funnel }) {
  const R = RES[f.kind];
  const d = deltaTxt(f.cpr, f.prev_cpr, true);
  return (
    <article className={`card fn ${f.bottleneck ? "has-bn" : ""}`}>
      <header className="fn-head">
        <div>
          <h3>{f.name}</h3>
          <p className="help">{f.status === "ACTIVE" ? "Ativa" : "Pausada/encerrada"} · {money(f.spend)} investidos · {count(f.result)} {R.many.toLowerCase()}</p>
        </div>
        <div className="fn-cpr">
          <span className="muted">{R.cost}</span>
          <b className={f.cpr !== null && f.bench_cpr !== null ? (f.cpr <= f.bench_cpr ? "good" : "bad") : ""}>{money(f.cpr)}</b>
          <span className="muted">ref. {money(f.bench_cpr)}{d ? <> · <span className={d.cls}>{d.text}</span></> : null}</span>
        </div>
      </header>
      <div className="fn-steps">
        {f.steps.map((s) => {
          // cada etapa na própria escala: campanha × referência daquela etapa
          const max = Math.max(s.rate ?? 0, s.bench ?? 0, 0.0001);
          return (
          <div key={s.id} className={`fn-step ${s.id === f.bottleneck ? "bn" : ""}`}>
            <div className="fn-label">{s.label}{s.id === f.bottleneck && <span className="bn-tag">gargalo</span>}</div>
            <div className="fn-bars">
              <i className={`now ${s.id === f.bottleneck ? "bad" : tone(s.index)}`} style={{ width: `${((s.rate ?? 0) / max) * 100}%` }} />
              <i className="ref" style={{ width: `${((s.bench ?? 0) / max) * 100}%` }} />
            </div>
            <div className="fn-val"><b>{rate(s.rate)}</b><span className="muted">ref. {rate(s.bench)}</span></div>
          </div>
          );
        })}
      </div>
      {f.issues.length > 0 && (
        <div className="fn-issues">
          {f.issues.map((i) => (
            <div key={i.id} className="fn-issue">
              <p><b>{i.text}</b></p>
              <ul>{i.fixes.map((x, k) => <li key={k}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {!f.issues.length && <p className="fn-ok">Funil saudável: nenhuma etapa abaixo da média do cliente.</p>}
    </article>
  );
}

function CutTable({ rows, kind, labelHead }: { rows: Cut[]; kind: Kind; labelHead: string }) {
  const R = RES[kind];
  if (!rows.length) return <p className="help">Sem dados nos últimos 30 dias.</p>;
  return (
    <div className="table-wrap">
      <table className="tbl-left cut-table">
        <thead><tr><th>{labelHead}</th><th>% da verba</th><th className="num">Investimento</th><th className="num">{R.many}</th><th className="num">{R.cost}</th></tr></thead>
        <tbody>
          {rows.filter((r) => r.spend >= 1).map((r) => (
            <tr key={r.key}>
              <td className="cut-name">{r.label}</td>
              <td><span className="share"><i style={{ width: `${Math.round(r.share * 100)}%` }} /></span> <span className="muted">{pct(r.share, 0)}</span></td>
              <td className="num">{money(r.spend)}</td>
              <td className="num">{count(r.result)}</td>
              <td className={`num strong ${tone(r.index)}`}>{r.result ? money(r.cpr) : "sem resultado"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HourChart({ rows, kind }: { rows: Cut[]; kind: Kind }) {
  const max = Math.max(...rows.map((r) => r.result), 1);
  const R = RES[kind];
  return (
    <div className="hours" role="img" aria-label={`${R.many} por hora do dia`}>
      {Array.from({ length: 24 }, (_, h) => {
        const r = rows.find((x) => Number(x.key) === h);
        return (
          <div key={h} className="hour" title={`${h}h: ${r ? `${count(r.result)} ${R.many.toLowerCase()}, ${money(r.spend)}` : "sem veiculação"}`}>
            <div className="hour-bar"><i style={{ height: `${((r?.result ?? 0) / max) * 100}%` }} /></div>
            <span>{h}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProfileEditor({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const data = useAsync(() => getStrategy(clientId), [clientId]);
  const camps = useAsync(() => getClientCampaignsList(clientId), [clientId]);
  const [s, setS] = useState<ClientStrategy | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ key: string; name: string; region: string; country: string }[]>([]);
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    if (data.loading) return;
    setS(data.data ?? { client_id: clientId, regions: [], age_min: null, age_max: null, genders: null, daily_budget: null, placements_mode: "winners", source_campaign_id: null, notes: null });
  }, [data.data, data.loading, clientId]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => searchCities(q).then(setFound).catch(() => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q]);

  if (!s) return <div className="card empty">Carregando perfil…</div>;
  const set = (p: Partial<ClientStrategy>) => { setS({ ...s, ...p }); setState(null); };
  const addCity = (c: { key: string; name: string; region: string }) => {
    if (s.regions.some((r) => r.key === c.key)) return;
    set({ regions: [...s.regions, { key: c.key, name: c.name, region: c.region, radius_km: 17 }] });
    setQ(""); setFound([]);
  };
  const updRegion = (key: string, p: Partial<Region>) => set({ regions: s.regions.map((r) => (r.key === key ? { ...r, ...p } : r)) });
  async function save() {
    setState("saving");
    try { await saveStrategy(s!); setState("saved"); onSaved(); } catch (e) { setState(e instanceof Error ? e.message : String(e)); }
  }
  const gender = !s.genders?.length ? "all" : s.genders[0] === 1 ? "m" : "f";

  return (
    <div className="card profile">
      <div className="profile-grid">
        <div className="field span-2">
          <label htmlFor="city-q">Cidades de interesse</label>
          <div className="city-search">
            <input id="city-q" className="input" placeholder="Digite o nome da cidade…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            {found.length > 0 && (
              <ul className="city-list" role="listbox">
                {found.map((c) => <li key={c.key}><button type="button" onClick={() => addCity(c)}>{c.name} <span className="muted">{c.region} · {c.country}</span></button></li>)}
              </ul>
            )}
          </div>
          <div className="regions">
            {s.regions.length === 0 && <span className="help">Sem cidades: as novas campanhas usam a localização da campanha-modelo.</span>}
            {s.regions.map((r) => (
              <span key={r.key} className="region-chip">
                <b>{r.name}</b>
                <select value={r.radius_km} onChange={(e) => updRegion(r.key, { radius_km: Number(e.target.value) })} aria-label={`Raio de ${r.name}`}>
                  {/* o Meta aceita raio de 17 a 80 km para cidades */}
                  {[17, 20, 25, 30, 40, 50, 65, 80].map((k) => <option key={k} value={k}>+{k} km</option>)}
                </select>
                <button type="button" aria-label={`Remover ${r.name}`} onClick={() => set({ regions: s.regions.filter((x) => x.key !== r.key) })}>×</button>
              </span>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Idade</label>
          <div className="dates">
            <input className="input" type="number" min={18} max={65} placeholder="18" value={s.age_min ?? ""} onChange={(e) => set({ age_min: e.target.value ? Number(e.target.value) : null })} aria-label="Idade mínima" />
            <span className="muted">a</span>
            <input className="input" type="number" min={18} max={65} placeholder="65+" value={s.age_max ?? ""} onChange={(e) => set({ age_max: e.target.value ? Number(e.target.value) : null })} aria-label="Idade máxima" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="gender">Gênero</label>
          <select id="gender" className="select" value={gender} onChange={(e) => set({ genders: e.target.value === "all" ? null : [e.target.value === "m" ? 1 : 2] })}>
            <option value="all">Todos</option><option value="f">Mulheres</option><option value="m">Homens</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="budget">Verba diária das novas campanhas</label>
          <input id="budget" className="input" inputMode="decimal" placeholder="igual à campanha-modelo" value={s.daily_budget ?? ""} onChange={(e) => set({ daily_budget: e.target.value ? Number(e.target.value.replace(",", ".")) : null })} />
        </div>
        <div className="field">
          <label htmlFor="plc">Posicionamentos</label>
          <select id="plc" className="select" value={s.placements_mode} onChange={(e) => set({ placements_mode: e.target.value as ClientStrategy["placements_mode"] })}>
            <option value="winners">Só os que mais trazem resultado</option>
            <option value="advantage">Advantage+ (o Meta distribui)</option>
            <option value="source">Iguais à campanha-modelo</option>
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="src">Campanha-modelo</label>
          <select id="src" className="select" value={s.source_campaign_id ?? ""} onChange={(e) => set({ source_campaign_id: e.target.value || null })}>
            <option value="">Automática: a de melhor custo por resultado nos últimos 30 dias</option>
            {(camps.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.effective_status === "ACTIVE" ? "● " : "○ "}{c.name}</option>)}
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="notes">Observações para a análise <span className="opt">opcional</span></label>
          <textarea id="notes" className="input" rows={2} placeholder="Ex.: público principal são aposentados; atendimento só em horário comercial" value={s.notes ?? ""} onChange={(e) => set({ notes: e.target.value || null })} />
        </div>
      </div>
      <div className="profile-foot">
        {state && state !== "saving" && state !== "saved" && <span className="err-text">{state}</span>}
        {state === "saved" && <span className="saved">Perfil salvo</span>}
        <button className="btn primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? "Salvando…" : "Salvar perfil"}</button>
      </div>
    </div>
  );
}

function LaunchPanel({ clientId, onDone }: { clientId: string; onDone: (msg: string) => void }) {
  const drive = useAsync(driveStatus, []);
  const lib = useAsync(() => (drive.data?.connected ? getLibrary(clientId, false) : Promise.resolve(null)), [clientId, drive.data?.connected]);
  const [assets, setAssets] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [plan, setPlan] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function makePlan() {
    setBusy("plan"); setErr(null);
    try {
      const r = await planLaunch({ client_id: clientId, asset_ids: assets, daily_budget: budget ? Number(budget.replace(",", ".")) : null, activate: true });
      setPlan({ id: r.action.id, reason: r.reason });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function launch() {
    if (!plan) return;
    setBusy("launch"); setErr(null);
    try { await decideAction(plan.id, "approve"); onDone("Campanha criada no Meta. Ela entra em revisão antes de veicular."); setPlan(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  const list: CreativeAsset[] = lib.data?.assets ?? [];

  return (
    <div className="card launch">
      <p className="help">O sistema parte da campanha de melhor resultado do cliente (já com página, Instagram, WhatsApp e pixel), aplica as cidades e a idade do perfil, os posicionamentos que mais trazem resultado e a verba, e acrescenta os criativos escolhidos.</p>
      <div className="launch-grid">
        <div className="field">
          <label htmlFor="lb">Verba diária <span className="opt">vazio = a do perfil</span></label>
          <input id="lb" className="input" inputMode="decimal" placeholder="R$" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <div className="field span-2">
          <label>Criativos novos da biblioteca <span className="opt">opcional</span></label>
          {!drive.data?.connected ? <p className="help">Conecte o Google Drive em <Link to={`/materiais${DEMO ? "?demo" : ""}`}>Materiais</Link> para escolher criativos.</p>
            : list.length === 0 ? <p className="help">Nenhum material na pasta deste cliente.</p>
            : (
              <div className="pick">
                {list.slice(0, 12).map((a) => (
                  <label key={a.id} className={`pick-item ${assets.includes(a.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={assets.includes(a.id)} onChange={(e) => setAssets(e.target.checked ? [...assets, a.id] : assets.filter((x) => x !== a.id))} />
                    {a.thumbnail_url ? <img src={a.thumbnail_url} alt="" /> : <span>{a.kind === "video" ? "Vídeo" : "Imagem"}</span>}
                    <em>{a.name}</em>
                  </label>
                ))}
              </div>
            )}
        </div>
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
      {plan ? (
        <div className="plan">
          <h4>Plano da campanha</h4>
          <ul>{plan.reason.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚ])/).map((x, i) => <li key={i}>{x}</li>)}</ul>
          <div className="ap-btns">
            <button className="btn primary" onClick={launch} disabled={!!busy}>{busy === "launch" ? "Criando no Meta…" : "Lançar agora"}</button>
            <Link className="btn" to={`/piloto${DEMO ? "?demo" : ""}`}>Deixar para aprovação no Piloto</Link>
          </div>
        </div>
      ) : (
        <button className="btn primary" onClick={makePlan} disabled={!!busy}>{busy === "plan" ? "Montando o plano…" : "Montar plano da nova campanha"}</button>
      )}
    </div>
  );
}

export function StrategyPage() {
  const [params, setParams] = useSearchParams();
  const clientId = params.get("cliente") ?? "";
  const days = Number(params.get("dias")) || 14;
  const clients = useAsync(getClients, []);
  const [reload, setReload] = useState(0);
  const data = useAsync(() => (clientId ? getAnalysis(clientId, days) : Promise.resolve(null)), [clientId, days, reload]);
  const ai = useAsync(() => (clientId ? lastAi(clientId) : Promise.resolve(null)), [clientId, reload]);
  const aiOn = useAsync(aiEnabled, []);
  const [tab, setTab] = useState<"placement" | "age_gender" | "hour" | "adset">("placement");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const a: Analysis | null = data.data ?? null;
  const kind: Kind = a?.client.kind ?? "conversation";
  const R = RES[kind];

  async function doRefresh() {
    setBusy("xray");
    try { await refreshXray(clientId); setReload((x) => x + 1); flash("Raio-x atualizado com os últimos 30 dias do Meta."); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function doAi() {
    setBusy("ai");
    try { await runAi(clientId, days); setReload((x) => x + 1); flash("Análise estratégica pronta."); }
    catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function doSlides() {
    if (!a) return;
    setBusy("slides");
    try {
      const { buildSlides } = await import("../lib/slides");
      const [daily, creatives] = await Promise.all([getClientDaily(clientId, days), getCreatives(clientId, 30)]);
      const scored = scoreCreatives(creatives);
      const top = scored.filter((c) => c.verdict !== "teste" && c.score >= 55).sort((x, y) => y.score - x.score).slice(0, 4);
      const imgs = await images64(top.map((c) => c.image_url ?? c.thumbnail_url).filter(Boolean) as string[]).catch(() => ({}));
      await buildSlides({ a, ai: ai.data ?? null, daily, creatives: scored, images: imgs });
    } catch (e) { flash(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  const cutsFor = useMemo(() => (a ? a.cuts : null), [a]);
  const sm = a?.summary;
  const d1 = sm ? deltaTxt(sm.cpr, sm.prev_cpr, true) : null;
  const d2 = sm ? deltaTxt(sm.result, sm.prev_result) : null;
  const clientName = clients.data?.find((c) => c.id === clientId)?.name;
  const AI = ai.data?.analysis;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" />Gestão estratégica</p>
          <h1>{clientName ? `Estratégia · ${clientName}` : "Estratégia"}</h1>
          <p className="sub">Funil, gargalos, onde e para quem anunciar, análise de gestor e lançamento de campanhas.</p>
        </div>
        <div className="head-actions">
          <select className="select" value={clientId} onChange={(e) => set("cliente", e.target.value)} aria-label="Cliente">
            <option value="">Escolha o cliente</option>
            {(clients.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {clientId && (
            <div className="seg" role="group" aria-label="Período">
              {[7, 14, 30].map((p) => <button key={p} className={p === days ? "on" : ""} aria-pressed={p === days} onClick={() => set("dias", p === 14 ? "" : String(p))}>{p}d</button>)}
            </div>
          )}
        </div>
      </header>

      {!clientId && <div className="card empty">Escolha um cliente para ver a análise.</div>}
      {clientId && data.loading && <div className="loading">Analisando o funil e o raio-x…</div>}
      {clientId && data.error && <div className="card empty err-text">{data.error}</div>}

      {a && sm && (
        <>
          <div className="st-actions">
            <button className="btn primary" onClick={doSlides} disabled={!!busy}>{busy === "slides" ? "Gerando slides…" : "Baixar relatório em slides"}</button>
            <button className="btn" onClick={doAi} disabled={!!busy || aiOn.data === false} title={aiOn.data === false ? "Falta a chave ANTHROPIC_API_KEY no Supabase" : ""}>
              {busy === "ai" ? "A IA está analisando…" : "Gerar análise estratégica (IA)"}
            </button>
            <button className="btn" onClick={doRefresh} disabled={!!busy}>{busy === "xray" ? "Atualizando…" : "Atualizar raio-x"}</button>
          </div>

          <section className="card">
            <div className="kpis st-kpis">
              <div className="stat"><div className="stat-label">Investimento</div><div className="stat-value">{money(sm.spend)}</div><div className="stat-note">últimos {a.days} dias</div></div>
              <div className="stat"><div className="stat-label">{R.many}</div><div className="stat-value">{count(sm.result)}</div><div className={`stat-note ${d2?.cls ?? ""}`}>{d2 ? `${d2.text} vs período anterior` : "—"}</div></div>
              <div className="stat"><div className="stat-label">{R.cost}</div><div className="stat-value">{money(sm.cpr)}</div><div className={`stat-note ${d1?.cls ?? ""}`}>{d1 ? `${d1.text} vs período anterior` : "—"}</div></div>
              <div className="stat"><div className="stat-label">Referência (90 dias)</div><div className="stat-value">{money(sm.bench_cpr)}</div><div className="stat-note">{R.cost.toLowerCase()} médio do cliente</div></div>
              {kind === "purchase" && <div className="stat"><div className="stat-label">ROAS</div><div className="stat-value">{sm.roas ? `${sm.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x` : "—"}</div><div className="stat-note">{money(sm.value)} faturados</div></div>}
            </div>
          </section>

          {AI && (
            <section className="section">
              <div className="section-head"><h2>Análise estratégica</h2><span className="hint">gerada {new Date(ai.data!.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>
              <div className="card ai">
                <div className="ai-top">
                  <div className="ai-score"><b>{AI.nota_saude}</b><span>/10</span><em>saúde da conta</em></div>
                  <p className="ai-sum">{AI.resumo}</p>
                </div>
                <div className="ai-cols">
                  <div>
                    <h3>Gargalos</h3>
                    {AI.gargalos.map((g, i) => (
                      <div key={i} className={`ai-item imp-${g.impacto}`}>
                        <b>{g.titulo}</b><p>{g.evidencia}</p>{g.causa_provavel && <p className="muted">Causa provável: {g.causa_provavel}</p>}<p className="ai-act">→ {g.acao}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>Oportunidades</h3>
                    {AI.oportunidades.map((o, i) => <div key={i} className="ai-item good"><b>{o.titulo}</b><p>{o.evidencia}</p><p className="ai-act">→ {o.acao}</p></div>)}
                    <h3>Plano dos próximos 7 dias</h3>
                    <ol className="ai-plan">{AI.plano_7_dias.map((p, i) => <li key={i}>{p}</li>)}</ol>
                  </div>
                </div>
                {AI.testes?.length > 0 && (
                  <div className="ai-tests">
                    <h3>Testes recomendados</h3>
                    <div className="ai-test-grid">{AI.testes.map((t, i) => <div key={i}><b>{t.hipotese}</b><p>{t.como_testar}</p><span className="muted">Métrica: {t.metrica}</span></div>)}</div>
                  </div>
                )}
              </div>
            </section>
          )}
          {!AI && aiOn.data === false && (
            <div className="card note-ai">A análise estratégica com IA fica disponível quando a chave <code>ANTHROPIC_API_KEY</code> for salva nos segredos do Supabase. O diagnóstico abaixo já funciona sem ela.</div>
          )}

          <section className="section">
            <div className="section-head"><h2>Funil por campanha</h2><span className="hint">cada etapa comparada com a média do cliente nos últimos 90 dias</span></div>
            {a.funnels.length === 0 ? <div className="card empty">Nenhuma campanha com investimento no período.</div>
              : <div className="fn-grid">{a.funnels.map((f) => <FunnelCard key={f.campaign_id} f={f} />)}</div>}
          </section>

          {a.insights.length > 0 && (
            <section className="section">
              <div className="section-head"><h2>O que os dados mostram</h2><span className="hint">últimos 30 dias</span></div>
              <div className="card insights">
                {a.insights.map((i, k) => (
                  <div key={k} className="insight"><span className="ins-area">{i.area}</span><p>{i.text}</p><p className="ai-act">→ {i.action}</p></div>
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>Raio-x</h2>
              <div className="chips">
                {([["placement", "Posicionamentos"], ["age_gender", "Público"], ["hour", "Horário"], ["adset", "Regiões e conjuntos"]] as const).map(([id, l]) => (
                  <button key={id} className={`chip ${tab === id ? "on" : ""}`} aria-pressed={tab === id} onClick={() => setTab(id)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="card xray">
              {cutsFor && tab === "hour" ? <HourChart rows={cutsFor.hour} kind={kind} />
                : cutsFor && <CutTable rows={cutsFor[tab]} kind={kind} labelHead={tab === "placement" ? "Posicionamento" : tab === "age_gender" ? "Idade · gênero" : "Conjunto — localização"} />}
            </div>
          </section>

          <section className="section">
            <div className="section-head"><h2>Perfil de campanha</h2><span className="hint">onde e para quem as novas campanhas vão rodar</span></div>
            <ProfileEditor clientId={clientId} onSaved={() => setReload((x) => x + 1)} />
          </section>

          <section className="section">
            <div className="section-head"><h2>Lançar nova campanha</h2><span className="hint">entra no histórico do Piloto automático e pode ser desfeita</span></div>
            <LaunchPanel clientId={clientId} onDone={flash} />
          </section>
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
