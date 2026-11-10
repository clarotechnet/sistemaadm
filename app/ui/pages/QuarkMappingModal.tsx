"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Search, X } from "lucide-react";
import { createRhUnit, discoverQuarkUnits, loadQuarkMappings, saveQuarkTeam, saveQuarkUnit, type QuarkTeamMapping, type QuarkUnitMapping, type RhUnit } from "../../../src/services/quark-mappings";
import { useApp } from "../state/AppContext";
import "./quark-mapping.css";
type UnitDraft = { target: string; enabled: boolean };
const teamKey = (team: QuarkTeamMapping) => team.external_unit_id + ":" + team.external_team_id;
const textKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function QuarkMappingModal({ departments, onClose, onSaved }: { departments: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const app = useApp();
  const [units, setUnits] = useState<QuarkUnitMapping[]>([]), [teams, setTeams] = useState<QuarkTeamMapping[]>([]), [targets, setTargets] = useState<RhUnit[]>([]);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, UnitDraft>>({}), [teamDrafts, setTeamDrafts] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"units" | "teams">("units"), [query, setQuery] = useState(""), [unitFilter, setUnitFilter] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false), [name, setName] = useState(""), [city, setCity] = useState("");
  useEffect(() => {
    let active = true;
    void loadQuarkMappings().then(data => {
      if (!active) return;
      setUnits(data.units); setTeams(data.teams); setTargets(data.targets);
      setUnitDrafts(Object.fromEntries(data.units.map(unit => [unit.external_unit_id, { target: unit.target_unit_id ?? "", enabled: unit.sync_enabled }])));
      setTeamDrafts(Object.fromEntries(data.teams.map(team => [teamKey(team), team.department ?? ""])));
    }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível abrir os mapeamentos."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  const options = useMemo(() => [...new Set([...departments, ...teams.flatMap(team => team.department ? [team.department] : [])])].filter(Boolean).sort(), [departments, teams]);
  const names = useMemo(() => new Map(units.map(unit => [unit.external_unit_id, unit.external_unit_name])), [units]);
  const search = textKey(query);
  const visibleUnits = units.filter(unit => !search || textKey(unit.external_unit_name + " " + unit.external_unit_id).includes(search));
  const visibleTeams = teams.filter(team => (!unitFilter || team.external_unit_id === unitFilter) && (!search || textKey(team.external_team_name + " " + (names.get(team.external_unit_id) ?? "") + " " + (team.department ?? "")).includes(search)));
  async function discover() {
    setBusy("discover"); setError("");
    try {
      const result = await discoverQuarkUnits(), data = await loadQuarkMappings();
      setUnits(data.units); setTeams(data.teams); setTargets(data.targets);
      setUnitDrafts(current => Object.fromEntries(data.units.map(unit => [unit.external_unit_id, current[unit.external_unit_id] ?? { target: unit.target_unit_id ?? "", enabled: unit.sync_enabled }])));
      setTeamDrafts(current => Object.fromEntries(data.teams.map(team => [teamKey(team), current[teamKey(team)] ?? team.department ?? ""])));
      app.toast("success", "Lista de unidades atualizada", `${result.units} unidade(s) encontradas. Marque as que deseja sincronizar e salve cada linha.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao consultar unidades."); }
    finally { setBusy(""); }
  }
  async function saveUnit(unit: QuarkUnitMapping) {
    const draft = unitDrafts[unit.external_unit_id]; setBusy(unit.external_unit_id); setError("");
    try {
      const result = await saveQuarkUnit(unit.external_unit_id, draft.target, draft.enabled);
      setUnits(current => current.map(row => row.external_unit_id === unit.external_unit_id ? { ...row, target_unit_id: draft.target || null, sync_enabled: draft.enabled } : row));
      await onSaved();
      app.toast("success", "Unidade salva", `${result.employees ?? 0} funcionário(s) vinculados. A seleção será usada na próxima sincronização.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a unidade."); }
    finally { setBusy(""); }
  }
  async function saveTeam(team: QuarkTeamMapping) {
    const key = teamKey(team), department = (teamDrafts[key] ?? "").trim(); setBusy(key); setError("");
    try {
      const result = await saveQuarkTeam(team.external_unit_id, team.external_team_id, department);
      setTeams(current => current.map(row => teamKey(row) === key ? { ...row, department: department || null } : row));
      setTeamDrafts(current => ({ ...current, [key]: department })); await onSaved();
      app.toast("success", "Setor salvo", `${result.employees ?? 0} funcionário(s) atualizados. A regra permanece nas próximas sincronizações.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar o setor."); }
    finally { setBusy(""); }
  }
  async function addUnit() {
    setBusy("create"); setError("");
    try {
      const result = await createRhUnit(name.trim(), city.trim());
      if (!result.id) throw new Error("A unidade não retornou identificação.");
      setTargets(current => [...current, { id: result.id!, name: name.trim(), city: city.trim() }].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      setName(""); setCity(""); setCreateOpen(false); app.toast("success", "Unidade do RH cadastrada");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar a unidade."); }
    finally { setBusy(""); }
  }
  return <div className="modal-backdrop quark-mapping-backdrop"><section className="modal quark-mapping-modal" role="dialog" aria-modal="true" aria-labelledby="quark-mapping-title">
    <div className="section-header"><div><h3 id="quark-mapping-title">Mapeamentos QuarkRH → RH</h3><p>Escolha as empresas que serão consultadas e vincule suas unidades e setores.</p></div><button className="icon-plain" aria-label="Fechar mapeamentos" disabled={Boolean(busy)} onClick={onClose}><X size={20} /></button></div>
    <div className="quark-mapping-body">
      <div className="quark-mapping-intro"><p>Novas empresas aparecem na lista, com a sincronização desmarcada. Desmarcar uma unidade preserva seus funcionários. Para aplicar as escolhas, salve a linha.</p><button className="button secondary" disabled={loading || Boolean(busy) || !units.length} onClick={() => void discover()}><RefreshCw size={16} className={busy === "discover" ? "spin" : ""} />{busy === "discover" ? "Consultando unidades..." : "Atualizar lista do QuarkRH"}</button></div>
      {error && <p role="alert" className="quark-mapping-error">{error}</p>}
      <div className="quark-mapping-summary"><span><strong>{units.length}</strong> unidades descobertas</span><span><strong>{units.filter(unit => unit.sync_enabled).length}</strong> habilitadas</span><span><strong>{units.filter(unit => unit.sync_enabled && !unit.target_unit_id).length}</strong> habilitadas sem vínculo</span></div>
      <div className="tabs" role="tablist" aria-label="Mapeamentos QuarkRH"><button role="tab" aria-selected={tab === "units"} className={tab === "units" ? "active" : ""} onClick={() => { setTab("units"); setQuery(""); }}>Unidades</button><button role="tab" aria-selected={tab === "teams"} className={tab === "teams" ? "active" : ""} onClick={() => { setTab("teams"); setQuery(""); }}>Setores / Equipes</button></div>
      <div className="quark-mapping-tools"><div className="search-box"><Search size={16} /><input aria-label="Pesquisar mapeamentos" placeholder={tab === "units" ? "Nome ou ID da unidade" : "Setor ou unidade"} value={query} onChange={event => setQuery(event.target.value)} /></div>{tab === "teams" ? <select aria-label="Filtrar equipes por unidade" value={unitFilter} onChange={event => setUnitFilter(event.target.value)}><option value="">Todas as unidades</option>{units.map(unit => <option key={unit.external_unit_id} value={unit.external_unit_id}>{unit.external_unit_name}</option>)}</select> : <button className="button secondary" disabled={Boolean(busy) || !units.length} onClick={() => setCreateOpen(value => !value)}><Plus size={16} /> Cadastrar unidade do RH</button>}</div>
      {createOpen && tab === "units" && <form className="quark-target-form" onSubmit={event => { event.preventDefault(); void addUnit(); }}><label className="field"><span>Nome da unidade no RH</span><input required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label className="field"><span>Cidade da operação</span><input required list="quark-rh-cities" minLength={2} maxLength={100} value={city} onChange={event => setCity(event.target.value)} /><datalist id="quark-rh-cities">{[...new Set(targets.map(target => target.city))].map(value => <option key={value} value={value} />)}</datalist></label><button type="submit" className="button primary" disabled={Boolean(busy)}>Cadastrar unidade</button></form>}
      {loading ? <p>Carregando mapeamentos...</p> : tab === "units" ? <div className="quark-mapping-list">{visibleUnits.map(unit => {
        const draft = unitDrafts[unit.external_unit_id] ?? { target: "", enabled: false };
        const dirty = draft.target !== (unit.target_unit_id ?? "") || draft.enabled !== unit.sync_enabled;
        return <article key={unit.external_unit_id}><div><strong>{unit.external_unit_name}</strong><small>{unit.external_unit_id}{!unit.target_unit_id && " · Sem vínculo no RH"}</small><label className="quark-sync-check"><input type="checkbox" aria-label={`Incluir ${unit.external_unit_name} na sincronização`} checked={draft.enabled} disabled={Boolean(busy)} onChange={event => setUnitDrafts(current => ({ ...current, [unit.external_unit_id]: { ...draft, enabled: event.target.checked } }))} />Incluir na sincronização</label></div><label className="field"><span>Unidade do RH</span><select aria-label={`Vincular ${unit.external_unit_name}`} value={draft.target} disabled={Boolean(busy)} onChange={event => setUnitDrafts(current => ({ ...current, [unit.external_unit_id]: { ...draft, target: event.target.value } }))}><option value="">Sem vínculo</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}{target.name !== target.city ? ` · ${target.city}` : ""}</option>)}</select></label><button className="button primary" disabled={Boolean(busy) || !dirty} aria-label={`Salvar unidade ${unit.external_unit_name}`} onClick={() => void saveUnit(unit)}><Save size={14} />{busy === unit.external_unit_id ? "Salvando..." : "Salvar"}</button></article>;
      })}</div> : <><p>As equipes são descobertas ao sincronizar funcionários. Escolha um setor existente ou digite o nome desejado. Deixar em branco mantém o nome original do QuarkRH e sinaliza o vínculo pendente.</p><datalist id="quark-rh-departments">{options.map(value => <option key={value} value={value} />)}</datalist><div className="quark-mapping-list">{visibleTeams.map(team => <article key={teamKey(team)}><div><strong>{team.external_team_name || "Equipe não informada"}</strong><small>{names.get(team.external_unit_id) ?? team.external_unit_id}</small>{!team.department && <small>Setor pendente de vínculo</small>}</div><label className="field"><span>Setor no RH</span><input aria-label={`Setor ${team.external_unit_id} ${team.external_team_id}`} list="quark-rh-departments" maxLength={120} value={teamDrafts[teamKey(team)] ?? ""} disabled={Boolean(busy)} placeholder="Escolha ou digite um setor" onChange={event => setTeamDrafts(current => ({ ...current, [teamKey(team)]: event.target.value }))} /></label><button className="button primary" aria-label={`Salvar setor ${team.external_unit_id} ${team.external_team_id}`} disabled={Boolean(busy) || (teamDrafts[teamKey(team)] ?? "") === (team.department ?? "")} onClick={() => void saveTeam(team)}><Save size={14} />Salvar</button></article>)}</div>{!visibleTeams.length && <p>Nenhuma equipe encontrada. Sincronize os funcionários das unidades escolhidas para atualizar esta lista.</p>}</>}
    </div>
  </section></div>;
}
