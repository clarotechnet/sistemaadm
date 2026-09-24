"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Plus, Save, Search, Trash2, X } from "lucide-react";
import type { AggregationBaseRecord, BenefitVehicleRecord } from "../../../src/types";
import { formatCpf } from "../../../src/utils/cpf";
import { formatMoney } from "../../../src/utils/money";
import { exportBenefitVehicleExcel, listBenefitVehicles, removeBenefitVehicle, saveBenefitVehicle } from "../../../src/services/benefit-vehicles";
import { MetricCard } from "../components/Common";
import { useApp } from "../state/AppContext";

type Props={base:AggregationBaseRecord[]};
const emptyManual:BenefitVehicleRecord={
  id:"manual:new",aggregationId:null,source:"MANUAL",employeeName:"",cpf:"",company:"",city:"",
  baseValue:0,plate:"",vehicleYear:null,vehicleModel:"",
};

export function BenefitVehiclesTab({base}:Props){
  const app=useApp();
  const[rows,setRows]=useState<BenefitVehicleRecord[]>([]);
  const[loading,setLoading]=useState(true);
  const[query,setQuery]=useState("");
  const[company,setCompany]=useState("TODAS");
  const[city,setCity]=useState("TODAS");
  const[year,setYear]=useState("TODOS");
  const[adding,setAdding]=useState(false);
  const[draft,setDraft]=useState<BenefitVehicleRecord>({...emptyManual});
  const[savingId,setSavingId]=useState("");
  const reload=async()=>{
    setLoading(true);
    try{setRows(await listBenefitVehicles(base))}
    catch(e){app.toast("error","Não foi possível carregar os veículos",e instanceof Error?e.message:undefined)}
    finally{setLoading(false)}
  };
  useEffect(()=>{void reload()},[base]);

  const companies=useMemo(()=>[...new Set(rows.map(item=>item.company).filter(Boolean))].sort(),[rows]);
  const cities=useMemo(()=>[...new Set(rows.map(item=>item.city).filter(Boolean))].sort(),[rows]);
  const years=useMemo(()=>[...new Set(rows.map(item=>item.vehicleYear).filter((value):value is number=>Boolean(value)))].sort((a,b)=>b-a),[rows]);
  const filtered=useMemo(()=>rows.filter(item=>{
    const q=query.trim().toLocaleLowerCase("pt-BR");const digits=query.replace(/\D/g,"");
    return (company==="TODAS"||item.company===company)&&(city==="TODAS"||item.city===city)&&
      (year==="TODOS"||item.vehicleYear===Number(year))&&
      (!q||item.employeeName.toLocaleLowerCase("pt-BR").includes(q)||(digits&&item.cpf.includes(digits))||
        item.plate.toLocaleLowerCase("pt-BR").includes(q)||item.vehicleModel.toLocaleLowerCase("pt-BR").includes(q));
  }),[rows,query,company,city,year]);
  const withVehicle=filtered.filter(item=>item.plate||item.vehicleModel||item.vehicleYear);
  const validYears=filtered.map(item=>item.vehicleYear).filter((value):value is number=>Boolean(value));
  const averageYear=validYears.length?validYears.reduce((sum,value)=>sum+value,0)/validYears.length:0;
  const filteredBaseValue=filtered.reduce((sum,item)=>sum+item.baseValue,0);

  const patch=(id:string,changes:Partial<BenefitVehicleRecord>)=>setRows(current=>current.map(item=>item.id===id?{...item,...changes}:item));
  const saveRow=async(item:BenefitVehicleRecord)=>{
    if(item.vehicleYear!==null&&(item.vehicleYear<1900||item.vehicleYear>2200)){app.toast("warning","Ano inválido","Informe um ano entre 1900 e 2200.");return}
    setSavingId(item.id);
    try{
      await saveBenefitVehicle(item);await reload();
      app.toast("success","Veículo atualizado",item.employeeName);
    }catch(e){app.toast("error","Não foi possível salvar o veículo",e instanceof Error?e.message:undefined)}
    finally{setSavingId("")}
  };
  const removeRow=async(item:BenefitVehicleRecord)=>{
    if(!window.confirm(`Excluir ${item.employeeName} da aba Veículos?`))return;
    setSavingId(item.id);
    try{
      await removeBenefitVehicle(item);await reload();
      app.toast("success","Registro removido","A Base de dados do Agregamento não foi alterada.");
    }catch(e){app.toast("error","Não foi possível excluir o registro",e instanceof Error?e.message:undefined)}
    finally{setSavingId("")}
  };
  const addManual=async()=>{
    const cpfDigits=draft.cpf.replace(/\D/g,"");
    const cpf=cpfDigits.padStart(11,"0");
    if(!draft.employeeName.trim()||cpfDigits.length!==11||!draft.company.trim()||!draft.city.trim()){
      app.toast("warning","Confira os dados","Nome, CPF com 11 dígitos, empresa e cidade são obrigatórios.");return;
    }
    if(draft.vehicleYear!==null&&(draft.vehicleYear<1900||draft.vehicleYear>2200)){app.toast("warning","Ano inválido","Informe um ano entre 1900 e 2200.");return}
    if(rows.some(item=>item.cpf===cpf)){app.toast("warning","CPF já cadastrado","Esse CPF já existe na aba Veículos.");return}
    setSavingId(draft.id);
    try{
      await saveBenefitVehicle({...draft,cpf});setAdding(false);setDraft({...emptyManual});await reload();
      app.toast("success","Pessoa adicionada à aba Veículos");
    }catch(e){app.toast("error","Não foi possível adicionar a pessoa",e instanceof Error?e.message:undefined)}
    finally{setSavingId("")}
  };
  const exportReport=async()=>{
    try{
      await exportBenefitVehicleExcel(withVehicle);
      app.addAudit({operation:"Exportou relatório de veículos",module:"Benefícios",result:`${withVehicle.length} veículo(s) exportado(s)`,status:"SUCESSO",processedCount:withVehicle.length});
      app.toast("success","Relatório de veículos criado",`${withVehicle.length} veículo(s) nos filtros atuais.`);
    }catch(e){app.toast("error","Não foi possível gerar o relatório",e instanceof Error?e.message:undefined)}
  };

  return <div className="stack-gap">
    <div className="metrics-grid">
      <MetricCard label="COLABORADORES" value={filtered.length} detail="nos filtros atuais"/>
      <MetricCard label="VEÍCULOS CADASTRADOS" value={withVehicle.length} detail="com placa, ano ou modelo" tone="success"/>
      <MetricCard label="ANO MÉDIO" value={validYears.length?averageYear.toFixed(1):"—"} detail={validYears.length?`${validYears.length} veículo(s) com ano informado`:"Sem ano informado"} tone="warning"/>
      <MetricCard label="VALOR BASE" value={formatMoney(filteredBaseValue)} detail="Agregamento dos filtros atuais"/>
    </div>

    {adding&&<section className="surface vehicle-add-card">
      <div className="section-header"><div><h3>Adicionar pessoa</h3><p>Inclua alguém fora da Base de dados apenas nesta aba de Veículos.</p></div><button className="icon-plain" onClick={()=>setAdding(false)}><X size={18}/></button></div>
      <div className="vehicle-add-grid">
        <label className="field"><span>Nome</span><input value={draft.employeeName} onChange={e=>setDraft({...draft,employeeName:e.target.value})}/></label>
        <label className="field"><span>CPF</span><input value={draft.cpf} onChange={e=>setDraft({...draft,cpf:e.target.value})}/></label>
        <label className="field"><span>Empresa</span><input value={draft.company} onChange={e=>setDraft({...draft,company:e.target.value})}/></label>
        <label className="field"><span>Cidade</span><input value={draft.city} onChange={e=>setDraft({...draft,city:e.target.value})}/></label>
        <label className="field"><span>Valor base</span><input inputMode="decimal" value={draft.baseValue||""} onChange={e=>setDraft({...draft,baseValue:Number(e.target.value.replace(",","."))||0})}/></label>
        <label className="field"><span>Placa</span><input value={draft.plate} onChange={e=>setDraft({...draft,plate:e.target.value.toUpperCase()})}/></label>
        <label className="field"><span>Ano</span><input inputMode="numeric" value={draft.vehicleYear??""} onChange={e=>setDraft({...draft,vehicleYear:e.target.value?Number(e.target.value):null})}/></label>
        <label className="field"><span>Modelo do veículo</span><input value={draft.vehicleModel} onChange={e=>setDraft({...draft,vehicleModel:e.target.value})}/></label>
      </div>
      <div className="form-actions"><button className="button secondary" onClick={()=>setAdding(false)}>Cancelar</button><button className="button primary" disabled={savingId===draft.id} onClick={()=>void addManual()}><Save size={16}/> Salvar pessoa</button></div>
    </section>}

    <section className="surface table-surface">
      <div className="aggregation-toolbar vehicle-toolbar">
        <div className="search-box"><Search size={16}/><input placeholder="Pesquisar nome, CPF, placa ou modelo" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <select value={company} onChange={e=>setCompany(e.target.value)}><option value="TODAS">Todas as empresas</option>{companies.map(item=><option key={item}>{item}</option>)}</select>
        <select value={city} onChange={e=>setCity(e.target.value)}><option value="TODAS">Todas as cidades</option>{cities.map(item=><option key={item}>{item}</option>)}</select>
        <select value={year} onChange={e=>setYear(e.target.value)}><option value="TODOS">Todos os anos</option>{years.map(item=><option key={item} value={item}>{item}</option>)}</select>
        <div className="vehicle-actions">
          <button className="button secondary" disabled={!withVehicle.length} onClick={()=>void exportReport()}><FileSpreadsheet size={16}/> Relatório de veículos</button>
          <button className="button primary" onClick={()=>setAdding(true)}><Plus size={16}/> Adicionar pessoa</button>
        </div>
      </div>
      {loading?<div className="table-empty">Carregando veículos...</div>:<div className="table-scroll">
        <table className="data-table vehicle-table">
          <thead><tr><th>Colaborador</th><th>CPF</th><th>Empresa</th><th>Cidade</th><th className="right">Valor base</th><th>Placa</th><th>Ano</th><th>Modelo do veículo</th><th>Ações</th></tr></thead>
          <tbody>{filtered.map(item=><tr key={item.id}>
            <td className="vehicle-person-cell"><strong>{item.employeeName}</strong><small>{item.source==="BASE"?"Base do Agregamento":"Adicionado manualmente"}</small></td>
            <td className="mono">{formatCpf(item.cpf,app.settings.maskCpf)}</td>
            <td>{item.company}</td><td>{item.city}</td><td className="right">{formatMoney(item.baseValue)}</td>
            <td><input className="vehicle-inline-input plate" value={item.plate} placeholder="ABC1D23" maxLength={8} onChange={e=>patch(item.id,{plate:e.target.value.toUpperCase()})}/></td>
            <td><input className="vehicle-inline-input year" type="number" min={1900} max={2200} value={item.vehicleYear??""} placeholder="Ano" onChange={e=>patch(item.id,{vehicleYear:e.target.value?Number(e.target.value):null})}/></td>
            <td><input className="vehicle-inline-input model" value={item.vehicleModel} placeholder="Modelo" onChange={e=>patch(item.id,{vehicleModel:e.target.value})}/></td>
            <td><div className="vehicle-row-actions">
              <button className="table-edit-button save" title="Salvar veículo" disabled={savingId===item.id} onClick={()=>void saveRow(item)}><Save size={15}/></button>
              <button className="table-edit-button delete" title="Excluir desta aba" disabled={savingId===item.id} onClick={()=>void removeRow(item)}><Trash2 size={15}/></button>
            </div></td>
          </tr>)}</tbody>
        </table>
        {!filtered.length&&<div className="table-empty">Nenhum colaborador corresponde aos filtros aplicados.</div>}
      </div>}
    </section>
  </div>;
}
