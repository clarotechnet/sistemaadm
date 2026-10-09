import { createSupabaseBrowserClient } from "../lib/supabase/client";
import { payrollRecordFromRow } from "./browser-backend";
import type { ActivePayroll, Employee, PayrollRecord, UserProfile } from "../types";
import { comparisonCompetences, competenceDates, competenceIndex, type AuditReview, type AuditRules, type VacationEvidence } from "../modules/payroll/audit";

export interface AuditContext { currentImportId: string; previousCompetence: string; revisionKey: string }
export async function auditContext(current: ActivePayroll, previous: ActivePayroll | null, rules: AuditRules, employees: Employee[] = [], history: ActivePayroll[] = []): Promise<AuditContext> {
  const employeeRevision = employees.map(employee => [employee.cpf, employee.status, employee.source, employee.admissionDate, employee.terminationDate, employee.externalUnitId, employee.externalUnitName]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const historicalRevision = history.filter(month => month.id !== previous?.id && comparisonCompetences(current.competence).includes(month.competence)).map(month => [month.competence, month.id, month.importedAt]).sort((a, b) => a[0].localeCompare(b[0]));
  const revision = [current.id, current.importedAt, previous?.id, previous?.importedAt, rules, employeeRevision];
  // Preserve single-month review keys; include every extra reference when present.
  const value = JSON.stringify(historicalRevision.length ? [...revision, historicalRevision] : revision);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return { currentImportId: current.id, previousCompetence: previous?.competence ?? "", revisionKey: [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("") };
}

export async function loadAuditEmployees(): Promise<Employee[]> {
  const supabase = createSupabaseBrowserClient();
  const result: Employee[] = [];
  for (let offset = 0;; offset += 500) {
    const { data, error } = await supabase.from("employees").select("id,full_name,cpf,registration,department,job_title,status,source,external_unit_id,external_unit_name,admission_date,termination_date,last_synced_at").order("id").range(offset, offset + 499);
    if (error) throw error;
    for (const row of data ?? []) result.push({ id: row.id, name: row.full_name, cpf: row.cpf, registration: row.registration, department: row.department, jobTitle: row.job_title, status: row.status, source: row.source, externalUnitId: row.external_unit_id, externalUnitName: row.external_unit_name, admissionDate: row.admission_date, terminationDate: row.termination_date, lastSyncedAt: row.last_synced_at } as Employee);
    if ((data?.length ?? 0) < 500) break;
  }
  return result;
}

export async function loadAuditVacations(competence: string): Promise<VacationEvidence[]> {
  const supabase = createSupabaseBrowserClient();
  const rows: VacationEvidence[] = [];
  for (let offset = 0;; offset += 500) {
    const { data, error } = await supabase.from("benefit_aggregation_monthly").select("cpf,vacation_days").eq("competence", competenceDates(competence).start).gt("vacation_days", 0).order("id").range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []).map(row => ({ cpf: row.cpf, days: Number(row.vacation_days) })));
    if ((data?.length ?? 0) < 500) break;
  }
  return rows;
}

type ReviewDbRow = { employee_key: string; rule_code: string; status: AuditReview["status"]; notes: string; updated_by: string; updated_by_name: string; updated_at: string };
const fromReview = (row: ReviewDbRow): AuditReview => ({ employeeKey: row.employee_key, ruleCode: row.rule_code, status: row.status, notes: row.notes, updatedBy: row.updated_by, updatedByName: row.updated_by_name, updatedAt: row.updated_at });
export async function loadAuditReviews(context: AuditContext): Promise<AuditReview[]> {
  const supabase = createSupabaseBrowserClient();
  const rows: AuditReview[] = [];
  for (let offset = 0;; offset += 500) {
    const { data, error } = await supabase.from("payroll_audit_reviews").select("employee_key,rule_code,status,notes,updated_by,updated_by_name,updated_at").eq("current_import_id", context.currentImportId).eq("previous_competence", context.previousCompetence).eq("revision_key", context.revisionKey).order("employee_key").order("rule_code").range(offset, offset + 499);
    if (error) throw error;
    rows.push(...((data ?? []) as ReviewDbRow[]).map(fromReview));
    if ((data?.length ?? 0) < 500) break;
  }
  return rows;
}
export async function saveAuditReview(context: AuditContext, user: UserProfile, review: Pick<AuditReview, "employeeKey" | "ruleCode" | "status" | "notes">): Promise<AuditReview> {
  if (["JUSTIFICADA", "CORRIGIDA", "IGNORADA"].includes(review.status) && review.notes.trim().length < 3) throw new Error("Informe a justificativa antes de concluir esta divergência.");
  const { data, error } = await createSupabaseBrowserClient().from("payroll_audit_reviews").upsert({ current_import_id: context.currentImportId, previous_competence: context.previousCompetence, revision_key: context.revisionKey, employee_key: review.employeeKey, rule_code: review.ruleCode, status: review.status, notes: review.notes.trim(), updated_by: user.id }, { onConflict: "current_import_id,previous_competence,revision_key,employee_key,rule_code" }).select("employee_key,rule_code,status,notes,updated_by,updated_by_name,updated_at").single();
  if (error) throw error;
  return fromReview(data as ReviewDbRow);
}

export interface AuditHistoryMonth { competence: string; record: PayrollRecord }
export async function loadEmployeePayrollHistory(cpf: string, currentCompetence: string, months = 3): Promise<AuditHistoryMonth[]> {
  const supabase = createSupabaseBrowserClient();
  // One bounded query for this employee, not one request per month or employee.
  const competences = [currentCompetence, ...comparisonCompetences(currentCompetence, months)];
  const { data, error } = await supabase.from("payroll_records").select("cpf,name,liquid,health_total,dental_total,health_columns,dental_columns,source_sheet,audit_data,payroll_imports!inner(competence)").eq("cpf", cpf).in("payroll_imports.competence", competences).limit(competences.length);
  if (error) throw error;
  return (data ?? []).flatMap(row => {
    const parent = row.payroll_imports as unknown as { competence: string };
    return competences.includes(parent.competence) ? [{ competence: parent.competence, record: payrollRecordFromRow(row) }] : [];
  }).sort((a, b) => competenceIndex(b.competence) - competenceIndex(a.competence));
}
