"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Download, RefreshCw, Search, X } from "lucide-react";
import type { ActivePayroll, Employee } from "../../../src/types";
import { auditValue, comparePayrollHistory, comparisonCompetences, deductionsPercentage, defaultAuditRules, detailEvents, eventTotal, matchesAuditMetric, type AuditMetric, type AuditReview, type AuditRow, type AuditRules, type VacationEvidence } from "../../../src/modules/payroll/audit";
import { loadPayrollMonth } from "../../../src/services/browser-backend";
import { auditContext, loadAuditEmployees, loadAuditReviews, loadAuditVacations, loadEmployeePayrollHistory, saveAuditReview, type AuditContext, type AuditHistoryMonth } from "../../../src/services/payroll-audit";
import { exportPayrollAudit, reviewLabels, severityLabels } from "../../../src/services/payroll-audit-export";
import { syncEmployeesFromQuark } from "../../../src/services/employee-documents";
import { normalizeHeader } from "../../../src/utils/text";
import { formatCpf } from "../../../src/utils/cpf";
import { formatMoney } from "../../../src/utils/money";
import { EmptyState, MetricCard } from "../components/Common";
import { useApp } from "../state/AppContext";

const money = (value: number | null) => formatMoney(value);
const percentage = (value: number | null) => value === null ? "—" : `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const reviewKey = (employeeKey: string, ruleCode: string) => `${employeeKey}:${ruleCode}`;
const severityTone = { OK: "success", ATENCAO: "warning", CRITICO: "danger", INFORMACAO: "info" };
const employeeStatusLabels = { ATIVO: "Ativo", DESLIGADO: "Desligado", NAO_LOCALIZADO: "Não localizado" };
const metricCards: Array<{ key: AuditMetric; label: string; tone: string }> = [
  { key: "processed", label: "Processados", tone: "" }, { key: "ok", label: "OK", tone: "success" },
  { key: "attention", label: "Atenção", tone: "warning" }, { key: "critical", label: "Críticos", tone: "danger" },
  { key: "information", label: "Informação", tone: "info" }, { key: "zeroPayroll", label: "Folha zerada", tone: "" },
  { key: "zeroLiquid", label: "Líquido zerado", tone: "" }, { key: "negativeLiquid", label: "Líquido negativo / descontos excedentes", tone: "danger" },
  { key: "newEmployees", label: "Novos", tone: "" }, { key: "missing", label: "Ausentes / sem folha", tone: "" },
  { key: "duplicates", label: "Possíveis duplicidades", tone: "" }, { key: "activeZeroLiquid", label: "Ativos hoje com líquido zerado", tone: "danger" },
  { key: "unmatchedEmployees", label: "CPFs sem cadastro", tone: "warning" }, { key: "highDeductions", label: "Descontos elevados", tone: "warning" },
];

export function PayrollAuditPage({ onImport }: { onImport: () => void }) {
  const app = useApp();
  const [currentChoice, setCurrentMonth] = useState("");
  const [comparisonMonths, setComparisonMonths] = useState(3);
  const currentMonth = currentChoice || app.selectedCompetence || app.payrollMonths[0]?.competence || "";
  const referenceMonths = useMemo(() => currentMonth ? comparisonCompetences(currentMonth, comparisonMonths).filter(competence => app.payrollMonths.some(month => month.competence === competence)) : [], [currentMonth, comparisonMonths, app.payrollMonths]);
  const previousMonth = referenceMonths[0] ?? "";
  const [loaded, setLoaded] = useState<{ requestKey: string; current: ActivePayroll; previous: ActivePayroll | null; references: ActivePayroll[]; employees: Employee[]; vacations: VacationEvidence[] } | null>(null);
  const [loadError, setLoadError] = useState<{ requestKey: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [rules, setRules] = useState<AuditRules>(defaultAuditRules);
  const [limits, setLimits] = useState({ percentage: "20", absolute: "300", deductionsPercentage: "50" });
  const [metric, setMetric] = useState<AuditMetric | null>(null);
  const tableRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("EXCEPTIONS");
  const [employeeStatus, setEmployeeStatus] = useState("");
  const [findingCode, setFindingCode] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [allocation, setAllocation] = useState({ company: "", unit: "", costCenter: "", department: "", jobTitle: "" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ key: string; requestKey: string } | null>(null);
  const [reviewState, setReviewState] = useState<{ key: string; context: AuditContext | null; reviews: AuditReview[]; error: string } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [syncingEmployees, setSyncingEmployees] = useState(false);

  const requestKey = JSON.stringify([currentMonth, comparisonMonths, referenceMonths, reload, app.activePayroll?.importedAt]);
  const data = loaded?.requestKey === requestKey ? loaded : null;
  const error = loadError?.requestKey === requestKey ? loadError.message : "";
  const loading = Boolean(currentMonth) && !data && !error;
  const reviewRequestKey = JSON.stringify([requestKey, data?.current.importedAt, data?.references.map(month => [month.id, month.importedAt]), rules]);
  const context = data && reviewState?.key === reviewRequestKey ? reviewState.context : null;
  const reviews = useMemo(() => data && reviewState?.key === reviewRequestKey ? reviewState.reviews : [], [data, reviewState, reviewRequestKey]);
  const reviewError = reviewState?.key === reviewRequestKey ? reviewState.error : "";
  useEffect(() => {
    if (!currentMonth || app.user.role === "CONSULTA") return;
    let cancelled = false;
    const current = app.activePayroll?.competence === currentMonth && reload === 0 ? Promise.resolve(app.activePayroll) : loadPayrollMonth(currentMonth);
    void Promise.all([current, Promise.all(referenceMonths.map(competence => loadPayrollMonth(competence))), loadAuditEmployees(), loadAuditVacations(currentMonth)])
      .then(([now, references, employees, vacations]) => {
        if (!now || references.some(month => !month)) throw new Error("A competência não foi encontrada. Atualize a lista de folhas.");
        const history = references.filter((month): month is ActivePayroll => Boolean(month));
        if (!cancelled) setLoaded({ requestKey, current: now, previous: history[0] ?? null, references: history, employees, vacations });
      }).catch(caught => { if (!cancelled) setLoadError({ requestKey, message: caught instanceof Error ? caught.message : "Não foi possível carregar as folhas." }); });
    return () => { cancelled = true; };
  }, [currentMonth, referenceMonths, reload, requestKey, app.activePayroll, app.user.role]);
  const result = useMemo(() => data ? comparePayrollHistory(data.current, data.references, data.employees, rules, data.vacations) : null, [data, rules]);
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    void auditContext(data.current, data.previous, rules, data.employees, data.references).then(async value => {
      const items = await loadAuditReviews(value);
      if (!cancelled) setReviewState({ key: reviewRequestKey, context: value, reviews: items, error: "" });
    }).catch(caught => { if (!cancelled) setReviewState({ key: reviewRequestKey, context: null, reviews: [], error: caught instanceof Error ? caught.message : "Não foi possível carregar o tratamento dos achados." }); });
    return () => { cancelled = true; };
  }, [data, rules, reviewRequestKey]);
  const reviewMap = useMemo(() => new Map(reviews.map(item => [reviewKey(item.employeeKey, item.ruleCode), item])), [reviews]);
  const filtered = useMemo(() => (result?.rows ?? []).filter(row => {
    if (metric && !matchesAuditMetric(row, metric)) return false;
    const normalized = normalizeHeader(query); const cpf = query.replace(/\D/g, "");
    if (query && !normalizeHeader(row.name).includes(normalized) && !normalizeHeader(row.registration).includes(normalized) && !(cpf && row.cpf.includes(cpf))) return false;
    if (severity === "EXCEPTIONS" ? row.severity === "OK" : severity && row.severity !== severity) return false;
    if (employeeStatus && row.employeeStatus !== employeeStatus) return false;
    if (Object.entries(allocation).some(([key, value]) => value && row[key as keyof typeof allocation] !== value)) return false;
    return row.findings.some(finding => (!findingCode || finding.code === findingCode) && (!reviewStatus || (reviewMap.get(reviewKey(row.key, finding.code))?.status ?? "PENDENTE") === reviewStatus)) || (!findingCode && !reviewStatus && !row.findings.length);
  }), [result, metric, query, severity, employeeStatus, findingCode, reviewStatus, allocation, reviewMap]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 25));
  const safePage = Math.min(page, totalPages);
  const chosen = selected?.requestKey === requestKey ? result?.rows.find(row => row.key === selected.key) ?? null : null;
  const findings = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of result?.rows ?? []) for (const finding of row.findings) options.set(finding.code, finding.label);
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [result]);
  const setCurrent = (value: string) => {
    setCurrentMonth(value); setPage(1);
  };
  const applyLimits = () => {
    const pct = Number(limits.percentage.replace(",", ".")); const abs = Number(limits.absolute.replace(",", "."));
    const ded = Number(limits.deductionsPercentage.replace(",", "."));
    if (!limits.percentage.trim() || !limits.absolute.trim() || !Number.isFinite(pct) || pct < 0 || !Number.isFinite(abs) || abs < 0) { app.toast("warning", "Informe limites válidos"); return; }
    if (!limits.deductionsPercentage.trim() || !Number.isFinite(ded) || ded < 0 || ded > 100) { app.toast("warning", "O limite de descontos deve estar entre 0 e 100%"); return; }
    setRules(value => ({ ...value, percentage: pct, absolute: abs, deductionsPercentage: ded })); setPage(1);
  };
  const clearFilters = () => {
    setMetric(null); setQuery(""); setSeverity(""); setEmployeeStatus(""); setFindingCode(""); setReviewStatus("");
    setAllocation({ company: "", unit: "", costCenter: "", department: "", jobTitle: "" }); setPage(1);
  };
  const selectMetric = (key: AuditMetric) => {
    clearFilters();
    if (metric !== key) {
      setMetric(key);
      setSeverity(({ ok: "OK", attention: "ATENCAO", critical: "CRITICO", information: "INFORMACAO" } as Partial<Record<AuditMetric, string>>)[key] ?? "");
    }
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const exportData = async (kind: "xlsx" | "csv" | "pdf") => {
    setExportBusy(true);
    try {
      await exportPayrollAudit(filtered, app.settings.maskCpf, reviews, `${currentMonth}_vs_${referenceMonths.join("_") || "sem-referencia"}_liquido`, kind);
      app.addAudit({ operation: "Exportou Conferência de folha", module: "Conferência", result: `${currentMonth}: ${filtered.length} registros`, status: "SUCESSO", processedCount: filtered.length });
    } catch (caught) { app.toast("error", "Não foi possível exportar", caught instanceof Error ? caught.message : undefined); }
    finally { setExportBusy(false); }
  };
  const updateReview = async (review: Pick<AuditReview, "employeeKey" | "ruleCode" | "status" | "notes">) => {
    if (!context) throw new Error("Aguarde o carregamento do tratamento dos achados.");
    const saved = await saveAuditReview(context, app.user, review);
    setReviewState(state => state?.key === reviewRequestKey ? { ...state, reviews: [...state.reviews.filter(item => reviewKey(item.employeeKey, item.ruleCode) !== reviewKey(saved.employeeKey, saved.ruleCode)), saved] } : state);
    app.addAudit({ operation: "Tratou achado de folha", module: "Conferência", result: `${currentMonth}: ${reviewLabels[saved.status]}`, status: "SUCESSO" });
    app.toast("success", "Tratamento salvo");
  };

  const syncQuark = async () => {
    setSyncingEmployees(true);
    try {
      const synced = await syncEmployeesFromQuark();
      app.addAudit({ operation: "Sincronizou QuarkRH para Conferência", module: "Conferência", result: `${synced.received} recebidos · ${synced.updated} atualizados`, status: synced.skipped ? "AVISO" : "SUCESSO", processedCount: synced.received });
      app.toast("success", "Cadastro do QuarkRH atualizado", "A conferência será recalculada com a situação atual dos funcionários.");
      setReload(value => value + 1);
    } catch (caught) { app.toast("error", "Não foi possível sincronizar o QuarkRH", caught instanceof Error ? caught.message : undefined); }
    finally { setSyncingEmployees(false); }
  };
  if (app.user.role === "CONSULTA") return <EmptyState title="Acesso restrito" description="A Conferência de folha está disponível para RH e Administradores." />;
  if (app.payrollLoading && !app.payrollMonths.length) return <EmptyState title="Carregando competências..." description="Consultando as folhas importadas." />;
  if (!app.payrollMonths.length) return <EmptyState icon={<ClipboardCheck />} title="Importe a primeira folha para conferir" description="Use Dados da Folha → Importações → Importar Folha de Pagamento. A mesma folha será utilizada aqui." action={<button className="button primary" onClick={onImport}>Ir para Importações</button>} />;
  const summary = result?.summary;
  const lastQuarkSync = data?.employees.filter(employee => employee.source === "QUARK" && employee.lastSyncedAt).map(employee => employee.lastSyncedAt!).sort().at(-1);
  return <div className="stack-gap payroll-audit">
    <div className="page-heading compact"><div><h2>Conferência</h2><p>Auditoria pré-fechamento das folhas importadas.</p></div><div className="audit-actions"><button className="button secondary" onClick={onImport}>Importar folha</button><button className="button secondary" disabled={loading || syncingEmployees} onClick={() => setReload(value => value + 1)}><RefreshCw size={15} /> Atualizar</button><button className="button secondary" disabled={loading || syncingEmployees} onClick={() => void syncQuark()}><RefreshCw size={15} /> {syncingEmployees ? "Sincronizando..." : "Sincronizar QuarkRH"}</button></div></div>
    <section className="surface audit-controls" aria-label="Selecionar competências e regras"><div className="audit-control-grid">
      <label className="field"><span>Competência atual</span><select value={currentMonth} onChange={event => setCurrent(event.target.value)}>{app.payrollMonths.map(month => <option key={month.id} value={month.competence}>{month.competence}</option>)}</select></label>
      <label className="field"><span>Meses anteriores para comparar</span><select value={comparisonMonths} onChange={event => { setComparisonMonths(Number(event.target.value)); setPage(1); }}>{[1, 2, 3].map(months => <option key={months} value={months}>Até {months} {months === 1 ? "mês anterior" : "meses anteriores"}</option>)}</select></label>
      <label className="field"><span>Valor comparado</span><input value="Líquido (sempre)" readOnly /></label>
      <label className="field"><span>Variação acima de (%)</span><input inputMode="decimal" value={limits.percentage} onChange={event => setLimits(value => ({ ...value, percentage: event.target.value }))} /></label>
      <label className="field"><span>E diferença acima de (R$)</span><input inputMode="decimal" value={limits.absolute} onChange={event => setLimits(value => ({ ...value, absolute: event.target.value }))} /></label>
      <label className="field"><span>Descontos acima de (% do bruto)</span><input inputMode="decimal" value={limits.deductionsPercentage} onChange={event => setLimits(value => ({ ...value, deductionsPercentage: event.target.value }))} /></label>
      <button className="button secondary" onClick={applyLimits}>Aplicar limites</button>
    </div><small>O comparativo é sempre do líquido atual com cada folha disponível nos {comparisonMonths} {comparisonMonths === 1 ? "mês anterior" : "meses anteriores"}, sem média e sem substituir meses ausentes por folhas mais antigas. Salário-base é opcional. Variação exige percentual e diferença em R$. Descontos são conferidos separadamente sobre o bruto, com alerta acima de {rules.deductionsPercentage ?? 50}% (critério de revisão, não limite legal). Nenhum valor da folha é alterado.</small></section>
    {!previousMonth && <div className="audit-notice">Nenhuma folha disponível no período anterior selecionado. As regras da folha atual continuam disponíveis. Importe as competências em Dados da Folha → Importações para comparar o líquido.</div>}
    {loading && <div className="audit-notice" role="status">Carregando folhas e cadastro para a conferência...</div>}
    {error && <div className="audit-notice error" role="alert">{error}<button className="button secondary" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div>}
    {summary && <>
      <div className="audit-notice">Os CPFs da folha são cruzados com o cadastro de funcionários. A situação do QuarkRH é atual{lastQuarkSync ? `, sincronizada em ${new Date(lastQuarkSync).toLocaleString("pt-BR")}` : "; sincronização ainda não informada"}. Para competências anteriores, confira admissão e desligamento: o status atual não comprova a situação histórica.</div>
      <div className="metrics-grid"><MetricCard label="TOTAL ATUAL · LÍQUIDO" value={money(summary.currentTotal)} detail={`${summary.currentKnown} de ${summary.processed} valores disponíveis`} /><MetricCard label="TOTAL ANTERIOR · LÍQUIDO" value={money(summary.previousTotal)} detail={previousMonth || "Sem referência"} /><MetricCard label="DIFERENÇA EM R$" value={money(summary.difference)} detail={previousMonth ? `Referência mais recente: ${previousMonth}` : "Sem referência"} /><MetricCard label="VARIAÇÃO DO LÍQUIDO" value={percentage(summary.variation)} /></div>
      <div className="audit-notice">Comparações individuais: {referenceMonths.length ? referenceMonths.join(" · ") : "sem folha anterior importada"}. Totais, novos e ausentes usam a referência mais recente disponível{previousMonth ? ` (${previousMonth})` : ""}. Os achados de variação e o detalhamento também consideram os demais meses do período.</div>
      <div className="audit-counts" role="group" aria-label="Filtrar por indicador">{metricCards.map(card => <button type="button" className={`${card.tone} ${metric === card.key ? "active" : ""}`} key={card.key} aria-pressed={metric === card.key} aria-label={`${card.label}: ${summary[card.key]}`} title={`Filtrar: ${card.label}. Clique novamente para mostrar todos.`} onClick={() => selectMetric(card.key)}><strong>{summary[card.key]}</strong><span>{card.label}</span></button>)}</div>
      <small className="audit-metric-help">Clique em um indicador para filtrar a lista. Os contadores representam a competência inteira; alguns grupos se sobrepõem.</small>
      <details className="surface audit-coverage"><summary>Cobertura das regras e dados disponíveis</summary><p>Um valor não informado aparece como “—”. Folhas antigas precisam ser reimportadas para incluir base, bruto e eventos. Ao atualizar uma competência, os comparativos de Saúde e Odonto precisam ser refeitos, conforme o fluxo atual do sistema.</p><div>{result!.coverage.map(item => <article key={item.label}><strong>{item.label}: {item.available}/{item.total}</strong><span>{item.note}</span></article>)}</div></details>
      {reviewError && <div className="audit-notice error" role="alert">A conferência está disponível, mas o tratamento dos achados não carregou: {reviewError}</div>}
      <section ref={tableRef} className="surface table-surface audit-results" aria-label="Resultados da conferência"><div className="audit-filter-grid">
        <label className="search-box"><Search size={16} /><input aria-label="Pesquisar funcionário" placeholder="Nome, CPF ou matrícula" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
        <label className="field"><span>Classificação</span><select value={severity} onChange={event => { setMetric(null); setSeverity(event.target.value); setPage(1); }}><option value="EXCEPTIONS">Somente exceções</option><option value="">Todas</option>{Object.entries(severityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field"><span>Situação cadastral atual</span><select value={employeeStatus} onChange={event => { setEmployeeStatus(event.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(employeeStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field"><span>Tipo de achado</span><select value={findingCode} onChange={event => { setFindingCode(event.target.value); setPage(1); }}><option value="">Todos</option>{findings.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field"><span>Tratamento</span><select value={reviewStatus} onChange={event => { setReviewStatus(event.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(reviewLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {([["company", "Empresa"], ["unit", "Unidade / filial"], ["costCenter", "Centro de custo"], ["department", "Setor"], ["jobTitle", "Cargo"]] as const).map(([key, label]) => <label className="field" key={key}><span>{label}</span><select value={allocation[key]} onChange={event => { setAllocation(value => ({ ...value, [key]: event.target.value })); setPage(1); }}><option value="">Todos</option>{[...new Set(result!.rows.map(row => row[key]).filter(Boolean))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
      </div><div className="table-toolbar"><span aria-live="polite">{filtered.length} de {summary.total} colaboradores · {metric ? `Filtro rápido: ${metricCards.find(card => card.key === metric)!.label}` : "exceções primeiro"}</span><div className="audit-actions"><button className="button secondary" onClick={clearFilters}>Limpar filtros</button>{(["xlsx", "csv", "pdf"] as const).map(kind => <button key={kind} className="button secondary" disabled={exportBusy || !filtered.length || app.settingsLoading} onClick={() => void exportData(kind)}><Download size={14} /> {kind.toUpperCase()}</button>)}</div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Colaborador</th><th>CPF</th><th>Situação cadastral atual</th><th>Setor / unidade</th><th className="right">Líquido {previousMonth || "anterior"}</th><th className="right">Líquido {currentMonth}</th><th className="right">Diferença</th><th className="right">Variação</th><th className="right">Descontos / bruto</th><th>Classificação / achados</th><th>Ação</th></tr></thead><tbody>{filtered.slice((safePage - 1) * 25, safePage * 25).map(row => <tr key={row.key} className={row.severity === "CRITICO" ? "row-danger" : row.severity === "ATENCAO" ? "row-warning" : ""}>
        <td><button className="audit-name" onClick={() => setSelected({ key: row.key, requestKey })}>{row.name}</button>{row.registration && <small>Matrícula {row.registration}</small>}</td><td className="mono">{formatCpf(row.cpf, app.settings.maskCpf)}</td>
        <td><span className={`status-badge ${row.employeeStatus === "ATIVO" ? "success" : row.employeeStatus === "DESLIGADO" ? "neutral" : "warning"}`}>{employeeStatusLabels[row.employeeStatus]}</span><small>{row.employee ? row.employee.source === "QUARK" ? "QuarkRH" : "Manual" : "CPF sem correspondência"}</small></td>
        <td>{row.department || "—"}<small>{row.unit}</small></td><td className="right">{money(row.previousValue)}</td><td className="right">{money(row.currentValue)}</td><td className="right">{money(row.difference)}</td><td className="right">{percentage(row.variation)}</td><td className="right">{percentage(deductionsPercentage(row.current))}</td><td><span className={`status-badge ${severityTone[row.severity]}`}>{severityLabels[row.severity]}</span><small>{row.findings.slice(0, 2).map(item => item.label).join(" · ")}{row.findings.length > 2 && ` +${row.findings.length - 2}`}</small></td><td><button className="button secondary small" onClick={() => setSelected({ key: row.key, requestKey })}>Conferir</button></td>
      </tr>)}</tbody></table>{!filtered.length && <div className="table-empty">Nenhum colaborador nos filtros atuais. Selecione “Todas” para visualizar os registros OK.</div>}</div>
      <div className="pagination"><span>Página {safePage} de {totalPages}</span><div><button disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Anterior</button><button disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Próxima</button></div></div></section>
    </>}
    {chosen && <AuditDetail key={`${chosen.key}:${requestKey}`} row={chosen} currentMonth={currentMonth} previousMonth={previousMonth} months={comparisonMonths} reviews={reviewMap} canReview={Boolean(context) && !app.settingsLoading} onReview={updateReview} onClose={() => setSelected(null)} />}
  </div>;
}

function AuditDetail({ row, currentMonth, previousMonth, months, reviews, canReview, onReview, onClose }: { row: AuditRow; currentMonth: string; previousMonth: string; months: number; reviews: Map<string, AuditReview>; canReview: boolean; onReview: (review: Pick<AuditReview, "employeeKey" | "ruleCode" | "status" | "notes">) => Promise<void>; onClose: () => void }) {
  const app = useApp();
  const [history, setHistory] = useState<AuditHistoryMonth[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void loadEmployeePayrollHistory(row.cpf, currentMonth, months).then(items => { if (!cancelled) setHistory(items); }).catch(caught => { if (!cancelled) setHistoryError(caught instanceof Error ? caught.message : "Histórico indisponível."); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [row.cpf, currentMonth, months]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [onClose]);
  const events = detailEvents(row);
  return <div className="modal-backdrop audit-backdrop"><section className="modal audit-detail" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><div className="section-header"><div><h3 id="audit-detail-title">{row.name}</h3><p>{formatCpf(row.cpf, app.settings.maskCpf)} · {currentMonth} {previousMonth && `vs ${previousMonth}`}</p></div><button className="button secondary" aria-label="Fechar conferência" onClick={onClose}><X size={18} /></button></div><div className="audit-detail-body">
    <div className="audit-notice">Dados financeiros permanecem como importados. Justificar ou marcar como corrigida registra sua análise.</div>
    <div className="audit-notice">Descontos atuais: <strong>{money(row.current?.audit?.deductions ?? null)}</strong> · Bruto: <strong>{money(auditValue(row.current, "gross"))}</strong> · Proporção: <strong>{percentage(deductionsPercentage(row.current))}</strong>.<br />A proporção usa os proventos totais, não o líquido. “—” indica totais indisponíveis ou bruto não positivo; salário-base não é obrigatório.</div>
    <div className="audit-notice">Situação cadastral atual: <strong>{employeeStatusLabels[row.employeeStatus]}</strong>{row.employee && <> · Origem: {row.employee.source === "QUARK" ? "QuarkRH" : "Manual"}.<br />Admissão: {row.employee.admissionDate || "não informada"} · Desligamento: {row.employee.terminationDate || "não informado"}.{row.employee.source === "QUARK" && <> Última sincronização: {row.employee.lastSyncedAt ? new Date(row.employee.lastSyncedAt).toLocaleString("pt-BR") : "não informada"}.</>}</>}<br />Situação informada na folha: {row.current?.audit?.employmentStatus || "não informada"}. O cadastro atual não substitui as datas do vínculo na competência.</div>
    <h4>Achados para conferência</h4>{row.findings.length ? row.findings.map(finding => <FindingReview key={`${finding.code}:${reviews.get(reviewKey(row.key, finding.code))?.updatedAt ?? "pending"}:${canReview}`} employeeKey={row.key} finding={finding} review={reviews.get(reviewKey(row.key, finding.code))} canReview={canReview} onReview={onReview} />) : <p>Nenhum achado nas regras com dados disponíveis.</p>}
    <h4>Comparativo do líquido · até {months} {months === 1 ? "mês anterior" : "meses anteriores"}</h4><p>Líquido atual ({currentMonth}): <strong>{money(row.currentValue)}</strong>. Cada referência é comparada separadamente, sem média.</p><div className="table-scroll"><table className="data-table audit-liquid-history"><thead><tr><th>Competência de referência</th><th className="right">Líquido anterior</th><th className="right">Líquido atual</th><th className="right">Diferença</th><th className="right">Variação</th></tr></thead><tbody>{comparisonCompetences(currentMonth, months).map(competence => {
      const comparison = row.liquidComparisons.find(item => item.competence === competence);
      return <tr key={competence}><td>{competence}{!comparison && <small>Folha não importada</small>}{comparison && comparison.value === null && <small>CPF ou líquido não disponível</small>}</td><td className="right">{money(comparison?.value ?? null)}</td><td className="right">{money(row.currentValue)}</td><td className="right">{money(comparison?.difference ?? null)}</td><td className="right">{percentage(comparison?.variation ?? null)}</td></tr>;
    })}</tbody></table></div>
    <h4>Comparativo detalhado de eventos</h4><div className="table-scroll"><table className="data-table"><thead><tr><th>Evento</th><th className="right">{previousMonth || "Anterior"}</th><th className="right">{currentMonth}</th><th className="right">Diferença</th></tr></thead><tbody>{events.map(event => <tr key={event.key}><td>{event.label}</td><td className="right">{money(event.previous)}</td><td className="right">{money(event.current)}</td><td className="right">{money(event.difference)}</td></tr>)}</tbody></table></div><small>“—” indica dado não informado ou evento ausente da planilha, não valor zero.</small>
    {!!row.current?.audit?.occurrences.length && <p>Origem: {row.current.audit.occurrences.map(item => `${item.sheet}, linha ${item.row}`).join(" · ")}</p>}
    <h4>Composição das folhas disponíveis</h4>
    {historyLoading ? <p role="status">Carregando histórico...</p> : historyError ? <p role="alert">{historyError}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Competência</th><th>Base (opcional)</th><th>Bruto</th><th>Líquido</th><th>Descontos</th><th>Horas extras</th><th>Comissão</th><th>Adicionais</th><th>Benefícios</th></tr></thead><tbody>{history.map(item => <tr key={item.competence}><td>{item.competence}</td><td>{money(auditValue(item.record, "baseSalary"))}</td><td>{money(auditValue(item.record, "gross"))}</td><td>{money(auditValue(item.record, "liquid"))}</td><td>{money(item.record.audit?.deductions ?? null)}</td><td>{money(eventTotal(item.record.audit, "overtime"))}</td><td>{money(eventTotal(item.record.audit, "commission"))}</td><td>{money(eventTotal(item.record.audit, "additional"))}</td><td>{money(eventTotal(item.record.audit, "benefit"))}</td></tr>)}</tbody></table>{!history.length && <div className="table-empty">Nenhuma competência disponível para este CPF.</div>}</div>}
    <small>Competência atual e até {months} {months === 1 ? "mês anterior" : "meses anteriores"}. Bruto, base e eventos são informações de apoio; o comparativo principal é sempre do líquido.</small>
  </div></section></div>;
}

function FindingReview({ employeeKey, finding, review, canReview, onReview }: { employeeKey: string; finding: AuditRow["findings"][number]; review?: AuditReview; canReview: boolean; onReview: (review: Pick<AuditReview, "employeeKey" | "ruleCode" | "status" | "notes">) => Promise<void> }) {
  const app = useApp();
  const notesHelpId = useId();
  const [status, setStatus] = useState<AuditReview["status"]>(review?.status ?? "PENDENTE");
  const [notes, setNotes] = useState(review?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await onReview({ employeeKey, ruleCode: finding.code, status, notes }); }
    catch (caught) { app.toast("error", "Não foi possível salvar", caught instanceof Error ? caught.message : undefined); }
    finally { setBusy(false); }
  };
  return <article className="audit-finding"><span className={`status-badge ${severityTone[finding.severity]}`}>{severityLabels[finding.severity]}</span><strong>{finding.label}</strong><p>{finding.explanation}</p><div className="audit-review-form"><label className="field"><span>Tratamento</span><select disabled={!canReview || busy} value={status} onChange={event => setStatus(event.target.value as AuditReview["status"])}>{Object.entries(reviewLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="audit-notes"><label className="field"><span>Observação / justificativa</span><textarea aria-describedby={notesHelpId} maxLength={4000} rows={4} disabled={!canReview || busy} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Escreva aqui o motivo e a providência tomada..." /></label><small id={notesHelpId}>Justificativa obrigatória para concluir a análise. <span>{notes.length}/4000</span></small></div><button className="button secondary" disabled={!canReview || busy} onClick={() => void save()}>{busy ? "Salvando..." : "Salvar análise"}</button></div>{review && <small>Responsável: {review.updatedByName || "Integrante do RH"} · {new Date(review.updatedAt).toLocaleString("pt-BR")}</small>}</article>;
}
