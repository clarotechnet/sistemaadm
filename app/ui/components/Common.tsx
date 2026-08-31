"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useApp } from "../state/AppContext";

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const tone = normalized === "OK" || normalized.includes("SUCESS") || normalized === "ATIVO" || normalized === "CONFERIDO" ? "success" : normalized.includes("DIVERG") || normalized.includes("ERRO") || normalized.includes("BLOQUE") ? "danger" : normalized.includes("AGUARD") || normalized.includes("AUSEN") || normalized.includes("NÃO LOCALIZADO") || normalized.includes("AVISO") ? "warning" : "neutral";
  return <span className={`status-badge ${tone}`}>{status}</span>;
}

export function MetricCard({ label, value, detail, tone = "neutral" }: { label: string; value: string | number; detail?: string; tone?: string }) {
  return <article className={`metric-card-v2 ${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

export function ProcessingLog({ logs, progress }: { logs: string[]; progress: number }) {
  if (!logs.length) return null;
  return <div className="processing-log"><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="log-lines">{logs.map((log, index) => <div key={`${log}-${index}`}><CheckCircle2 size={13} />{log}</div>)}</div></div>;
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  const Icon = ({ tone }: { tone: string }) => tone === "success" ? <CheckCircle2 /> : tone === "error" ? <XCircle /> : tone === "warning" ? <AlertTriangle /> : <Info />;
  return <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={`toast ${toast.tone}`} key={toast.id}><Icon tone={toast.tone} /><span><strong>{toast.title}</strong>{toast.description && <small>{toast.description}</small>}</span><button onClick={() => dismissToast(toast.id)} aria-label="Fechar"><X size={15} /></button></div>)}</div>;
}

export function ConfirmationModal({ open, title, description, confirmLabel = "Confirmar", danger = false, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="modal" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}><div className={`modal-icon ${danger ? "danger" : "warning"}`}><AlertTriangle /></div><h3>{title}</h3><p>{description}</p><div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancelar</button><button className={`button ${danger ? "danger" : "primary"}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></div></div></div>;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state">{icon}<h3>{title}</h3><p>{description}</p>{action}</div>;
}
