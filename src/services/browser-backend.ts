import type { ActivePayroll, AuditEntry, ComparisonRow, ComparisonStatus, FileRetentionMode, PayrollMonthOption, PayrollRecord, PlanComparisonState, RawFileUpload, Role, SystemSettings, UserProfile } from "../types";
import { createSupabaseBrowserClient } from "../lib/supabase/client";

const isStaticHostinger = process.env.NEXT_PUBLIC_DEPLOY_TARGET === "static-hostinger";
const bucket = "rh-private-files";
const maxFileSize = 50 * 1024 * 1024;

type ProfileRow = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  job_title: string;
  role: Role;
  status: UserProfile["status"];
};

type SettingsRow = {
  mask_cpf: boolean;
  file_retention: FileRetentionMode;
  financial_tolerance: number | string;
  updated_at?: string;
};

type AuditRow = {
  id: string;
  created_at: string;
  user_name: string;
  operation: string;
  module: string;
  result: string;
  status: AuditEntry["status"];
  file_name?: string | null;
  processed_count?: number | null;
  ok_count?: number | null;
  divergent_count?: number | null;
  missing_count?: number | null;
};

type RawFileRow = {
  id: string;
  file_name: string;
  size_bytes: number | string;
  retention_mode: Exclude<FileRetentionMode, "NONE">;
  expires_at: string | null;
  created_at: string;
  storage_path?: string;
};

type PayrollRecordRow = { cpf:string; name:string; liquid:number|string; health_total:number|string; dental_total:number|string; health_columns:number; dental_columns:number; source_sheet:string };
type PayrollImportRow = { id:string; file_name:string; file_size:number|string; competence:string; updated_at:string; imported_by_name:string; logs:unknown; payroll_records?:PayrollRecordRow[] };
type PayrollMonthRow = { id:string; file_name:string; competence:string; record_count:number; updated_at:string; imported_by_name:string };
type ComparisonDetailRow = { cpf:string; name:string; payroll_value:number|string|null; reference_value:number|string|null; difference:number|string|null; liquid:number|string|null; column_count:number; status:ComparisonStatus };
type ComparisonDbRow = { id:string; reference_file_name:string; tolerance:number|string; processed_by_name:string; processed_at:string; total_count:number; ok_count:number; divergent_count:number; missing_count:number; difference_total:number|string; payroll_comparison_rows?:ComparisonDetailRow[] };

const profileFromRow = (row: ProfileRow): UserProfile => ({
  id: row.id,
  name: row.full_name,
  email: row.email,
  department: row.department,
  jobTitle: row.job_title,
  role: row.role,
  status: row.status,
});

const settingsFromRow = (row: SettingsRow): SystemSettings => ({
  maskCpf: Boolean(row.mask_cpf),
  fileRetention: row.file_retention,
  financialTolerance: Number(row.financial_tolerance ?? 0.01),
  updatedAt: row.updated_at,
});

const auditFromRow = (row: AuditRow): AuditEntry => ({
  id: row.id,
  timestamp: row.created_at,
  user: row.user_name,
  operation: row.operation,
  module: row.module,
  result: row.result,
  status: row.status,
  fileName: row.file_name ?? undefined,
  processedCount: row.processed_count ?? undefined,
  okCount: row.ok_count ?? undefined,
  divergentCount: row.divergent_count ?? undefined,
  missingCount: row.missing_count ?? undefined,
});

