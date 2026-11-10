"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, History, RefreshCw, Search, X } from "lucide-react";
import { defaultMealPeriod, mealCalculationNote, mealDailyRate, mealGroupLabels, mealPeriod, normalizeMealText, type MealEvent, type MealRow } from "../../../supabase/functions/_shared/meal-domain";
import type { MealRateVersion } from "../../../supabase/functions/_shared/meal-policy";
import { listMealRates } from "../../../src/services/meal-rates";
import { currentMealEmployees, listMealEmployeeEvents, listMealRows, listMealRuns, syncMealPeriod, type MealRun } from "../../../src/services/benefit-meal";
import { exportMealReport } from "../../../src/services/benefit-meal-export";
import { formatCpf } from "../../../src/utils/cpf";
import { MetricCard, StatusBadge } from "../components/Common";
import { MultiSelectFilter } from "../components/MultiSelectFilter";
import { useApp } from "../state/AppContext";
import { MealRatePanel } from "./MealRatePanel";
import "./meal-benefit.css";

const dateLabel = (value: string) => value.split("-").reverse().join("/");
const monthLabel = (value: string) => value.slice(0, 7).split("-").reverse().join("/");
const timeLabel = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Em andamento";
const runLabel = (run: MealRun) => run.status === "SUCCESS" ? "Consulta concluída" : run.status === "PARTIAL" ? "Consulta parcial" : run.status === "ERROR" ? "Falha na consulta" : "Em andamento";
const countLabel = (value: number | null) => value === null ? "Não consultado" : String(value);
const situationOptions = [{ value: "ATIVO", label: "Ativos" }, { value: "DESLIGADO", label: "Desligados" }];
const currency = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pendingReason = (row: MealRow) => row.calculation_version == null ? "Consulta anterior às regras atuais" : row.issues.length ? "Conferir ocorrências" : row.daily_value === null ? "Regra a definir" : row.planned_work_days === null ? "Dias de trabalho a definir" : "Aguardando fechamento / conferência";

