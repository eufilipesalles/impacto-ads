// Relatório em andamento guardado no navegador: sobrevive a trocar de página, recarregar e fechar a aba.
import type { PeriodResult, PresetId } from "./period";

export interface ReportDraft {
  clientId: string;
  preset: PresetId;
  since: string;
  until: string;
  campaignIds: string[];
  metrics: string[];
  compare: boolean;
  emojis: boolean;
  showCampaigns: boolean;
  title: string;
  note: string;
  data: PeriodResult | null;
  base: string;        // mensagem gerada automaticamente
  text: string;        // mensagem como está no editor (pode ter edições manuais)
  reportId: string | null;
  savedAt: string;
}

const KEY = "impacto-ads:relatorio-rascunho:v1";

export function loadDraft(): ReportDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ReportDraft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(d: Omit<ReportDraft, "savedAt">) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: new Date().toISOString() })); } catch { /* sem armazenamento: segue só na memória */ }
}

export function clearDraft() {
  try { localStorage.removeItem(KEY); } catch { /* nada a fazer */ }
}