const rawFileFromRow = (row: RawFileRow): RawFileUpload => ({
  id: row.id,
  fileName: row.file_name,
  sizeBytes: Number(row.size_bytes),
  retentionMode: row.retention_mode,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

const payrollRecordFromRow=(row:PayrollRecordRow):PayrollRecord=>({ cpf:row.cpf,name:row.name,liquid:Number(row.liquid??0),healthTotal:Number(row.health_total??0),dentalTotal:Number(row.dental_total??0),healthColumns:Number(row.health_columns??0),dentalColumns:Number(row.dental_columns??0),sourceSheet:row.source_sheet??"" });
const payrollFromRow=(row:PayrollImportRow):ActivePayroll=>({ id:row.id,fileName:row.file_name,fileSize:Number(row.file_size??0),competence:row.competence,importedAt:row.updated_at,importedBy:row.imported_by_name||"Usuário RH",records:(row.payroll_records??[]).map(payrollRecordFromRow).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")),logs:Array.isArray(row.logs)?row.logs.map(String):[] });

const comparisonFromRow=(row:ComparisonDbRow):PlanComparisonState=>({
  rows:(row.payroll_comparison_rows??[]).map(item=>({id:item.cpf,cpf:item.cpf,name:item.name,payrollValue:item.payroll_value===null?null:Number(item.payroll_value),referenceValue:item.reference_value===null?null:Number(item.reference_value),difference:item.difference===null?null:Number(item.difference),liquid:item.liquid===null?null:Number(item.liquid),columnCount:Number(item.column_count??0),status:item.status} as ComparisonRow)).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")),
  summary:{total:Number(row.total_count??0),ok:Number(row.ok_count??0),divergent:Number(row.divergent_count??0),missing:Number(row.missing_count??0),differenceTotal:Number(row.difference_total??0)},
  processedAt:row.processed_at,fileName:row.reference_file_name,tolerance:Number(row.tolerance??0.01),processedBy:row.processed_by_name,
});

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "A operação não pôde ser concluída.");
  return data;
}

export async function loadCurrentProfile(userId: string): Promise<UserProfile | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("profiles").select("id,email,full_name,department,job_title,role,status").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? profileFromRow(data as ProfileRow) : null;
}

export async function updateOwnProfile(userId: string, payload: { name: string; department: string; jobTitle: string }) {
  if (!isStaticHostinger) {
    await jsonRequest<{ ok: boolean }>("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return;
  }
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("profiles").update({
    full_name: payload.name.trim(),
    department: payload.department.trim(),
    job_title: payload.jobTitle.trim(),
    updated_at: new Date().toISOString(),
  }).eq("id", userId);
  if (error) throw error;
}

export async function loadSystemSettings(): Promise<SystemSettings> {
  if (!isStaticHostinger) return (await jsonRequest<{ settings: SystemSettings }>("/api/settings", { cache: "no-store" })).settings;
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("system_settings").select("mask_cpf,file_retention,financial_tolerance,updated_at").eq("id", "global").single();
  if (error) throw error;
  return settingsFromRow(data as SettingsRow);
}

export async function saveSystemSettings(userId: string, payload: Partial<SystemSettings>): Promise<SystemSettings> {
  if (!isStaticHostinger) return (await jsonRequest<{ settings: SystemSettings }>("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })).settings;
  const supabase = createSupabaseBrowserClient();
  const patch: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() };
  if (payload.maskCpf !== undefined) patch.mask_cpf = payload.maskCpf;
  if (payload.fileRetention !== undefined) patch.file_retention = payload.fileRetention;
  if (payload.financialTolerance !== undefined) patch.financial_tolerance = payload.financialTolerance;
  const { data, error } = await supabase.from("system_settings").update(patch).eq("id", "global").select("mask_cpf,file_retention,financial_tolerance,updated_at").single();
  if (error) throw error;
  return settingsFromRow(data as SettingsRow);
}

export async function listPayrollMonths():Promise<PayrollMonthOption[]>{
  const supabase=createSupabaseBrowserClient();
  const {data,error}=await supabase.from("payroll_imports").select("id,file_name,competence,record_count,updated_at,imported_by_name");
  if(error)throw error;
  const months=((data??[]) as PayrollMonthRow[]).map(row=>({id:row.id,competence:row.competence,fileName:row.file_name,recordCount:Number(row.record_count??0),importedAt:row.updated_at,importedBy:row.imported_by_name||"Usuário RH"}));
  return months.sort((a,b)=>{const [am,ay]=a.competence.split("/").map(Number);const [bm,by]=b.competence.split("/").map(Number);return (by*12+bm)-(ay*12+am)});
}

export async function loadPayrollMonth(competence:string):Promise<ActivePayroll|null>{
  const supabase=createSupabaseBrowserClient();
  const {data,error}=await supabase.from("payroll_imports").select("id,file_name,file_size,competence,updated_at,imported_by_name,logs,payroll_records(cpf,name,liquid,health_total,dental_total,health_columns,dental_columns,source_sheet)").eq("competence",competence).maybeSingle();
  if(error)throw error;
  return data?payrollFromRow(data as PayrollImportRow):null;
}

export async function loadActivePayroll():Promise<ActivePayroll|null>{
  const months=await listPayrollMonths();
  return months[0]?loadPayrollMonth(months[0].competence):null;
}

export async function savePayrollMonth(payroll:ActivePayroll):Promise<{payroll:ActivePayroll;updated:boolean}>{
  const supabase=createSupabaseBrowserClient();
  const records=payroll.records.map(record=>({cpf:record.cpf,name:record.name,liquid:record.liquid,health_total:record.healthTotal,dental_total:record.dentalTotal,health_columns:record.healthColumns,dental_columns:record.dentalColumns,source_sheet:record.sourceSheet}));
  const {data,error}=await supabase.rpc("save_payroll_month",{p_competence:payroll.competence,p_file_name:payroll.fileName,p_file_size:payroll.fileSize,p_logs:payroll.logs,p_records:records});
  if(error)throw error;
  const saved=await loadPayrollMonth(payroll.competence);
  if(!saved)throw new Error("A folha foi gravada, mas não pôde ser recarregada.");
  return {payroll:saved,updated:Boolean((data as {updated?:boolean}|null)?.updated)};
}
export async function removePayrollMonth(competence:string):Promise<void>{
  const supabase=createSupabaseBrowserClient();
  const {error}=await supabase.rpc("admin_delete_payroll_month",{p_competence:competence});
  if(error)throw error;
}

export async function loadPayrollComparison(payrollImportId:string,kind:"health"|"dental"):Promise<PlanComparisonState|null>{
  const supabase=createSupabaseBrowserClient();
  const query="id,reference_file_name,tolerance,processed_by_name,processed_at,total_count,ok_count,divergent_count,missing_count,difference_total,payroll_comparison_rows(cpf,name,payroll_value,reference_value,difference,liquid,column_count,status)";
  const {data,error}=await supabase.from("payroll_comparisons").select(query).eq("payroll_import_id",payrollImportId).eq("kind",kind).maybeSingle();
  if(error)throw error;
  return data?comparisonFromRow(data as ComparisonDbRow):null;
}

export async function savePayrollComparison(payrollImportId:string,kind:"health"|"dental",file:File,tolerance:number,state:PlanComparisonState):Promise<PlanComparisonState>{
  const supabase=createSupabaseBrowserClient();
  const rows=state.rows.map(row=>({cpf:row.cpf,name:row.name,payroll_value:row.payrollValue,reference_value:row.referenceValue,difference:row.difference,liquid:row.liquid,column_count:row.columnCount,status:row.status}));
  const {error}=await supabase.rpc("save_payroll_comparison",{p_payroll_import_id:payrollImportId,p_kind:kind,p_reference_file_name:file.name,p_reference_file_size:file.size,p_tolerance:tolerance,p_rows:rows});
  if(error)throw error;
  const saved=await loadPayrollComparison(payrollImportId,kind);
  if(!saved)throw new Error("O comparativo foi salvo, mas não pôde ser recarregado.");
  return saved;
}

export async function removePayrollComparison(payrollImportId:string,kind:"health"|"dental"):Promise<void>{
  const supabase=createSupabaseBrowserClient();
  const {error}=await supabase.rpc("delete_payroll_comparison",{p_payroll_import_id:payrollImportId,p_kind:kind});
  if(error)throw error;
}

export async function loadAuditEntries(): Promise<AuditEntry[]> {
  if (!isStaticHostinger) return (await jsonRequest<{ audits: AuditEntry[] }>("/api/audit", { cache: "no-store" })).audits;
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return ((data ?? []) as AuditRow[]).map(auditFromRow);
}

export async function clearAuditEntries(): Promise<{ removed:number; audits:AuditEntry[] }> {
  if (!isStaticHostinger) {
    const result=await jsonRequest<{ ok:boolean; removed:number }>("/api/audit", { method:"DELETE" });
    return { removed:result.removed, audits:await loadAuditEntries() };
  }
  const supabase=createSupabaseBrowserClient();
  const { data,error }=await supabase.rpc("admin_clear_audit_logs");
  if(error)throw error;
  return { removed:Number(data??0), audits:await loadAuditEntries() };
}

export async function storeAuditEntry(user: UserProfile, entry: AuditEntry) {
  if (!isStaticHostinger) {
    await jsonRequest<{ ok: boolean }>("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) });
    return;
  }
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.from("audit_logs").insert({
    id: entry.id,
    user_id: user.id,
    user_name: user.name,
    operation: entry.operation,
    module: entry.module,
    result: entry.result,
    status: entry.status,
    file_name: entry.fileName ?? null,
    processed_count: entry.processedCount ?? null,
    ok_count: entry.okCount ?? null,
    divergent_count: entry.divergentCount ?? null,
    missing_count: entry.missingCount ?? null,
    created_at: entry.timestamp,
  });
  if (error) throw error;
}

export async function updateManagedUser(id: string, patch: Partial<UserProfile>): Promise<UserProfile> {
  if (!isStaticHostinger) {
    const data = await jsonRequest<{ user: UserProfile }>("/api/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    return data.user;
  }
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("admin_update_profile", {
    target_id: id,
    new_role: patch.role ?? null,
    new_status: patch.status ?? null,
  });
  if (error) throw error;
  return profileFromRow(data as ProfileRow);
}

export async function inviteManagedUser(payload: { name: string; email: string; department: string; jobTitle: string; role: Role }): Promise<UserProfile> {
  if (!isStaticHostinger) {
    const data = await jsonRequest<{ user: UserProfile }>("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return data.user;
  }
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.functions.invoke("invite-rh-user", { body: payload });
  if (error) throw error;
  const body = data as { user?: UserProfile; error?: string };
  if (!body.user) throw new Error(body.error ?? "Não foi possível enviar o convite.");
  return body.user;
}

export async function listRawFiles(): Promise<RawFileUpload[]> {
  if (!isStaticHostinger) return (await jsonRequest<{ files: RawFileUpload[] }>("/api/raw-files", { cache: "no-store" })).files;
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("raw_file_uploads").select("id,file_name,size_bytes,retention_mode,expires_at,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return ((data ?? []) as RawFileRow[]).map(rawFileFromRow);
}

function safeName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "arquivo";
}

export async function retainRawFile(user: UserProfile, file: File, optedIn: boolean) {
  if (!isStaticHostinger) {
    const form = new FormData();
    form.append("file", file);
    form.append("optIn", optedIn ? "true" : "false");
    await jsonRequest<{ file: RawFileUpload }>("/api/raw-files", { method: "POST", body: form });
    return;
  }
  if (file.size > maxFileSize) throw new Error("O arquivo excede o limite de 50 MB para retenção.");
  const settings = await loadSystemSettings();
  if (settings.fileRetention === "NONE") throw new Error("A política atual não permite armazenar arquivos brutos.");
  if (settings.fileRetention === "SECURE_OPTIONAL" && !optedIn) throw new Error("O armazenamento seguro não foi autorizado.");
  const supabase = createSupabaseBrowserClient();
  const id = crypto.randomUUID();
  const storagePath = `${user.id}/${id}-${safeName(file.name)}`;
  const uploaded = await supabase.storage.from(bucket).upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploaded.error) throw uploaded.error;
  const expiresAt = settings.fileRetention === "24_HOURS" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
  const { error } = await supabase.from("raw_file_uploads").insert({
    id,
    user_id: user.id,
    file_name: file.name,
    storage_path: storagePath,
    size_bytes: file.size,
    retention_mode: settings.fileRetention,
    expires_at: expiresAt,
  });
  if (error) {
    await supabase.storage.from(bucket).remove([storagePath]);
    throw error;
  }
}

export async function getRawFileDownloadUrl(id: string): Promise<string> {
  if (!isStaticHostinger) return (await jsonRequest<{ url: string }>(`/api/raw-files?download=${encodeURIComponent(id)}`, { cache: "no-store" })).url;
  const supabase = createSupabaseBrowserClient();
  const { data: item, error: itemError } = await supabase.from("raw_file_uploads").select("storage_path").eq("id", id).single();
  if (itemError) throw itemError;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(item.storage_path as string, 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeRawFile(id: string) {
  if (!isStaticHostinger) {
    await jsonRequest<{ ok: boolean }>("/api/raw-files", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    return;
  }
  const supabase = createSupabaseBrowserClient();
  const { data: item, error: itemError } = await supabase.from("raw_file_uploads").select("storage_path").eq("id", id).single();
  if (itemError) throw itemError;
  const removed = await supabase.storage.from(bucket).remove([item.storage_path as string]);
  if (removed.error) throw removed.error;
  const { error } = await supabase.from("raw_file_uploads").delete().eq("id", id);
  if (error) throw error;
}

export async function cleanupExpiredRawFiles() {
  if (!isStaticHostinger) {
    await jsonRequest<{ ok: boolean }>("/api/raw-files/cleanup", { method: "POST" });
    return;
  }
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("raw_file_uploads").select("id,storage_path").not("expires_at", "is", null).lte("expires_at", new Date().toISOString()).limit(100);
  if (error || !data?.length) return;
  const paths = data.map(item => item.storage_path as string);
  const removed = await supabase.storage.from(bucket).remove(paths);
  if (removed.error) throw removed.error;
  const { error: deleteError } = await supabase.from("raw_file_uploads").delete().in("id", data.map(item => item.id as string));
  if (deleteError) throw deleteError;
}
