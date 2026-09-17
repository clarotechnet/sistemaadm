import type { DocumentCategory, Employee, EmployeeDocument, EmployeeDocumentStatus, EmployeeStatus, EmployeeSyncResult, EmployeeSyncRun } from "../types";
import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { isValidCpf, normalizeCpf } from "../utils/cpf";

const documentBucket = "employee-documents";
export const employeeDocumentMaxSize = 50 * 1024 * 1024;
export const employeeDocumentAccept = ".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.csv,.zip";
const acceptedExtensions = new Set(employeeDocumentAccept.split(",").map(value => value.slice(1)));

type EmployeeRow = {
  id: string; full_name: string; cpf: string; document_number: string; registration: string; department: string; job_title: string;
  status: EmployeeStatus; source: "MANUAL" | "QUARK"; external_id: string | null; external_unit_id: string | null;
  external_unit_name: string; external_team_id: string | null; external_team_name: string; admission_date: string | null;
  termination_date: string | null; last_synced_at: string | null; created_at: string; updated_at: string;
};
type EmployeeSyncRunRow = {
  id:string; status:EmployeeSyncRun["status"]; triggered_by_name:string; units_count:number; received_count:number;
  created_count:number; updated_count:number; linked_count:number; skipped_count:number; error_message:string|null;
  started_at:string; completed_at:string|null;
};
type CategoryRow = { id: string; label: string; monthly_required: boolean; active: boolean; sort_order: number };
type DocumentRow = {
  id: string; employee_id: string; category_id: string; competence: string; title: string; file_name: string;
  storage_path: string; mime_type: string; size_bytes: number | string; sha256: string; version: number;
  is_current: boolean; supersedes_document_id: string | null; review_status: EmployeeDocumentStatus; notes: string;
  uploaded_by: string; uploaded_by_name: string; reviewed_by_name: string | null; reviewed_at: string | null;
  deleted_by_name: string | null; deleted_at: string | null; created_at: string; updated_at: string;
};

const employeeFromRow = (row: EmployeeRow): Employee => ({
  id: row.id, name: row.full_name, cpf: row.cpf, documentNumber: row.document_number ?? "", registration: row.registration, department: row.department,
  jobTitle: row.job_title, status: row.status, source: row.source ?? "MANUAL", externalId: row.external_id ?? null,
  externalUnitId: row.external_unit_id ?? null, externalUnitName: row.external_unit_name ?? "", externalTeamId: row.external_team_id ?? null,
  externalTeamName: row.external_team_name ?? "", admissionDate: row.admission_date ?? null, terminationDate: row.termination_date ?? null,
  lastSyncedAt: row.last_synced_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
});
const categoryFromRow = (row: CategoryRow): DocumentCategory => ({
  id: row.id, label: row.label, monthlyRequired: row.monthly_required, active: row.active, sortOrder: row.sort_order,
});
const documentFromRow = (row: DocumentRow): EmployeeDocument => ({
  id: row.id, employeeId: row.employee_id, categoryId: row.category_id, competence: row.competence.slice(0, 7),
  title: row.title, fileName: row.file_name, storagePath: row.storage_path, mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes), sha256: row.sha256, version: row.version, isCurrent: row.is_current,
  supersedesDocumentId: row.supersedes_document_id, reviewStatus: row.review_status, notes: row.notes,
  uploadedBy: row.uploaded_by, uploadedByName: row.uploaded_by_name, reviewedByName: row.reviewed_by_name,
  reviewedAt: row.reviewed_at, deletedByName: row.deleted_by_name, deletedAt: row.deleted_at,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

function storageSafeName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-160) || "documento";
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function readableDatabaseError(error: { code?: string; message: string }) {
  if (error.code === "23505" && error.message.includes("employees_cpf_key")) return new Error("Já existe um funcionário com este CPF.");
  return new Error(error.message);
}

export async function listEmployees(): Promise<Employee[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("employees").select("id,full_name,cpf,document_number,registration,department,job_title,status,source,external_id,external_unit_id,external_unit_name,external_team_id,external_team_name,admission_date,termination_date,last_synced_at,created_at,updated_at").order("full_name");
  if (error) throw error;
  return ((data ?? []) as EmployeeRow[]).map(employeeFromRow);
}

export async function saveEmployee(
  payload: { name: string; cpf: string; department: string; status: EmployeeStatus },
  employeeId?: string,
): Promise<Employee> {
  const cpf = normalizeCpf(payload.cpf);
  if (payload.name.trim().length < 2) throw new Error("Informe o nome completo do funcionário.");
  if (!isValidCpf(cpf)) throw new Error("Informe um CPF válido para o funcionário.");
  if (payload.department.trim().length < 2) throw new Error("Informe o setor do funcionário.");
  const supabase = createSupabaseBrowserClient();
  const values = {
    full_name: payload.name.trim(), cpf, department: payload.department.trim(), status: payload.status,
  };
  const request = employeeId
    ? supabase.from("employees").update(values).eq("id", employeeId)
    : supabase.from("employees").insert(values);
  const { data, error } = await request.select("id,full_name,cpf,document_number,registration,department,job_title,status,source,external_id,external_unit_id,external_unit_name,external_team_id,external_team_name,admission_date,termination_date,last_synced_at,created_at,updated_at").single();
  if (error) throw readableDatabaseError(error);
  return employeeFromRow(data as EmployeeRow);
}

