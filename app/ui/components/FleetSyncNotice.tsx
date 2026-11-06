"use client";
import { useEffect, useState } from "react";
import { CarFront } from "lucide-react";
import { loadFleetSyncInfo, type FleetSyncInfo } from "../../../src/services/benefit-aggregation";

export function FleetSyncNotice({competence,refresh,onConfigured}:{competence:string;refresh:number;onConfigured:(ready:boolean)=>void}){
  const [state,setState]=useState<{info:FleetSyncInfo|null;error:boolean}>({info:null,error:false});
  useEffect(()=>{
    let active=true;
    void loadFleetSyncInfo(competence).then(info=>{
      if(active){setState({info,error:false});onConfigured(info.configured);}
    }).catch(()=>{if(active){setState({info:null,error:true});onConfigured(false);}});
    return()=>{active=false;};
  },[competence,refresh,onConfigured]);
  const success=state.info?.lastSuccess,attempt=state.info?.latestAttempt;
  const date=success?.completed_at?new Date(success.completed_at).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):null;
  return <div className={`benefit-sync-notice ${state.error||attempt?.status==="ERROR"||success?.warning_message?"warning":""}`} role="status"><CarFront/><div>
    <strong>{state.error?"Não foi possível consultar a conexão com a Frota":!state.info?"Consultando conexão com a Frota...":!state.info.configured?"Conexão com a Frota aguardando configuração":date?`Última atualização pela Frota: ${date}`:"Frota conectada · clique em Atualizar Frota para consultar os dias"}</strong>
    <small>Competência {competence.split("-").reverse().join("/")} · vínculo por CPF da base de agregamento. Ajustes manuais têm prioridade.</small>
    {success&&<small>{success.processed_count} cadastro(s) atualizado(s) · {success.manual_preserved_count} ajuste(s) manual(is) preservado(s) · {success.triggered_by_name}</small>}
    {success?.warning_message&&<small>{success.warning_message}</small>}
    {attempt?.status==="ERROR"&&<small>{attempt.error_message??"A última tentativa falhou. Os dias anteriores foram mantidos."}</small>}
  </div></div>;
}
