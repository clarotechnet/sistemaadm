import type {PayrollPdfPage} from "../../src/modules/payroll/pdf-parser";

// Entirely fictional data. The layout mirrors the supported Extrato Mensal,
// not the contents of the user's private payroll.
export function payrollPdfFixture():PayrollPdfPage[]{
  const pages:PayrollPdfPage[]=[1,2].map(number=>({number,width:595.273,height:841.886,items:[]}));
  const add=(page:number,y:number,values:Array<[number,string]>)=>{for(const [x,text] of values)pages[page-1].items.push({text,x,y,width:text.length*3.4,height:6.96});};
  for(const number of [1,2]){
    add(number,9,[[0,"Empresa:"],[104,"49 - EMPRESA FICTICIA LTDA"]]);add(number,21,[[0,"CNPJ:"],[104,"00.000.000/0001-00"]]);
    add(number,33,[[0,"Cálculo:"],[104,"Folha Mensal"]]);add(number,45,[[0,"Competência:"],[104,"09/2026"]]);add(number,81,[[245,"EXTRATO MENSAL"]]);
  }
  function person(y:number,id:string,name:string,cpf:string,contributor=false){
    add(1,y,[[0,contributor?"Contr:":"Empr.:"],[51,`${id} ${name}`],[205,"Situação:"],[237,"Trabalhando"],[350,"CPF:"],[367,cpf],[463,"Adm:"],[526,"04/01/2022"]]);
    add(1,y+10,[[0,"Vínculo:"],[64,contributor?"Contribuinte":"Celetista"],[224,"CC:"],[237,"1"],[343,"Depto:"],[367,"1"],[445,"Horas Mês:"],[541,"220,00"]]);
    add(1,y+20,[[0,"Cargo:"],[47,"2065 TECNICO"],[214,"C.B.O:"],[237,"731325"],[348,"Filial: 1"],[456,"Salário:"],[535,"1.678,00"]]);
  }
  function event(page:number,y:number,side:"P"|"D",code:string,label:string,ref:string,value:string,merged=false){
    if(side==="P")add(page,y,[[22,`${code} ${label}`],[185,ref],[240,value],[270,"P"]]);
    else if(merged)add(page,y,[[300,code],[322,`${label} ${ref}`],[524,`${value} D`]]);
    else add(page,y,[[300,code],[322,label],[472,ref],[524,`${value} D`]]);
  }
  const totals=(y:number,gross:string,deductions:string,liquid:string)=>add(1,y,[[35,"Proventos:"],[99,gross],[146,"Descontos:"],[214,deductions],[478,"Líquido:"],[530,liquid]]);
  person(103,"1","ANA TESTE","000.000.000-01");
  event(1,144,"P","1","HORAS NORMAIS","220:00","1.678,00");event(1,144,"D","201","PLANO DE SAUDE","419,00","419,00");
  event(1,155,"P","149","PERICULOSIDADE","30,00","503,40");event(1,155,"D","204","PLANO ODONTOLOGICO","55,45","55,45");
  event(1,165,"P","150","HORAS EXTRAS 60%","21:55","347,75");event(1,165,"D","998","I.N.S.S.","8,06","209,56");
  event(1,175,"P","250","REFLEXO EXTRAS DSR","0,00","69,55");totals(196,"2.598,70","684,01","1.914,69");
  person(280,"2","BRUNO TESTE","000.000.000-02");
  event(1,321,"P","5","HORAS AFAST.INSS","220:00","100,00");event(1,321,"D","988","DESCONTO HORAS AFASTADAS","220:00","100,00");totals(350,"100,00","100,00","0,00");
  add(1,370,[[0,"Doença superior a 15 dias: 12/12/2024 a 00/00/0000"]]);
  person(460,"3","CARLA TESTE","000.000.000-03",true);
  event(1,501,"P","938","PRO LABORE","30,00","200,00");event(1,501,"D","228","DESC. EMP. CRED. TRAB Nº CONTRATO123","10,00","10,00",true);
  event(1,512,"D","51","LIQUIDO RESCISAO","0,00","10,00");totals(545,"200,00","20,00","180,00");
  add(1,620,[[0,"Totais por Centro de Custos"]]);
  add(1,650,[[104,"Total Geral Proventos:"],[209,"2.898,70"],[395,"Total Geral Descontos:"],[505,"804,01"]]);add(1,661,[[423,"Líquido Geral:"],[505,"2.094,69"]]);
  add(2,103,[[0,"Resumo por Rubrica"]]);
  const earnings=[["1","HORAS NORMAIS","220:00","1.678,00"],["149","PERICULOSIDADE","30,00","503,40"],["150","HORAS EXTRAS 60%","21:54","347,75"],["250","REFLEXO EXTRAS DSR","0,00","69,55"],["5","HORAS AFAST.INSS","220:00","100,00"],["938","PRO LABORE","30,00","200,00"]];
  const deductions=[["201","PLANO DE SAUDE","419,00","419,00"],["204","PLANO ODONTOLOGICO","55,45","55,45"],["998","I.N.S.S.","8,06","209,56"],["988","DESCONTO HORAS AFASTADAS","220:00","100,00"],["228","DESC. EMP. CRED. TRAB Nº CONTRATO123","10,00","10,00"],["51","LIQUIDO RESCISAO","0,00","10,00"]];
  earnings.forEach(([code,label,ref,value],i)=>event(2,130+i*11,"P",code,label,ref,value));deductions.forEach(([code,label,ref,value],i)=>event(2,130+i*11,"D",code,label,ref,value,code==="228"));
  add(2,500,[[0,"No. Empregados:"],[156,"2"]]);add(2,511,[[303,"No. Contribuintes:"],[474,"1"]]);
  return pages;
}