export function MealBenefitModule() {
  const app = useApp();
  const initial = useMemo(() => defaultMealPeriod(), []);
  const [start, setStart] = useState(initial.start), [end, setEnd] = useState(initial.end);
  const [tab, setTab] = useState<"period" | "history">("period");
  const [run, setRun] = useState<MealRun | null>(null), [attempt, setAttempt] = useState<MealRun | null>(null);
  const [rows, setRows] = useState<MealRow[]>([]), [history, setHistory] = useState<MealRun[]>([]);
  const [rates, setRates] = useState<MealRateVersion[] | undefined>(), [rateError, setRateError] = useState("");
  const [loading, setLoading] = useState(true), [syncing, setSyncing] = useState(false), [phase, setPhase] = useState("");
  const [backendReady, setBackendReady] = useState(false);
  const [error, setError] = useState(""), [historyError, setHistoryError] = useState("");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<string[]>([]), [city, setCity] = useState<string[]>([]), [status, setStatus] = useState<string[]>(["ATIVO"]);
  const [page, setPage] = useState(1), [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<MealRow | null>(null), [events, setEvents] = useState<MealEvent[]>([]), [eventError, setEventError] = useState("");
  const [historyMore, setHistoryMore] = useState(false), [historyBusy, setHistoryBusy] = useState(false);
  const revision = useRef(0), historyRevision = useRef(0), syncLock = useRef(false);
  const period = useMemo(() => { try { return mealPeriod(start, end); } catch { return null; } }, [start, end]);

  const load = useCallback((preferredId?: string) => {
    const request = ++revision.current;
    if (!period) return Promise.resolve();
    const policy = listMealRates(period.benefitMonth).then(data => ({ data: data as MealRateVersion[] | undefined, error: "" })).catch(caught => ({ data: (caught as { needsInstall?: boolean })?.needsInstall ? undefined : [] as MealRateVersion[], error: caught instanceof Error ? caught.message : "Não foi possível carregar os valores." }));
    return Promise.all([listMealRuns(period), policy]).then(async ([runs, policy]) => {
      if (request !== revision.current) return;
      const saved = runs.find(item => item.id === preferredId && ["SUCCESS", "PARTIAL"].includes(item.status)) ?? runs.find(item => ["SUCCESS", "PARTIAL"].includes(item.status));
      const data = saved ? await listMealRows(saved.id) : await currentMealEmployees(period, policy.data);
      if (request === revision.current) { setRun(saved ?? null); setAttempt(runs[0] ?? null); setRows(data); setPage(1); setRates(policy.data); setRateError(policy.error); setBackendReady(true); }
    }).catch(async caught => {
      if (request === revision.current) {
        setError(caught instanceof Error ? caught.message : "Não foi possível carregar o período.");
        try { const preview = await currentMealEmployees(period); if (request === revision.current) setRows(preview); } catch { /* Keep the database error visible. */ }
      }
    }).finally(() => { if (request === revision.current) setLoading(false); });
  }, [period]);
  function prepareLoad(nextStart = start, nextEnd = end) {
    let valid = false; try { mealPeriod(nextStart, nextEnd); valid = true; } catch { /* Validation is displayed beside the period. */ }
    setLoading(valid); setBackendReady(false); setError(""); setRun(null); setAttempt(null); setRows([]); setDetail(null);
  }
  async function reload(preferredId?: string) { prepareLoad(); await load(preferredId); }
  useEffect(() => { void load(); return () => { revision.current += 1; }; }, [load]);
  useEffect(() => {
    if (tab !== "history") return;
    const request = ++historyRevision.current;
    void listMealRuns().then(data => { if (request === historyRevision.current) { setHistory(data); setHistoryMore(data.length === 50); } }).catch(caught => { if (request === historyRevision.current) setHistoryError(caught instanceof Error ? caught.message : "Não foi possível carregar o histórico."); }).finally(() => { if (request === historyRevision.current) setHistoryBusy(false); });
    return () => { historyRevision.current += 1; };
  }, [tab]);
  useEffect(() => {
    if (!detail || !run) return;
    let active = true;
    void listMealEmployeeEvents(run.id, detail.employee_id).then(data => { if (active) setEvents(data); }).catch(caught => { if (active) setEventError(caught instanceof Error ? caught.message : "Não foi possível carregar as ocorrências."); });
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", close);
    return () => { active = false; window.removeEventListener("keydown", close); };
  }, [detail, run]);

  const companies = useMemo(() => [...new Set(rows.map(row => row.company))].sort(), [rows]);
  const cities = useMemo(() => [...new Set(rows.map(row => row.city))].sort(), [rows]);
  const filtered = useMemo(() => {
    const name = normalizeMealText(query), cpf = query.replace(/\D/g, "");
    return rows.filter(row => (!company.length || company.includes(row.company)) && (!city.length || city.includes(row.city)) && (!status.length || status.includes(row.employment_status)) && (!name || normalizeMealText(row.employee_name).includes(name) || Boolean(cpf && row.cpf.includes(cpf))));
  }, [rows, query, company, city, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50)), visible = filtered.slice((Math.min(page, pages) - 1) * 50, Math.min(page, pages) * 50);
  const absence = filtered.reduce((sum, row) => sum + (row.absence_days ?? 0), 0), medical = filtered.reduce((sum, row) => sum + (row.medical_days ?? 0), 0);
  const unknownAbsence = filtered.filter(row => row.absence_days === null).length, unknownMedical = filtered.filter(row => row.medical_days === null).length;
  const calculated = filtered.filter(row => row.calculation_status === "READY" && row.amount_due !== null);
  const total = calculated.reduce((sum, row) => sum + Math.round(row.amount_due! * 100), 0) / 100;
  const showsCurrentRates = tab === "period" && filtered.some(row => mealDailyRate(row, true, rates, period?.benefitMonth).preview);
  const resetPage = () => setPage(1);

  async function sync() {
    if (!period || !backendReady || syncLock.current) return;
    syncLock.current = true; setSyncing(true);
    try {
      const result = await syncMealPeriod(period, setPhase);
      await reload(result.runId);
      app.addAudit({ operation: "Atualizou Vale Alimentação pelo QuarkRH", module: "Benefícios", result: `${dateLabel(period.start)} a ${dateLabel(period.end)}; benefício ${monthLabel(period.benefitMonth)}; ${result.rows} funcionário(s). Valores diários e pendências de cálculo salvos na versão.`, status: "SUCESSO", processedCount: result.rows });
      app.toast("success", "Consulta salva no histórico", "Confira a cobertura e as pendências antes de usar os dados.");
    } catch (caught) { app.toast("error", "Não foi possível atualizar o Vale Alimentação", caught instanceof Error ? caught.message : undefined); }
    finally { syncLock.current = false; setSyncing(false); setPhase(""); }
  }
  async function exportReport(kind: "pdf" | "xlsx") {
    if (!run) return;
    setExporting(true);
    try {
      await exportMealReport(run, filtered, app.settings.maskCpf, kind, [company.length ? `Empresas: ${company.join(", ")}` : "Todas as empresas", city.length ? `Cidades: ${city.join(", ")}` : "Todas as cidades", status.length ? `Situações: ${situationOptions.filter(option => status.includes(option.value)).map(option => option.label).join(", ")}` : "Todas as situações", query ? `Busca: ${query}` : ""].filter(Boolean).join("; "), tab === "period", rates);
      app.addAudit({ operation: `Exportou Vale Alimentação em ${kind.toUpperCase()}`, module: "Benefícios", result: `${filtered.length} funcionário(s), versão ${timeLabel(run.completed_at)}. ${calculated.length} calculado(s); ${filtered.length - calculated.length} pendente(s).`, status: "SUCESSO", processedCount: filtered.length });
    } catch (caught) { app.toast("error", "Não foi possível exportar", caught instanceof Error ? caught.message : undefined); }
    finally { setExporting(false); }
  }
  async function openHistory(item: MealRun) {
    if (!["SUCCESS", "PARTIAL"].includes(item.status)) return;
    const request = ++revision.current; setLoading(true); setError("");
    try {
      const data = await listMealRows(item.id);
      if (request !== revision.current) return;
      // Date changes reload the newest version, so keep an explicit historical view.
      setRun(item); setAttempt(item); setRows(data); setCompany([]); setCity([]); setStatus(["ATIVO"]); setQuery(""); setPage(1); setDetail(null);
    } catch (caught) { if (request === revision.current) setError(caught instanceof Error ? caught.message : "Não foi possível abrir a versão."); }
    finally { if (request === revision.current) setLoading(false); }
  }
  const viewingDifferentPeriod = Boolean(run && (run.period_start !== start || run.period_end !== end));
  const detailDaily = detail ? mealDailyRate(detail, tab === "period", rates, period?.benefitMonth) : null;
  return <div className="stack-gap meal-benefit">
    <div className="tabs benefit-inner-tabs" role="tablist" aria-label="Vale Alimentação">
      <button role="tab" disabled={syncing} aria-selected={tab === "period"} className={tab === "period" ? "active" : ""} onClick={() => { setTab("period"); void reload(); }}>Apuração por período</button>
      <button role="tab" disabled={syncing} aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => { setHistoryBusy(true); setHistoryError(""); setTab("history"); }}><History size={14} /> Histórico de consultas</button>
    </div>
    <section className="surface meal-period-panel">
      <div><h3>Vale Alimentação</h3><p>Ocorrências do período anterior para o benefício do mês seguinte.</p></div>
      <div className="meal-period-fields">
        <label className="field"><span>Início das ocorrências</span><input type="date" value={start} disabled={syncing} onChange={event => { prepareLoad(event.target.value, end); setStart(event.target.value); }} /></label>
        <label className="field"><span>Fim das ocorrências</span><input type="date" value={end} disabled={syncing} onChange={event => { prepareLoad(start, event.target.value); setEnd(event.target.value); }} /></label>
        <div className="meal-benefit-month"><CalendarDays size={18} /><span>Mês do benefício<strong>{period ? monthLabel(period.benefitMonth) : "Defina o período"}</strong></span></div>
        <button className="button primary" disabled={syncing || loading || !period || !backendReady} onClick={() => void sync()}><RefreshCw size={16} className={syncing ? "spin" : ""} />{syncing ? phase : "Atualizar pelo QuarkRH"}</button>
      </div>
      <p className="meal-help">O mês do benefício é o seguinte ao fim do período. A atualização inclui todos os funcionários cadastrados, não apenas os agregados.</p>
    </section>
    {tab === "period" && period && <MealRatePanel month={period.benefitMonth} rates={rates} loading={loading || syncing} error={rateError} onSaved={() => reload()} />}
    <div className="meal-pending"><AlertTriangle size={20} /><div><strong>Dias de trabalho dos demais grupos aguardando definição</strong><p>As diárias seguem a configuração vigente no mês do benefício. Estoque/RH de Recife usa sua base fixa, descontando faltas e atestados. Nos demais grupos, o total aguarda os dias previstos de trabalho. Períodos abertos, consultas incompletas e sobreposições continuam pendentes.</p></div></div>
    {tab === "history" && <section className="surface meal-history"><div className="section-header"><div><h3>Histórico de consultas</h3><p>Cada atualização preserva os dados anteriores, inclusive nome, setor e cargo na data da consulta.</p></div></div>{historyError && <p className="meal-error" role="alert">{historyError}</p>}<div className="table-scroll"><table className="data-table"><thead><tr><th>Ocorrências</th><th>Benefício</th><th>Atualizado em</th><th>Responsável</th><th>Funcionários</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{history.map(item => <tr key={item.id}><td>{dateLabel(item.period_start)} a {dateLabel(item.period_end)}</td><td>{monthLabel(item.benefit_month)}</td><td>{timeLabel(item.completed_at)}</td><td>{item.triggered_by_name}</td><td>{item.employee_count}</td><td>{runLabel(item)}{item.error_message && <small>{item.error_message}</small>}</td><td><button className="button secondary" disabled={loading || !["SUCCESS", "PARTIAL"].includes(item.status)} onClick={() => void openHistory(item)}>Consultar versão</button></td></tr>)}</tbody></table></div>{!history.length && <div className="table-empty">{historyBusy ? "Carregando histórico..." : "Nenhuma consulta salva ainda."}</div>}{historyMore && <button className="button secondary" disabled={historyBusy} onClick={() => { setHistoryBusy(true); void listMealRuns(undefined, history.length).then(data => { setHistory(current => [...current, ...data]); setHistoryMore(data.length === 50); }).catch(caught => setHistoryError(caught instanceof Error ? caught.message : "Falha ao carregar.")).finally(() => setHistoryBusy(false)); }}>Carregar mais versões</button>}</section>}
    {(error || !period) && <div className="meal-error" role="alert"><p>{error || "Informe um período válido, com início anterior ou igual ao fim (até 366 dias)."}</p><button className="button secondary" disabled={loading || syncing} onClick={() => void reload()}>Tentar carregar novamente</button></div>}
    <section className="surface meal-sync-info" role="status">
      {run ? <><strong>{tab === "history" ? "Versão consultada" : "Última consulta salva"}: {timeLabel(run.completed_at)} por {run.triggered_by_name}</strong><p>{dateLabel(run.period_start)} a {dateLabel(run.period_end)} · benefício {monthLabel(run.benefit_month)} · {runLabel(run)} · dados consultados até {dateLabel(run.queried_through)}.</p>{run.warnings.map((warning, index) => <p className="meal-warning" key={index}>{warning}</p>)}{viewingDifferentPeriod && <p className="meal-warning">Esta versão histórica tem período diferente dos campos acima. Alterar os campos ou usar a aba Apuração carrega a consulta mais recente.</p>}</> : <><strong>{loading ? "Carregando período..." : "Prévia do cadastro, ainda sem consulta salva para este período"}</strong><p>Faltas e atestados só recebem números após a consulta. Valores ausentes não são considerados zero.</p></>}
      {attempt?.status === "ERROR" && attempt.id !== run?.id && <p className="meal-warning">A tentativa mais recente falhou. A última versão disponível foi preservada.</p>}
      {tab === "period" && run && <button className="button secondary" disabled={loading || syncing} onClick={() => void reload()}>Recarregar versão mais recente</button>}
    </section>
    {showsCurrentRates && <div className="surface meal-rate-reference" role="note"><strong>Diárias atuais como referência</strong><p>Esta consulta foi salva antes das novas regras. A diária já aparece pela cidade, setor e cargo, identificada como <b>Regra atual</b>. Dias e totais salvos continuam preservados. Use <b>Atualizar pelo QuarkRH</b> para salvar uma nova versão com as regras atuais.</p></div>}
    <div className="metrics-grid four">
      <MetricCard label="FUNCIONÁRIOS" value={filtered.length} detail="ativos e desligados nos filtros" />
      <MetricCard label="FALTAS CONFIRMADAS" value={unknownAbsence === filtered.length && filtered.length ? "—" : absence} detail={`${unknownAbsence} funcionário(s) com consulta pendente`} tone="warning" />
      <MetricCard label="ATESTADOS CONFIRMADOS" value={unknownMedical === filtered.length && filtered.length ? "—" : medical} detail={`${unknownMedical} funcionário(s) com consulta pendente`} tone="warning" />
      <MetricCard label="TOTAL CALCULADO" value={calculated.length ? currency(total) : "Pendente"} detail={`${calculated.length} calculado(s) · ${filtered.length - calculated.length} pendente(s) nos filtros`} />
    </div>
    <section className="surface table-surface meal-results">
      <div className="meal-toolbar">
        <div className="meal-filter-grid">
          <label className="meal-filter"><span>Funcionário ou CPF</span><span className="search-box"><Search size={16} /><input aria-label="Pesquisar funcionário ou CPF" placeholder="Pesquisar funcionário ou CPF" value={query} onChange={event => { setQuery(event.target.value); resetPage(); }} /></span></label>
          <MultiSelectFilter label="Empresa" allLabel="Todas as empresas" pluralLabel="empresas" options={companies.map(value => ({ value, label: value }))} values={company} onChange={values => { setCompany(values); resetPage(); }} />
          <MultiSelectFilter label="Cidade" allLabel="Todas as cidades" pluralLabel="cidades" options={cities.map(value => ({ value, label: value }))} values={city} onChange={values => { setCity(values); resetPage(); }} />
          <MultiSelectFilter label="Situação" ariaLabel="Situação do funcionário" allLabel="Ativos e desligados" pluralLabel="situações" options={situationOptions} values={status} onChange={values => { setStatus(values); resetPage(); }} />
        </div>
        <div className="meal-export-actions">
          <button className="button secondary" disabled={!run || !filtered.length || exporting || loading} onClick={() => void exportReport("pdf")}><FileDown size={16} /> Exportar PDF</button>
          <button className="button secondary" disabled={!run || !filtered.length || exporting || loading} onClick={() => void exportReport("xlsx")}><FileSpreadsheet size={16} /> Exportar Excel (.xlsx)</button>
        </div>
      </div>
      <p className="meal-help meal-table-note">{filtered.length} funcionário(s). As exportações incluem todos os registros filtrados, não apenas a página atual. Ver detalhes abre a faixa, o cálculo e as ocorrências de cada funcionário.</p>
      <div className="table-scroll meal-list-scroll"><table className="data-table meal-table"><colgroup>{[24, 18, 12, 11, 10, 14, 11].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr><th>Funcionário / CPF</th><th>Setor / Cargo</th><th>Ocorrências</th><th>Dias</th><th>Valor diário</th><th>Valor a receber</th><th>Situação</th></tr></thead><tbody>
        {visible.map(row => {
          const daily = mealDailyRate(row, tab === "period", rates, period?.benefitMonth);
          return <tr key={row.employee_id} className={row.issues.length ? "row-warning" : undefined}>
            <td data-field="employee" data-label="Funcionário" className="meal-person"><strong>{row.employee_name}</strong><small className="mono">{formatCpf(row.cpf, app.settings.maskCpf) || "CPF não informado"}</small><small>{row.company}</small></td>
            <td data-field="role" data-label="Setor / Cargo"><strong>{row.department || "—"}</strong><small>{row.job_title || "—"}</small></td>
            <td data-field="events" data-label="Ocorrências"><dl className="meal-row-facts"><div><dt>Faltas</dt><dd data-metric="absence">{countLabel(row.absence_days)}</dd></div><div><dt>Atestados</dt><dd data-metric="medical">{countLabel(row.medical_days)}</dd></div><div><dt>Descontar</dt><dd data-metric="deduction">{row.deduction_days ?? "Pendente"}</dd></div></dl></td>
            <td data-field="days" data-label="Dias"><dl className="meal-row-facts"><div><dt>Previstos</dt><dd data-metric="planned">{row.planned_work_days ?? "A definir"}</dd></div><div><dt>A pagar</dt><dd data-metric="payable">{row.payable_days ?? "Pendente"}</dd></div></dl></td>
            <td data-field="daily" data-label="Valor diário"><strong className="meal-money">{daily.value === null ? (tab === "history" && row.calculation_version == null ? "Não registrado" : "A definir") : currency(daily.value)}</strong>{daily.preview && <small className="meal-rate-preview">Regra atual</small>}</td>
            <td data-field="amount" data-label="Valor a receber"><strong className={row.amount_due === null ? "meal-pending-value" : "meal-calculated-value"}>{row.amount_due === null ? "Pendente" : currency(row.amount_due)}</strong><small>{row.amount_due === null ? pendingReason(row) : "Calculado"}</small></td>
            <td data-field="details" data-label="Situação" className="meal-row-actions"><StatusBadge status={row.employment_status === "ATIVO" ? "ATIVO" : "DESLIGADO"} /><button className="button secondary" disabled={!run} onClick={() => { setEvents([]); setEventError(""); setDetail(row); }}>Ver detalhes</button>{row.issues.length > 0 && <small>Consulta incompleta</small>}</td>
          </tr>;
        })}
      </tbody></table></div>
      {!visible.length && <div className="table-empty">{loading ? "Carregando funcionários..." : "Nenhum funcionário corresponde aos filtros."}</div>}
      <div className="table-footer"><span>Página {Math.min(page, pages)} de {pages}</span><div><button className="button secondary" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} /></button><button className="button secondary" aria-label="Próxima página" disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={14} /></button></div></div>
    </section>
    {detail && run && <div className="modal-backdrop"><section className="modal meal-events-modal" role="dialog" aria-modal="true" aria-labelledby="meal-events-title"><div className="section-header"><div><h3 id="meal-events-title">Detalhes de {detail.employee_name}</h3><p>{dateLabel(run.period_start)} a {dateLabel(run.period_end)}. Atestados: somente datas e horas, sem diagnóstico.</p></div><button className="icon-plain" aria-label="Fechar ocorrências" onClick={() => setDetail(null)}><X size={20} /></button></div><dl className="meal-detail-facts"><div><dt>Empresa / Cidade</dt><dd>{detail.company} · {detail.city}</dd></div><div><dt>CPF</dt><dd>{formatCpf(detail.cpf, app.settings.maskCpf) || "Não informado"}</dd></div><div><dt>Setor / Cargo</dt><dd>{detail.department || "—"} · {detail.job_title || "—"}</dd></div><div><dt>Faixa</dt><dd>{mealGroupLabels[detail.rate_group] ?? detail.rate_group}</dd></div><div><dt>Valor diário</dt><dd>{detailDaily?.value == null ? "Não registrado / a definir" : currency(detailDaily.value)}{detailDaily?.preview && " · Regra atual, ainda não salva nesta consulta"}</dd></div><div><dt>Dias previstos / a pagar</dt><dd>{detail.planned_work_days ?? "A definir"} / {detail.payable_days ?? "Pendente"}</dd></div></dl><p>{mealCalculationNote(detail)}</p>{eventError && <p className="meal-error" role="alert">{eventError}</p>}<p>{detail.issues.join(" ")}</p><div className="table-scroll"><table className="data-table"><thead><tr><th>Tipo</th><th>Início</th><th>Fim</th><th>Referência QuarkRH</th></tr></thead><tbody>{events.map((event, index) => <tr key={index}><td>{event.event_type === "FALTA" ? "Falta" : "Atestado"}</td><td>{dateLabel(event.start_date)}</td><td>{dateLabel(event.end_date)}</td><td>{event.source_id}</td></tr>)}</tbody></table></div>{!events.length && <p>Nenhuma ocorrência registrada nesta versão. Consulte também a cobertura da API acima.</p>}</section></div>}
  </div>;
}
