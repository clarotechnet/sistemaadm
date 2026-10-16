"use client";
import { useEffect, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import { loadAggregationSyncInfo, type AggregationSyncInfo } from "../../../src/services/benefit-aggregation";

const dateLabel=(value:string|null)=>value?new Date(value).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"Não informada";
export function AggregationSyncNotice({competence,refresh}:{competence:string;refresh:number}){
  const [state,setState]=useState<{info:AggregationSyncInfo|null;loading:boolean;error:string}>({info:null,loading:true,error:""});
  useEffect(()=>{
    let active=true;
    const timer=setTimeout(()=>{
      setState({info:null,loading:true,error:""});
      void loadAggregationSyncInfo(competence).then(info=>{if(active)setState({info,loading:false,error:""});}).catch(e=>{if(active)setState({info:null,loading:false,error:e instanceof Error?e.message:"Falha ao consultar o histórico da API."});});
    },0);
    return()=>{active=false;clearTimeout(timer);};
  },[competence,refresh]);
  const success=state.info?.lastSuccess,attempt=state.info?.latestAttempt;
  return <div className={`benefit-sync-notice ${state.error||success?.warning_message||attempt?.status==="ERROR"?"warning":""}`} role="status"><Clock3/><div><strong>{state.loading?"Consultando última atualização pelo QuarkRH...":state.error?"Não foi possível consultar a última atualização":success?`Última atualização pelo QuarkRH: ${dateLabel(success.completed_at)}`:"Nenhuma atualização concluída pelo QuarkRH nesta competência"}</strong><small>Competência {competence.split("-").reverse().join("/")}{success?` · ${success.triggered_by_name} · ${success.processed_count} colaboradores`:""}</small>{state.error&&<small>{state.error}</small>}{success?.warning_message&&<small>Atualização com ressalvas: {success.warning_message}</small>}{attempt?.status==="ERROR"&&<small>Última tentativa em {dateLabel(attempt.completed_at??attempt.started_at)} falhou. A data do último sucesso foi mantida.</small>}{attempt?.status==="RUNNING"&&<small><RefreshCw size={12}/> Existe uma atualização iniciada em {dateLabel(attempt.started_at)}, ainda sem conclusão registrada.</small>}</div></div>;
}
