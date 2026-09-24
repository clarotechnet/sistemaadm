import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.114.0";

const PROD_ORIGIN="https://administrativo.clarotechnet.com.br";
const allowedOrigins=new Set([PROD_ORIGIN,"http://localhost:3000","http://localhost:5173"]);
const defaultApiUrl="https://api.quark.tec.br/rh/ext";
type Obj=Record<string,unknown>;
type EventType="FALTA"|"ATESTADO"|"FERIAS";
type EventRow={cpf:string;event_type:EventType;source_event_id:string;start_date:string;end_date:string;days:number;hours:number;description:string};

const asObj=(v:unknown):Obj=>v&&typeof v==="object"&&!Array.isArray(v)?v as Obj:{};
const asText=(v:unknown)=>typeof v==="string"||typeof v==="number"?String(v).trim():"";
const asNumber=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:0};
function extractList(value:unknown):Obj[]{
  if(Array.isArray(value))return value.filter(v=>v&&typeof v==="object") as Obj[];
  const o=asObj(value);
  for(const key of ["dados","content","data","items","results","result","records","registros","lista"]){
    if(Array.isArray(o[key]))return extractList(o[key]);
  }
  for(const nested of Object.values(o)){const list=extractList(nested);if(list.length)return list}
  return[];
}
function cors(request:Request){
  const origin=request.headers.get("origin")??"";
  return {"Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:PROD_ORIGIN,
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
}
const json=(request:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors(request),"Content-Type":"application/json"}
});
function parseDate(value:unknown){
  const s=asText(value);
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  return"";
}
function monthBounds(competence:string){
  const m=competence.match(/^(\d{4})-(\d{2})$/);if(!m)throw new Error("Competência inválida. Use AAAA-MM.");
  const year=Number(m[1]),month=Number(m[2]);if(month<1||month>12)throw new Error("Competência inválida.");
  const last=new Date(Date.UTC(year,month,0)).getUTCDate(),lastText=String(last).padStart(2,"0");
  return{start:`${m[1]}-${m[2]}-01`,end:`${m[1]}-${m[2]}-${lastText}`,
    apiStart:`01-${m[2]}-${m[1]}`,apiEnd:`${lastText}-${m[2]}-${m[1]}`,
    espelhoStart:`01/${m[2]}/${m[1]}`,espelhoEnd:`${lastText}/${m[2]}/${m[1]}`};
}
function overlapDays(start:string,end:string,monthStart:string,monthEnd:string){
  const a=Math.max(Date.parse(start+"T00:00:00Z"),Date.parse(monthStart+"T00:00:00Z"));
  const b=Math.min(Date.parse(end+"T00:00:00Z"),Date.parse(monthEnd+"T00:00:00Z"));
  return b<a?0:Math.round((b-a)/86400000)+1;
}
function eventDays(row:Obj,start:string,end:string,bounds:ReturnType<typeof monthBounds>){
  const overlap=overlapDays(start,end,bounds.start,bounds.end);if(overlap<=0)return 0;
  const explicit=asNumber(row.totalDias??row.quantidadeDias);
  return Math.min(30,explicit>0?Math.min(explicit,overlap):overlap);
}
async function quark(base:string,token:string,path:string,unit:string){
  const headers:Record<string,string>={"Accept":"application/json","Auth-Token":token,
    "Unidade-ID":unit,"User-Agent":"RH-Control-Aggregation/2.0"};
  const response=await fetch(base+path,{headers});
  if(!response.ok){
    const detail=(await response.text().catch(()=> "")).slice(0,240);
    throw new Error(`QuarkRH HTTP ${response.status} em ${path}${detail?`: ${detail}`:""}`);
  }
  return response.json();
}
async function paged(base:string,token:string,unit:string,path:(page:number)=>string,max=100){
  const out:Obj[]=[];
  for(let page=1;page<=max;page++){
    const rows=extractList(await quark(base,token,path(page),unit));out.push(...rows);
    if(rows.length<100)break;
  }
  return out;
}
function normalizeApiToken(value:unknown){
  return asText(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"").toUpperCase();
}
function durationMinutes(value:unknown){
  const raw=asText(value).replace("−","-").replace("–","-");
  if(!raw)return 0;
  const clock=raw.match(/^(-)?(\d{1,6}):(\d{2})(?::(\d{2}))?$/);
  if(clock){
    const sign=clock[1]?-1:1,h=Number(clock[2]),m=Number(clock[3]),s=Number(clock[4]??0);
    if(m>59||s>59)return 0;
    return sign*(h*60+m+(s>=30?1:0));
  }
  const iso=raw.match(/^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if(iso){
    const sign=iso[1]?-1:1,h=Number(iso[2]??0),m=Number(iso[3]??0),s=Number(iso[4]??0);
    return sign*(h*60+m+Math.round(s/60));
  }
  const numeric=Number(raw.replace(",","."));
  return Number.isFinite(numeric)?numeric:0;
}
function findPositiveIntDeep(value:unknown,keys:Set<string>):number{
  if(!value||typeof value!=="object"||Array.isArray(value))return 0;
  const obj=value as Obj;
  for(const [key,item] of Object.entries(obj)){
    if(keys.has(normalizeApiToken(key))){
      const n=Number(item);if(Number.isInteger(n)&&n>0)return n;
    }
  }
  for(const item of Object.values(obj)){
    const n=findPositiveIntDeep(item,keys);if(n>0)return n;
  }
  return 0;
}
function collectDailyAbsences(payload:unknown,unit:string,employeeMap:Map<string,string>,bounds:ReturnType<typeof monthBounds>){
  const events:EventRow[]=[];const seen=new Set<string>();
  const walk=(value:unknown,parentExternalId="")=>{
    if(Array.isArray(value)){for(const item of value)walk(item,parentExternalId);return}
    if(!value||typeof value!=="object")return;
    const obj=value as Obj;let externalId=parentExternalId;
    const collaborator=asObj(obj.colaborador);
    externalId=asText(collaborator.id)||asText(obj.colaboradorId)||asText(obj.colaborador_id)||asText(obj.idColaborador)||externalId;
    const day=parseDate(obj.dia);
    const discountType=normalizeApiToken(obj.tipoDesconto);
    const absenceMinutes=durationMinutes(obj.horasAusencia);
    if(day&&day>=bounds.start&&day<=bounds.end&&discountType==="FALTA"&&absenceMinutes!==0&&externalId){
      const cpf=employeeMap.get(externalId);
      const sourceId=`espelho:${unit}:${externalId}:${day}`;
      if(cpf&&!seen.has(sourceId)){
        seen.add(sourceId);
        events.push({cpf,event_type:"FALTA",source_event_id:sourceId,start_date:day,end_date:day,days:1,
          hours:Math.round(Math.abs(absenceMinutes)/60*100)/100,
          description:`Falta no Espelho de Ponto do QuarkRH (${asText(obj.horasAusencia)||"duração informada"})`});
      }
    }
    for(const item of Object.values(obj))if(item&&typeof item==="object")walk(item,externalId);
  };
  walk(payload);return events;
}
function parseCsv(text:string){
  const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i+=1}
      else if(ch==='"')quoted=false;
      else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===","){row.push(cell);cell=""}
    else if(ch==="\n"){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell=""}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell.replace(/\r$/,""));rows.push(row)}
  return rows;
}
async function fetchSheetFaltas(sheetId:string,byUnit:Map<string,Map<string,string>>,bounds:ReturnType<typeof monthBounds>){
  if(!sheetId)throw new Error("QUARK_FALTAS_SHEET_ID não configurado.");
  const url=`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=faltas`;
  const response=await fetch(url,{headers:{"Accept":"text/csv","User-Agent":"RH-Control-Aggregation/2.0"}});
  if(!response.ok)throw new Error(`Google Sheets respondeu HTTP ${response.status} ao consultar a aba faltas.`);
  const rows=parseCsv(await response.text());if(rows.length<2)throw new Error("A aba faltas do Google Sheets está vazia.");
  const headers=rows[0].map(h=>normalizeApiToken(h)),idx=(name:string)=>headers.indexOf(normalizeApiToken(name));
  const unitIdx=idx("Unidade_ID"),employeeIdx=idx("Colaborador_ID"),dayIdx=idx("Dia"),faltasIdx=idx("Faltas");
  if([unitIdx,employeeIdx,dayIdx,faltasIdx].some(i=>i<0))throw new Error("A aba faltas não possui o layout esperado.");
  const events:EventRow[]=[],seen=new Set<string>();let latestDate="";
  for(const row of rows.slice(1)){
    const unit=asText(row[unitIdx]),externalId=asText(row[employeeIdx]),day=parseDate(row[dayIdx]);
    if(!unit||!externalId||!day||day<bounds.start||day>bounds.end)continue;
    if(day>latestDate)latestDate=day;
    const minutes=durationMinutes(row[faltasIdx]);if(minutes===0)continue;
    const cpf=byUnit.get(unit)?.get(externalId);if(!cpf)continue;
    const sourceId=`faltas-sheet:${unit}:${externalId}:${day}`;if(seen.has(sourceId))continue;seen.add(sourceId);
    events.push({cpf,event_type:"FALTA",source_event_id:sourceId,start_date:day,end_date:day,days:1,
      hours:Math.round(Math.abs(minutes)/60*100)/100,description:`Falta importada da aba faltas (${asText(row[faltasIdx])})`});
  }
  return{events,latestDate};
}
async function fetchEspelhoFaltas(base:string,token:string,unit:string,employeeMap:Map<string,string>,bounds:ReturnType<typeof monthBounds>){
  const events:EventRow[]=[];const seen=new Set<string>();
  const dateFormats:[string,string][]=[["inicio","fim"],["dataInicio","dataFim"],["dataInicial","dataFinal"]];
  let dateKeys:[string,string]|null=null;let firstPayload:unknown=null;const errors:string[]=[];
  for(const keys of dateFormats){
    const query=new URLSearchParams({page:"0",size:"50",[keys[0]]:bounds.espelhoStart,[keys[1]]:bounds.espelhoEnd});
    try{firstPayload=await quark(base,token,`/v1/frequencias/espelho-ponto?${query}`,unit);dateKeys=keys;break}
    catch(e){errors.push(e instanceof Error?e.message:String(e))}
  }
  if(!dateKeys||firstPayload===null)throw new Error(`Espelho de Ponto indisponível. ${errors.join(" | ").slice(0,900)}`);
  const append=(payload:unknown)=>{
    for(const event of collectDailyAbsences(payload,unit,employeeMap,bounds)){
      if(event.source_event_id&&!seen.has(event.source_event_id)){seen.add(event.source_event_id);events.push(event)}
    }
  };
  append(firstPayload);
  const totalPages=Math.max(1,findPositiveIntDeep(firstPayload,new Set(["TOTALPAGINAS","TOTALPAGES","QUANTIDADEPAGINAS","PAGES"])));
  for(let page=1;page<totalPages&&page<100;page++){
    const query=new URLSearchParams({page:String(page),size:"50",[dateKeys[0]]:bounds.espelhoStart,[dateKeys[1]]:bounds.espelhoEnd});
    append(await quark(base,token,`/v1/frequencias/espelho-ponto?${query}`,unit));
  }
  return events;
}
async function fetchMedical(base:string,token:string,unit:string,employeeMap:Map<string,string>,bounds:ReturnType<typeof monthBounds>){
  const events:EventRow[]=[];const rows=await paged(base,token,unit,page=>`/v1/saude-ocupacional/atestado-medico?page=${page}`);
  for(const row of rows){
    const externalId=asText(asObj(row.colaborador).id),cpf=employeeMap.get(externalId);if(!cpf)continue;
    const start=parseDate(row.dataAtestado),end=parseDate(row.dataTerminoAtestado)||start;if(!start||!end)continue;
    const days=eventDays(row,start,end,bounds);if(days<=0)continue;
    events.push({cpf,event_type:"ATESTADO",source_event_id:asText(row.id),start_date:start,end_date:end,days,
      hours:asNumber(row.quantidadeHoras),description:asText(asObj(row.tipo).nome)||asText(asObj(row.tipo).denominacao)||"Atestado"});
  }
  return events;
}
async function fetchVacations(base:string,token:string,unit:string,employees:Array<{externalId:string;cpf:string}>,bounds:ReturnType<typeof monthBounds>){
  const events:EventRow[]=[];
  for(let index=0;index<employees.length;index+=10){
    const batch=employees.slice(index,index+10);
    const result=await Promise.all(batch.map(async employee=>{
      try{
        const rows=await paged(base,token,unit,page=>`/v1/ferias/${encodeURIComponent(employee.externalId)}?page=${page}`,20);
        const own:EventRow[]=[];
        for(const row of rows){
          const start=parseDate(row.inicio),end=parseDate(row.fim)||start;if(!start||!end)continue;
          const days=eventDays(row,start,end,bounds);if(days<=0)continue;
          own.push({cpf:employee.cpf,event_type:"FERIAS",source_event_id:asText(row.id),start_date:start,end_date:end,days,
            hours:0,description:asText(asObj(row.tipo).denominacao)||"Férias"});
        }
        return own;
      }catch{return [] as EventRow[]}
    }));
    for(const list of result)events.push(...list);
  }
  return events;
}
function fromStored(row:Obj):EventRow{
  return{cpf:asText(row.cpf),event_type:"FALTA",source_event_id:asText(row.source_event_id),
    start_date:asText(row.start_date),end_date:asText(row.end_date),days:asNumber(row.days),
    hours:asNumber(row.hours),description:asText(row.description)||"Falta preservada da última sincronização"};
}
Deno.serve(async(request:Request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors(request)});
  if(request.method!=="POST")return json(request,{error:"Método não permitido."},405);
  const authorization=request.headers.get("Authorization");
  if(!authorization?.startsWith("Bearer "))return json(request,{error:"Não autenticado."},401);
  const body=await request.json().catch(()=>({})) as {competence?:string};const competence=asText(body.competence);let bounds;
  try{bounds=monthBounds(competence)}catch(e){return json(request,{error:e instanceof Error?e.message:"Competência inválida."},400)}

  const supabaseUrl=Deno.env.get("SUPABASE_URL")??"",anonKey=Deno.env.get("SUPABASE_ANON_KEY")??"",
    serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  const quarkToken=Deno.env.get("QUARK_AUTH_TOKEN")?.trim()??"",
    quarkBase=(Deno.env.get("QUARK_API_URL")?.trim()||defaultApiUrl).replace(/\/$/,""),
    faltasSheetId=Deno.env.get("QUARK_FALTAS_SHEET_ID")?.trim()??"";
  if(!quarkToken)return json(request,{error:"QUARK_AUTH_TOKEN não configurado."},503);
  const token=authorization.slice(7);
  const userClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}}});
  const {data:{user},error:userError}=await userClient.auth.getUser(token);
  if(userError||!user)return json(request,{error:"Sessão inválida."},401);
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:profile}=await admin.from("profiles").select("full_name,role,status").eq("id",user.id).single();
  if(!profile||profile.status!=="ATIVO"||!["ADMINISTRADOR","RH"].includes(profile.role))return json(request,{error:"Acesso negado."},403);
  const {data:baseRows,error:baseError}=await admin.from("benefit_aggregation_base")
    .select("id,cpf,employee_id,employees(external_id,external_unit_id)").order("employee_name");
  if(baseError)return json(request,{error:baseError.message},500);
  const linked=(baseRows??[]).map((row:any)=>({cpf:String(row.cpf),externalId:asText(row.employees?.external_id),
    unitId:asText(row.employees?.external_unit_id)})).filter((x:any)=>x.externalId&&x.unitId);
  const warnings:string[]=[];
  if(linked.length!==(baseRows??[]).length)warnings.push(`${(baseRows??[]).length-linked.length} agregado(s) sem vínculo QuarkRH.`);

  const byUnit=new Map<string,Map<string,string>>();
  for(const item of linked){if(!byUnit.has(item.unitId))byUnit.set(item.unitId,new Map());byUnit.get(item.unitId)!.set(item.externalId,item.cpf)}
  const events:EventRow[]=[],freshAbsenceEvents:EventRow[]=[];let espelhoOk=true;const espelhoErrors:string[]=[];
  for(const [unit,employeeMap] of byUnit){
    try{freshAbsenceEvents.push(...await fetchEspelhoFaltas(quarkBase,quarkToken,unit,employeeMap,bounds))}
    catch(e){espelhoOk=false;espelhoErrors.push(`Unidade ${unit}: ${e instanceof Error?e.message:String(e)}`)}
    try{events.push(...await fetchMedical(quarkBase,quarkToken,unit,employeeMap,bounds))}
    catch(e){warnings.push(`Atestados da unidade ${unit} não puderam ser atualizados.`)}
    const employees=[...employeeMap.entries()].map(([externalId,cpf])=>({externalId,cpf}));
    events.push(...await fetchVacations(quarkBase,quarkToken,unit,employees,bounds));
  }
  const espelhoError=espelhoErrors.join(" | ");let faltasSource="QUARK_API",faltasUpdatedThrough="";
  if(espelhoOk){
    events.push(...freshAbsenceEvents);
  }else{
    try{
      const sheet=await fetchSheetFaltas(faltasSheetId,byUnit,bounds);
      if(!sheet.latestDate)throw new Error("A aba faltas não possui dados para esta competência.");
      events.push(...sheet.events);faltasSource="GOOGLE_SHEETS";faltasUpdatedThrough=sheet.latestDate;
      warnings.push(`Espelho de Ponto indisponível no QuarkRH; faltas carregadas da aba faltas do Google Sheets, atualizada até ${sheet.latestDate.split("-").reverse().join("/")}.`);
    }catch(sheetError){
      const {data:stored}=await admin.from("benefit_aggregation_events").select("cpf,source_event_id,start_date,end_date,days,hours,description")
        .eq("competence",bounds.start).eq("event_type","FALTA");
      const preserved=(stored??[]).map((row:any)=>fromStored(row));
      if(!preserved.length){
        return json(request,{
          error:"O Espelho de Ponto do QuarkRH não pôde ser consultado, a aba faltas do Google Sheets também não forneceu dados e não existe snapshot anterior. O fechamento não foi salvo.",
          espelhoError:espelhoError.slice(0,900),
          sheetError:sheetError instanceof Error?sheetError.message:String(sheetError)
        },502);
      }
      events.push(...preserved);faltasSource="SNAPSHOT";
      warnings.push(`Espelho/Sheets indisponíveis; ${preserved.length} registro(s) de falta foram preservados da última atualização.`);
    }
  }
  const {data:run}=await admin.from("benefit_aggregation_sync_runs").insert({
    competence:bounds.start,status:"RUNNING",triggered_by:user.id,triggered_by_name:profile.full_name,
    warning_message:warnings.join(" ").slice(0,2000)
  }).select("id").single();
  try{
    const {data:result,error:saveError}=await admin.rpc("save_benefit_aggregation_month",{
      p_actor:user.id,p_competence:bounds.start,p_events:events
    });
    if(saveError)throw saveError;
    const counts=result as {rows?:number;events?:number};
    const faltaEvents=events.filter(e=>e.event_type==="FALTA").length,
      medicalEvents=events.filter(e=>e.event_type==="ATESTADO").length,
      vacationEvents=events.filter(e=>e.event_type==="FERIAS").length;
    if(run?.id)await admin.from("benefit_aggregation_sync_runs").update({
      status:"SUCCESS",processed_count:Number(counts?.rows??0),absence_events:faltaEvents,
      medical_events:medicalEvents,vacation_events:vacationEvents,warning_message:warnings.join(" ").slice(0,2000),
      completed_at:new Date().toISOString()
    }).eq("id",run.id);
    return json(request,{ok:true,rows:Number(counts?.rows??0),events:Number(counts?.events??events.length),
      faltas:faltaEvents,atestados:medicalEvents,ferias:vacationEvents,espelhoOk,faltasSource,faltasUpdatedThrough,
      espelhoError:espelhoOk?undefined:espelhoError.slice(0,300),warnings});
  }catch(e){
    const message=e instanceof Error?e.message:"Falha ao salvar fechamento.";
    if(run?.id)await admin.from("benefit_aggregation_sync_runs").update({
      status:"ERROR",error_message:message.slice(0,1000),completed_at:new Date().toISOString()
    }).eq("id",run.id);
    return json(request,{error:message},502);
  }
});