const syncRunFromRow = (row: EmployeeSyncRunRow): EmployeeSyncRun => ({
  id: row.id, status: row.status, triggeredByName: row.triggered_by_name, unitsCount: Number(row.units_count ?? 0),
  receivedCount: Number(row.received_count ?? 0), createdCount: Number(row.created_count ?? 0), updatedCount: Number(row.updated_count ?? 0),
  linkedCount: Number(row.linked_count ?? 0), skippedCount: Number(row.skipped_count ?? 0), errorMessage: row.error_message ?? null,
  startedAt: row.started_at, completedAt: row.completed_at ?? null,
});

export async function loadLatestEmployeeSync(): Promise<EmployeeSyncRun | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("employee_sync_runs").select("id,status,triggered_by_name,units_count,received_count,created_count,updated_count,linked_count,skipped_count,error_message,started_at,completed_at").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? syncRunFromRow(data as EmployeeSyncRunRow) : null;
}

export async function syncEmployeesFromQuark(): Promise<EmployeeSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.functions.invoke("sync-quark-employees", { body: {} });
  const body = (data ?? {}) as Partial<EmployeeSyncResult> & { error?: string };
  if (error) throw error;
  if (body.error) throw new Error(body.error);
  if (!body.runId) throw new Error("A sincronização terminou sem retornar o identificador da execução.");
  return { runId: body.runId, units: Number(body.units ?? 0), received: Number(body.received ?? 0), created: Number(body.created ?? 0), updated: Number(body.updated ?? 0), linked: Number(body.linked ?? 0), skipped: Number(body.skipped ?? 0) };
}

export async function listDocumentCategories(): Promise<DocumentCategory[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.from("document_categories").select("id,label,monthly_required,active,sort_order").eq("active", true).order("sort_order");
  if (error) throw error;
  return ((data ?? []) as CategoryRow[]).map(categoryFromRow);
}

export async function listEmployeeDocuments(competence: string, trash = false): Promise<EmployeeDocument[]> {
  const supabase = createSupabaseBrowserClient();
  let request = supabase.from("employee_documents").select("id,employee_id,category_id,competence,title,file_name,storage_path,mime_type,size_bytes,sha256,version,is_current,supersedes_document_id,review_status,notes,uploaded_by,uploaded_by_name,reviewed_by_name,reviewed_at,deleted_by_name,deleted_at,created_at,updated_at");
  request = trash
    ? request.not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(300)
    : request.eq("competence", `${competence}-01`).is("deleted_at", null).order("created_at", { ascending: false }).limit(1000);
  const { data, error } = await request;
  if (error) throw error;
  return ((data ?? []) as DocumentRow[]).map(documentFromRow);
}

export async function uploadEmployeeDocument(
  file: File,
  input: { employeeId: string; categoryId: string; competence: string; title: string; notes: string },
): Promise<EmployeeDocument> {
  const extension = extensionOf(file.name);
  if (!acceptedExtensions.has(extension)) throw new Error(`Formato não permitido: ${file.name}`);
  if (!file.size || file.size > employeeDocumentMaxSize) throw new Error(`${file.name} deve ter entre 1 byte e 50 MB.`);
  if (!/^\d{4}-\d{2}$/.test(input.competence)) throw new Error("Informe a competência do documento.");
  const supabase = createSupabaseBrowserClient();
  const id = crypto.randomUUID();
  const path = `${input.employeeId}/${input.competence}/${input.categoryId}/${id}-${storageSafeName(file.name)}`;
  const hash = await sha256(file);
  const uploaded = await supabase.storage.from(documentBucket).upload(path, file, {
    contentType: file.type || "application/octet-stream", upsert: false,
  });
  if (uploaded.error) throw uploaded.error;
  const { data, error } = await supabase.rpc("register_employee_document", {
    p_id: id, p_employee_id: input.employeeId, p_category_id: input.categoryId,
    p_competence: `${input.competence}-01`, p_title: input.title.trim() || file.name.replace(/\.[^.]+$/, ""),
    p_file_name: file.name, p_storage_path: path, p_mime_type: file.type || "application/octet-stream",
    p_size_bytes: file.size, p_sha256: hash, p_notes: input.notes.trim(),
  });
  if (error) {
    await supabase.storage.from(documentBucket).remove([path]);
    throw error;
  }
  return documentFromRow(data as DocumentRow);
}

export async function getEmployeeDocumentUrl(document: EmployeeDocument) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.storage.from(documentBucket).createSignedUrl(document.storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadEmployeeDocumentBlob(document: EmployeeDocument): Promise<Blob> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.storage.from(documentBucket).download(document.storagePath);
  if (error) throw error;
  return data;
}

export async function reviewEmployeeDocument(id: string, status: EmployeeDocumentStatus): Promise<EmployeeDocument> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("review_employee_document", { p_document_id: id, p_review_status: status });
  if (error) throw error;
  return documentFromRow(data as DocumentRow);
}

export async function trashEmployeeDocument(id: string): Promise<EmployeeDocument> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("trash_employee_document", { p_document_id: id });
  if (error) throw error;
  return documentFromRow(data as DocumentRow);
}

export async function restoreEmployeeDocument(id: string): Promise<EmployeeDocument> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("restore_employee_document", { p_document_id: id });
  if (error) throw error;
  return documentFromRow(data as DocumentRow);
}

export async function purgeEmployeeDocument(document: EmployeeDocument) {
  const supabase = createSupabaseBrowserClient();
  const removed = await supabase.storage.from(documentBucket).remove([document.storagePath]);
  if (removed.error) throw removed.error;
  const { error } = await supabase.from("employee_documents").delete().eq("id", document.id);
  if (error) throw error;
}
