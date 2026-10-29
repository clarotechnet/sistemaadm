import {overtimeStatusLabels,type OvertimeComparisonRow} from "../modules/payroll/overtime-audit";
import {formatOvertimeMinutes} from "../modules/overtime/common";
import {formatCpf} from "../utils/cpf";
import {downloadFile} from "../utils/download";

export async function buildPayrollOvertimeExcel(rows:OvertimeComparisonRow[],competence:string,maskCpf:boolean):Promise<Uint8Array>{
  if(!rows.length)throw new Error("Não há registros nos filtros atuais para exportar.");
  const XLSX=await import("xlsx"),workbook=XLSX.utils.book_new();
  const headers=["Competência","Colaborador folha","Nome referência","CPF","HE %","Horas referência","Horas folha","Diferença horas","Valor referência R$","Valor folha R$","Diferença R$","Status","Associação","Referência original","Origens","Pendências"];
  const duration=(minutes:number|null)=>minutes===null?null:minutes/1440;
  const values=rows.map(row=>[
    competence,row.name,row.referenceName,formatCpf(row.cpf??"",maskCpf),Number(row.rate)/100,
    duration(row.expectedMinutes),duration(row.paidMinutes),formatOvertimeMinutes(row.differenceMinutes),
    row.expectedAmount,row.paidAmount,row.differenceAmount,overtimeStatusLabels[row.status],row.match,
    row.rawReference,row.origins.join(" | "),row.issues.join(" | "),
  ]);
  const sheet=XLSX.utils.aoa_to_sheet([headers,...values]);
  workbook.Props={Author:"RH Controle",Title:`Conferência de Horas Extras ${competence}`};
  sheet["!cols"]=[15,40,40,20,12,20,20,20,24,24,22,28,22,24,70,90].map(wch=>({wch}));
  sheet["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:headers.length-1}})};
  for(let index=0;index<rows.length;index++){
    const row=index+2;
    for(const col of ["A","B","C","D","H","L","M","N","O","P"])if(sheet[col+row])sheet[col+row].z="@";
    if(sheet["E"+row])sheet["E"+row].z=Number.isInteger(Number(rows[index].rate))?"0%":"0.00%";
    for(const col of ["F","G"])if(sheet[col+row])sheet[col+row].z="[h]:mm";
    for(const col of ["I","J","K"])if(sheet[col+row])sheet[col+row].z='"R$" #,##0.00;[Red]-"R$" #,##0.00';
  }
  // Signed HH:MM stays literal: Excel's default date system cannot display negative durations.
  // Text cells are explicit strings, never formulas, including names beginning with '='.
  XLSX.utils.book_append_sheet(workbook,sheet,"Horas Extras");
  return new Uint8Array(XLSX.write(workbook,{type:"array",bookType:"xlsx",compression:true}));
}

export async function exportPayrollOvertimeExcel(rows:OvertimeComparisonRow[],competence:string,maskCpf:boolean){
  downloadFile(await buildPayrollOvertimeExcel(rows,competence,maskCpf),`Horas_extras_${competence.replace("/","-")}.xlsx`,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
