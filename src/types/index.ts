export type Role = "ADMINISTRADOR" | "RH" | "CONSULTA";
export type ComparisonStatus = "OK" | "DIVERGENTE" | "NÃO LOCALIZADO NA REFERÊNCIA" | "NÃO LOCALIZADO NA FOLHA";
export type FileRetentionMode = "NONE" | "24_HOURS" | "SECURE_OPTIONAL";

export interface SystemSettings {
  maskCpf: boolean;
  fileRetention: FileRetentionMode;
  financialTolerance: number;
  updatedAt?: string;
}

export interface RawFileUpload {
  id: string;
  fileName: string;
  sizeBytes: number;
  retentionMode: Exclude<FileRetentionMode,"NONE">;
  expiresAt: string | null;
  createdAt: string;
  ownerName?: string;
}

export type EmployeeStatus = "ATIVO" | "DESLIGADO";
export type EmployeeSource = "MANUAL" | "QUARK";
export type EmployeeDocumentStatus = "RECEBIDO" | "CONFERIDO" | "REJEITADO";

export interface Employee {
  id: string;
  name: string;
  cpf: string;
  documentNumber: string;
  registration: string;
  department: string;
  jobTitle: string;
  status: EmployeeStatus;
  source: EmployeeSource;
  externalId: string | null;
  externalUnitId: string | null;
  externalUnitName: string;
  externalTeamId: string | null;
  externalTeamName: string;
  admissionDate: string | null;
  terminationDate: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}


export interface EmployeeSyncRun {
  id: string;
  status: "RUNNING" | "SUCCESS" | "ERROR";
  triggeredByName: string;
  unitsCount: number;
  receivedCount: number;
  createdCount: number;
  updatedCount: number;
  linkedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface EmployeeSyncResult {
  runId: string;
  units: number;
  received: number;
  created: number;
  updated: number;
  linked: number;
  skipped: number;
}

export interface DocumentCategory {
  id: string;
  label: string;
  monthlyRequired: boolean;
  active: boolean;
  sortOrder: number;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  categoryId: string;
  competence: string;
  title: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  isCurrent: boolean;
  supersedesDocumentId: string | null;
  reviewStatus: EmployeeDocumentStatus;
  notes: string;
  uploadedBy: string;
  uploadedByName: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  deletedByName: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
  role: Role;
  status: "ATIVO" | "AGUARDANDO APROVAÇÃO" | "BLOQUEADO";
}
export interface ParsedSheet {
  name: string;
  headerRow: number;
  headers: string[];
  normalizedHeaders: string[];
  rows: unknown[][];
}

export interface ParsedWorkbook {
  fileName: string;
  fileSize: number;
  sheets: ParsedSheet[];
  warnings: string[];
}

export interface PayrollRecord {
  cpf: string;
  name: string;
  liquid: number;
  healthTotal: number;
  dentalTotal: number;
  healthColumns: number;
  dentalColumns: number;
  sourceSheet: string;
}

export interface ActivePayroll {
  id: string;
  fileName: string;
  fileSize: number;
  competence: string;
  importedAt: string;
  importedBy: string;
  records: PayrollRecord[];
  logs: string[];
}

export interface PayrollMonthOption {
  id: string;
  competence: string;
  fileName: string;
  recordCount: number;
  importedAt: string;
  importedBy: string;
}
export interface ReferenceRecord { cpf: string; name: string; value: number; }

export interface ComparisonRow {
  id: string;
  name: string;
  cpf: string;
  payrollValue: number | null;
  referenceValue: number | null;
  difference: number | null;
  liquid: number | null;
  columnCount: number;
  status: ComparisonStatus;
}

export interface ProcessingSummary {
  total: number;
  ok: number;
  divergent: number;
  missing: number;
  differenceTotal: number;
}

export interface PlanComparisonState {
  rows: ComparisonRow[];
  summary: ProcessingSummary;
  processedAt: string;
  fileName: string;
  tolerance?: number;
  processedBy?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  operation: string;
  module: string;
  result: string;
  status: "SUCESSO" | "AVISO" | "ERRO";
  fileName?: string;
  processedCount?: number;
  okCount?: number;
  divergentCount?: number;
  missingCount?: number;
}

export interface ToastMessage { id: string; tone: "success" | "error" | "warning" | "info"; title: string; description?: string; }
