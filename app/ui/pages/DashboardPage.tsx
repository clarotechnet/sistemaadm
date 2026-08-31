"use client";

import { ArrowRight, CheckCircle2, FileText, HeartPulse, Stethoscope, TriangleAlert, Upload, UsersRound } from "lucide-react";
import { formatMoney } from "../../../src/utils/money";
import { useApp } from "../state/AppContext";
import { MetricCard } from "../components/Common";
import type { AppRoute } from "../components/AppShell";

export function DashboardPage({ navigate }: { navigate: (route: AppRoute) => void }) {
  const { user, activePayroll, health, dental, audits } = useApp();
  const firstName = user.name.split(" ")[0];
  return <>
    <div className="page-heading"><div><h2>Bom dia, {firstName}.</h2><p>Acompanhe os processamentos e pendências da competência atual.</p></div><button className="button primary" onClick={() => navigate("payroll")}><Upload size={16} /> Nova importação</button></div>
    {activePayroll ? <button className="active-file-banner" onClick={() => navigate("payroll")}><span className="document-icon">XLS</span><span><small>FOLHA ATIVA · {activePayroll.competence}</small><strong>{activePayroll.fileName}</strong><em>Importada em {new Date(activePayroll.importedAt).toLocaleString("pt-BR")} por {activePayroll.importedBy}</em></span><span className="status-badge success">Ativa</span><span className="button secondary">Ver folha</span></button> : <button className="active-file-banner empty" onClick={() => navigate("payroll")}><Upload /><span><strong>Nenhuma folha ativa</strong><em>Importe a Folha de Pagamento para iniciar as conferências.</em></span><span className="button primary">Importar folha</span></button>}
    <div className="metrics-grid">
      <MetricCard label="COLABORADORES" value={activePayroll?.records.length ?? 0} detail="na folha ativa" />
      <MetricCard label="PLANO DE SAÚDE" value={health?.summary.divergent ?? 0} detail="divergências" tone={health?.summary.divergent ? "danger" : "success"} />
      <MetricCard label="PLANO ODONTOLÓGICO" value={dental?.summary.divergent ?? 0} detail="divergências" tone={dental?.summary.divergent ? "danger" : "success"} />
      <MetricCard label="PROCESSAMENTOS" value={audits.length} detail="nesta sessão" tone="success" />
    </div>
    <div className="dashboard-columns">
      <section className="surface"><div className="section-header"><div><h3>Conferências da competência</h3><p>Visão consolidada dos comparativos</p></div><button className="link-button" onClick={() => navigate("reports")}>Ver relatório <ArrowRight size={14} /></button></div><div className="comparison-overview">
        <OverviewItem icon={<HeartPulse />} label="Plano de Saúde" state={health} />
        <OverviewItem icon={<Stethoscope />} label="Plano Odontológico" state={dental} />
        <OverviewItem icon={<UsersRound />} label="Benefícios" />
      </div></section>
      <section className="surface"><div className="section-header"><div><h3>Atividade recente</h3><p>Últimas operações da equipe</p></div></div>{audits.length ? <div className="activity-feed">{audits.slice(0, 5).map(item => <div key={item.id}><span className={`activity-mark ${item.status.toLowerCase()}`}>{item.status === "SUCESSO" ? <CheckCircle2 /> : <TriangleAlert />}</span><span><strong>{item.operation}</strong><small>{item.module} · {item.result}</small></span><time>{new Date(item.timestamp).toLocaleString("pt-BR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</time></div>)}</div> : <div className="mini-empty"><FileText /><strong>Nenhuma atividade nesta sessão</strong><span>As importações e conferências aparecerão aqui.</span></div>}</section>
    </div>
  </>;
}

function OverviewItem({ icon, label, state }: { icon: React.ReactNode; label: string; state?: { summary: { total:number; ok:number; divergent:number; missing:number; differenceTotal:number } } | null }) {
  const percentage = state && state.summary.total ? Math.round(state.summary.ok / state.summary.total * 100) : 0;
  return <div><span className="overview-icon">{icon}</span><span><strong>{label}</strong><small>{state ? `${state.summary.ok} corretos · ${state.summary.divergent} divergentes · diferença ${formatMoney(state.summary.differenceTotal)}` : "Processamento ainda não iniciado"}</small></span><div className="overview-progress"><i style={{ width: `${percentage}%` }} /></div><b>{state ? `${percentage}%` : "—"}</b></div>;
}
