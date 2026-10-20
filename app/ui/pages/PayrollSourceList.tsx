"use client";

import {useState} from "react";
import {Trash2} from "lucide-react";
import type {PayrollSource} from "../../../src/types";
import {removePayrollSource} from "../../../src/services/browser-backend";
import {formatFileSize} from "../../../src/utils/download";
import {ConfirmationModal} from "../components/Common";
import {useApp} from "../state/AppContext";

export function PayrollSourceList(){
  const app=useApp(),payroll=app.activePayroll;
  const [selected,setSelected]=useState<PayrollSource|null>(null),[busy,setBusy]=useState(false);
  if(!payroll)return null;
  const remove=async()=>{
    if(!selected||busy)return;setBusy(true);
    try{
      await removePayrollSource(selected);
      app.addAudit({operation:"Removeu arquivo da folha",module:"Folha",result:`${payroll.competence} · ${selected.label}`,fileName:selected.fileName,status:"AVISO"});
      app.toast("success","Folha removida","As demais folhas da competência foram preservadas.");await app.refreshPayrollMonths(payroll.competence);
    }catch(error){app.toast("error","Não foi possível remover a folha",error instanceof Error?error.message:undefined);}
    finally{setBusy(false);}
  };
  if(!payroll.sources?.length)return <p className="conversion-notice">Importação anterior ao controle por arquivo. A atualização do banco preserva esta folha como a primeira origem da competência.</p>;
  return <section className="surface"><div className="section-header"><div><h3>Folhas importadas · {payroll.competence}</h3><p>Para atualizar uma folha, abra Importações e escolha o arquivo existente na opção Ação.</p></div><strong>{payroll.sources.length} arquivo(s)</strong></div><div className="table-scroll"><table className="data-table payroll-sources-table"><thead><tr><th>Empresa / unidade / folha</th><th>Arquivo</th><th>CPFs</th><th>Última importação</th><th>Responsável</th>{app.user.role==="ADMINISTRADOR"&&<th>Ações</th>}</tr></thead><tbody>{payroll.sources.map(source=><tr key={source.id}><td><strong>{source.label}</strong></td><td>{source.fileName}<small className="block-muted">{formatFileSize(source.fileSize)}</small></td><td>{source.recordCount}</td><td>{new Date(source.importedAt).toLocaleString("pt-BR")}</td><td>{source.importedBy}</td>{app.user.role==="ADMINISTRADOR"&&<td><button className="icon-danger" disabled={busy} onClick={()=>setSelected(source)} aria-label={`Remover folha ${source.label}`}><Trash2 size={16}/></button></td>}</tr>)}</tbody></table></div><p className="payroll-source-note">Líquido e descontos de um CPF presente em mais de uma folha são somados. As ocorrências de origem permanecem na Conferência para revisão de possíveis duplicidades.</p>
    <ConfirmationModal open={Boolean(selected)} danger title={`Remover a folha ${selected?.label??""}?`} description="Somente este arquivo sairá do consolidado; as demais folhas serão preservadas e as conferências serão recalculadas. Se for a última folha, a competência também será removida. A retenção do arquivo original não é alterada." confirmLabel="Remover somente esta folha" onClose={()=>setSelected(null)} onConfirm={()=>void remove()}/>
  </section>;
}
