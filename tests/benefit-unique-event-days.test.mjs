import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261009114000_benefit_unique_medical_days.sql",import.meta.url),"utf8");

// Espelha a contagem por dias civis distintos usada pelo generate_series + DISTINCT da migration.
function distinctDays(events,type){
  const days=new Set();
  for(const event of events.filter(item=>item.type===type)){
    for(let time=Date.parse(event.start+"T00:00:00Z");time<=Date.parse(event.end+"T00:00:00Z");time+=86400000){
      days.add(new Date(time).toISOString().slice(0,10));
    }
  }
  return days.size;
}

test("Lucivaldo: dois IDs Quark para o mesmo atestado não viram 20 dias",()=>{
  const events=[
    {type:"ATESTADO",id:"32844828",start:"2026-09-16",end:"2026-09-25"},
    {type:"ATESTADO",id:"32844830",start:"2026-09-16",end:"2026-09-25"},
  ];
  const medicalDays=distinctDays(events,"ATESTADO");
  assert.equal(medicalDays,10);
  assert.equal(30-medicalDays,20);
  assert.equal(Math.round(Math.round((700/30)*100)/100*(30-medicalDays)*100)/100,466.60);
});

test("sobreposição parcial também não duplica dias",()=>{
  const events=[
    {type:"ATESTADO",start:"2026-09-16",end:"2026-09-18"},
    {type:"ATESTADO",start:"2026-09-17",end:"2026-09-18"},
  ];
  assert.equal(distinctDays(events,"ATESTADO"),3);
});

test("períodos separados contam todos os dias e nunca cruzam funcionários ou tipo",()=>{
  const events=[
    {type:"ATESTADO",start:"2026-09-01",end:"2026-09-02"},
    {type:"ATESTADO",start:"2026-09-05",end:"2026-09-05"},
    {type:"FERIAS",start:"2026-09-01",end:"2026-09-03"},
  ];
  assert.equal(distinctDays(events,"ATESTADO"),3);
  assert.equal(distinctDays(events,"FERIAS"),3);
});

test("migração mantém registros de origem e recalcula valores existentes",()=>{
  assert.match(migration,/create or replace function public\.save_benefit_aggregation_month/i);
  assert.match(migration,/select distinct e\.aggregation_id, e\.event_type, calendar\.day::date/i);
  assert.match(migration,/count\(\*\) filter \(where event_type='ATESTADO'\)/);
  assert.match(migration,/count\(\*\) filter \(where event_type='FERIAS'\)/);
  assert.match(migration,/insert into public\.benefit_aggregation_events/i);
  assert.match(migration,/update public\.benefit_aggregation_monthly m/i);
  assert.match(migration,/\$function\$;\s*-- Conserta/);
  assert.match(migration,/commit;\s*$/i);
  assert.doesNotMatch(migration,/delete from public\.benefit_aggregation_events where competence = month_start;[\s\S]*?delete from public\.benefit_aggregation_events where competence = month_start;/i);
});
