import assert from "node:assert/strict";
import test from "node:test";
import { mealRateDefinitions, parseMealDailyCents, resolveMealRateVersion, selectMealRateVersions, type MealRateVersion } from "../supabase/functions/_shared/meal-policy.ts";
import { buildMealRows, mealDailyRate, type MealEmployee } from "../supabase/functions/_shared/meal-domain.ts";
const initial: MealRateVersion[] = mealRateDefinitions.map((item,index)=>({id:String(index),revision:index+1,city:item.city,rate_group:item.group,effective_month:'2026-11-01',daily_value:item.initialCents/100,fixed_days:item.fixedDays,created_at:'2026-11-10T15:00:00Z',created_by_name:'Inicial',note:''}));
const update: MealRateVersion = {...initial[0],id:'new',revision:14,effective_month:'2027-01-01',daily_value:27.50};
test('rate changes apply only from their effective month, per city/group, with the latest same-month revision',()=>{
 const data=[...initial,update];
 assert.equal(resolveMealRateVersion(data,'2026-12','Natal','TECNICO')?.daily_value,25);
 assert.equal(resolveMealRateVersion(data,'2027-01','Natal','TECNICO')?.daily_value,27.5);
 assert.equal(resolveMealRateVersion(data,'2027-01','Fortaleza','TECNICO')?.daily_value,25);
 assert.equal(selectMealRateVersions(data,'2026-10').length,0);
 assert.equal(resolveMealRateVersion([...data,{...update,id:'latest',revision:15,daily_value:28}],'2027-01','Natal','TECNICO')?.daily_value,28);
 assert.equal(resolveMealRateVersion(data,'2026-12','Panamirim','GERAL')?.daily_value,20);
});
test('daily input preserves cents and rejects invalid or negative money',()=>{
 for(const [input,expected]of [['25,50',2550],['25.50',2550],['1.234,56',123456],['R$ 25,00',2500],['0',0]] as const) assert.equal(parseMealDailyCents(input),expected);
 for(const input of ['', '-1', '23,456', '23.456', '2.5,00', 'NaN', 'Infinity']) assert.throws(()=>parseMealDailyCents(input));
});
test('configured snapshots freeze rate IDs, use an edited fixed base and never assume missing workdays or past rates',()=>{
 const employee:MealEmployee={id:'person',full_name:'Pessoa Teste',cpf:'',department:'RH',job_title:'Analista de RH',status:'ATIVO',external_id:'1',external_unit_id:'u1',external_unit_name:'DMV RECIFE'};
 const rates=[...initial,{...initial.find(item=>item.rate_group==='RECIFE_ESTOQUE_RH')!,id:'edited-fixed',revision:20,effective_month:'2026-12-01',daily_value:24,fixed_days:20}];
 const coverage=[{unit_id:'u1',absence_ok:true,medical_ok:true,employee_issues:{},issues:[]}];
 const bounds={start:'2026-10-26',end:'2026-11-25'};
 const [row]=buildMealRows([employee],[{employee_id:'person',event_type:'ATESTADO',source_id:'m',start_date:'2026-11-01',end_date:'2026-11-03',hours:null}],coverage,bounds,{rates,benefitMonth:'2026-12'});
 assert.equal(row.calculation_version,2); assert.equal(row.rate_version_id,'edited-fixed');assert.equal(row.planned_work_days,20);assert.equal(row.amount_due,408);
 rates.push({...rates.at(-1)!,id:'later',revision:21,daily_value:30}); assert.equal(row.daily_value,24); assert.equal(row.amount_due,408);
 const [daily]=buildMealRows([{...employee,department:'TECNICA',external_unit_name:'NATAL'}],[],coverage,bounds,{rates,benefitMonth:'2027-01'});
 assert.equal(daily.daily_value,25);assert.equal(daily.amount_due,null);
 const [past]=buildMealRows([employee],[],coverage,bounds,{rates,benefitMonth:'2026-10'});assert.equal(past.daily_value,null);assert.equal(past.amount_due,null);
 const legacy={...daily,daily_value:null,calculation_version:null};
 assert.deepEqual(mealDailyRate(legacy,true,[...rates,update],'2027-01'),{value:27.5,preview:true});
 assert.deepEqual(mealDailyRate({...legacy,daily_value:25},true,[...rates,update],'2027-01'),{value:25,preview:false});
});
