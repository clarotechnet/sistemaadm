"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Save, X } from "lucide-react";
import { mealPolicyCities, mealRateDefinitions, parseMealDailyCents, resolveMealRateVersion, type MealRateVersion } from "../../../supabase/functions/_shared/meal-policy";
import { listMealRateHistory, listMealRates, saveMealRates, type MealRateChange } from "../../../src/services/meal-rates";
import { useApp } from "../state/AppContext";

const currency = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const monthLabel = (value: string) => value.slice(0, 7).split("-").reverse().join("/");
const cityLabel = (city: string) => mealPolicyCities.find(item => item.key === city)?.label ?? city;
const inputValue = (value?: number) => value === undefined ? "" : value.toFixed(2).replace(".", ",");

export function MealRatePanel({ month, rates, loading, error, onSaved }: { month: string; rates?: MealRateVersion[]; loading: boolean; error: string; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const app = useApp();
  const canEdit = ["RH", "ADMINISTRADOR"].includes(app.user.role);
  const bands = useMemo(() => {
    const grouped = new Map<string, { label: string; cities: string[]; value: number | null; days: number | null; since: string | null }>();
    for (const definition of mealRateDefinitions) {
      const saved = rates === undefined ? null : resolveMealRateVersion(rates, month, definition.city, definition.group);
      const value = rates === undefined ? definition.initialCents / 100 : saved?.daily_value ?? null;
      const days = rates === undefined ? definition.fixedDays : saved?.fixed_days ?? null;
      const since = saved?.effective_month ?? null;
      const key = [definition.group, value, days, since].join(":");
      const band = grouped.get(key) ?? { label: definition.label, cities: [], value, days, since };
      band.cities.push(cityLabel(definition.city)); grouped.set(key, band);
    }
    return [...grouped.values()];
  }, [rates, month]);
  return <section className="surface meal-rate-panel" aria-busy={loading}>
    <div className="meal-rate-panel-heading"><div><h3>Diárias por cidade</h3><p>Valores para o benefício de {monthLabel(month)}. Reajustes usam o mês de vigência.</p></div>{canEdit && <button className="button secondary" disabled={loading || rates === undefined || Boolean(error)} onClick={() => setEditing(true)}><Pencil size={15} /> Editar valores</button>}</div>
    {error && <p className="meal-warning meal-rate-install-note" role="status">{error}{rates === undefined ? " Os valores já informados pelo RH estão preenchidos como configuração inicial; a instalação habilita sua edição compartilhada." : " Tente carregar os valores novamente."}</p>}
    <details className="meal-rate-rules"><summary>Valores informados pelo RH</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Cidade</th><th>Setor / Cargo</th><th>Valor diário</th><th>Base</th></tr></thead><tbody>{bands.map(band => <tr key={band.cities.join(":") + band.label}>
      <td data-label="Cidade">{band.cities.join(", ")}</td><td data-label="Setor / Cargo">{band.label}</td>
      <td data-label="Valor diário">{band.value === null ? "A definir" : currency(band.value)}{band.since && <small>Desde {monthLabel(band.since)}</small>}</td>
      <td data-label="Base">{band.days === null ? "Dias de trabalho do mês do benefício" : `${band.days} dias × ${currency(band.value!)} = ${currency(band.days * band.value!)} antes dos descontos`}</td>
    </tr>)}</tbody></table></div><p className="meal-help">Recife segue temporariamente o desconto normal de faltas e atestados. A base fixa é própria de estoque/RH; os dias dos demais grupos continuam para definição posterior.</p></details>
    {editing && <MealRateEditor initialMonth={month} onClose={() => setEditing(false)} onSaved={async () => { await onSaved(); setEditing(false); }} />}
  </section>;
}

function MealRateEditor({ initialMonth, onClose, onSaved }: { initialMonth: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const app = useApp();
  const [city, setCity] = useState("NATAL"), [month, setMonth] = useState(initialMonth), [note, setNote] = useState("");
  const [versions, setVersions] = useState<MealRateVersion[]>([]), [history, setHistory] = useState<MealRateVersion[]>([]);
  const [draft, setDraft] = useState<Record<string, { value: string; days: string }>>({});
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const revision = useRef(0), saveLock = useRef(false);
  const definitions = mealRateDefinitions.filter(item => item.city === city);
  useEffect(() => {
    const request = ++revision.current;
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    void Promise.all([listMealRates(month), listMealRateHistory(city)]).then(([data, changes]) => {
      if (request !== revision.current) return;
      setVersions(data); setHistory(changes); setReady(true);
      setDraft(Object.fromEntries(mealRateDefinitions.filter(item => item.city === city).map(definition => {
        const rate = resolveMealRateVersion(data, month, city, definition.group);
        return [definition.group, { value: inputValue(rate?.daily_value), days: rate?.fixed_days == null ? "" : String(rate.fixed_days) }];
      })));
    }).catch(caught => { if (request === revision.current) {
      setReady(false); setError(caught instanceof Error ? caught.message : "Não foi possível carregar os valores.");
      if ((caught as { needsInstall?: boolean })?.needsInstall) setDraft(Object.fromEntries(mealRateDefinitions.filter(item => item.city === city).map(item => [item.group, { value: inputValue(item.initialCents / 100), days: item.fixedDays === null ? "" : String(item.fixedDays) }])));
    } })
      .finally(() => { if (request === revision.current) setLoading(false); });
    return () => { revision.current += 1; };
  }, [city, month, attempt]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saveLock.current) onClose(); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  function changeScope(nextCity: string, nextMonth: string) { setLoading(true); setReady(false); setError(""); setDraft({}); setCity(nextCity); setMonth(nextMonth); }
  function update(group: string, field: "value" | "days", value: string) { setDraft(current => ({ ...current, [group]: { ...current[group], [field]: value } })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (loading || !ready || saveLock.current) return;
    setError("");
    try {
      const changes: MealRateChange[] = [];
      for (const definition of definitions) {
        const current = resolveMealRateVersion(versions, month, city, definition.group), input = draft[definition.group];
        if (!input?.value.trim() && !current) continue;
        const cents = parseMealDailyCents(input?.value ?? "");
        const days = definition.group === "RECIFE_ESTOQUE_RH" ? Number(input.days) : null;
        if (days !== null && (!/^\d+$/.test(input.days) || days < 1 || days > 31)) throw new Error("A base fixa de estoque/RH deve ser de 1 a 31 dias.");
        if (current && Math.round(current.daily_value * 100) === cents && current.fixed_days === days) continue;
        changes.push({ group: definition.group, dailyCents: cents, fixedDays: days, expectedId: current?.id ?? null });
      }
      if (!changes.length) { setError("Nenhum valor foi alterado."); return; }
      saveLock.current = true; setSaving(true);
      const result = await saveMealRates(city, month, changes, note);
      app.addAudit({ operation: "Alterou valores do Vale Alimentação", module: "Benefícios", result: `${cityLabel(city)}; vigência ${monthLabel(month)}; ${result.saved} grupo(s). ${note}`, status: "SUCESSO", processedCount: result.saved });
      await onSaved();
      app.toast("success", "Valores salvos", `${cityLabel(city)} · vigência a partir de ${monthLabel(month)}. Consultas anteriores preservadas.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar os valores."); }
    finally { saveLock.current = false; setSaving(false); }
  }
  return <div className="modal-backdrop"><section className="modal meal-rate-editor" role="dialog" aria-modal="true" aria-labelledby="meal-rate-editor-title">
    <div className="section-header"><div><h3 id="meal-rate-editor-title">Editar valores do Vale Alimentação</h3><p>Salve uma nova vigência por cidade. Meses e consultas anteriores mantêm seus valores.</p></div><button className="icon-plain" disabled={saving} aria-label="Fechar edição de valores" onClick={onClose}><X size={20} /></button></div>
    <form onSubmit={event => void submit(event)}>
      <div className="meal-rate-scope"><label className="field"><span>Cidade dos valores</span><select aria-label="Cidade dos valores" value={city} disabled={saving} onChange={event => changeScope(event.target.value, month)}>{mealPolicyCities.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label className="field"><span>Vigência a partir de</span><input aria-label="Vigência a partir de" type="month" value={month} disabled={saving} onChange={event => changeScope(city, event.target.value)} required /></label></div>
      <p className="meal-help">A vigência considera o mês do benefício. Escolha a cidade e o mês antes de editar. Outros grupos sem regra continuam a definir.</p>
      {loading ? <p role="status">Carregando valores...</p> : <div className="meal-rate-inputs">{definitions.map(definition => <div className={`meal-rate-input-row${definition.fixedDays === null ? "" : " fixed"}`} key={definition.group}><div><strong>{definition.label}</strong><small>{definition.fixedDays === null ? "Dias de trabalho serão definidos posteriormente" : "Base fixa antes de descontar faltas e atestados"}</small></div>
        <label className="field"><span>Valor diário (R$)</span><input aria-label={`Valor diário — ${definition.label}`} inputMode="decimal" value={draft[definition.group]?.value ?? ""} placeholder="A definir" disabled={saving} onChange={event => update(definition.group, "value", event.target.value)} /></label>
        {definition.fixedDays !== null && <label className="field"><span>Base fixa (dias)</span><input aria-label="Base fixa (dias)" type="number" min="1" max="31" step="1" value={draft[definition.group]?.days ?? ""} disabled={saving} onChange={event => update(definition.group, "days", event.target.value)} /></label>}
      </div>)}</div>}
      <label className="field meal-rate-note"><span>Observação / referência (opcional)</span><textarea aria-label="Observação / referência" maxLength={500} rows={2} value={note} disabled={saving} onChange={event => setNote(event.target.value)} placeholder="Ex.: reajuste informado pelo RH, convenção ou referência interna" /></label>
      {error && <div className="meal-error" role="alert"><p>{error}</p><button className="button secondary" type="button" disabled={saving} onClick={() => { setLoading(true); setError(""); setAttempt(value => value + 1); }}>Recarregar valores</button></div>}
      <div className="meal-rate-editor-actions"><button className="button secondary" type="button" disabled={saving} onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={loading || !ready || saving}><Save size={15} />{saving ? "Salvando..." : "Salvar valores"}</button></div>
    </form>
    <details className="meal-rate-history"><summary>Últimas alterações nesta cidade</summary>{history.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Vigência</th><th>Grupo / Valor</th><th>Alterado por</th><th>Observação</th></tr></thead><tbody>{history.map(item => <tr key={item.id}><td>{monthLabel(item.effective_month)}</td><td>{mealRateDefinitions.find(definition => definition.city === city && definition.group === item.rate_group)?.label}<small>{currency(item.daily_value)}{item.fixed_days !== null && ` × ${item.fixed_days} dias`}</small></td><td>{item.created_by_name}<small>{new Date(item.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small></td><td>{item.note || "—"}</td></tr>)}</tbody></table></div> : <p>Nenhuma configuração salva. A lista mostra as últimas 50 alterações.</p>}</details>
  </section></div>;
}
