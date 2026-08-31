import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(), email: text("email").notNull(), fullName: text("full_name").notNull(),
  department: text("department").notNull().default(""), jobTitle: text("job_title").notNull().default(""),
  role: text("role", { enum: ["ADMINISTRADOR", "RH", "CONSULTA"] }).notNull().default("CONSULTA"),
  status: text("status", { enum: ["ATIVO", "AGUARDANDO APROVAÇÃO", "BLOQUEADO"] }).notNull().default("AGUARDANDO APROVAÇÃO"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [uniqueIndex("idx_profiles_email").on(table.email)]);

export const roles = sqliteTable("roles", { id: text("id").primaryKey(), name: text("name").notNull().unique(), description: text("description").notNull() });
export const permissions = sqliteTable("permissions", { id: text("id").primaryKey(), key: text("key").notNull().unique(), description: text("description").notNull() });
export const rolePermissions = sqliteTable("role_permissions", { roleId: text("role_id").notNull().references(()=>roles.id), permissionId:text("permission_id").notNull().references(()=>permissions.id) });
export const payrollImports = sqliteTable("payroll_imports", { id:text("id").primaryKey(),userId:text("user_id").notNull().references(()=>profiles.id),fileName:text("file_name").notNull(),competence:text("competence").notNull(),recordCount:integer("record_count").notNull(),status:text("status").notNull(),createdAt:text("created_at").notNull() });
export const processingJobs = sqliteTable("processing_jobs", { id:text("id").primaryKey(),userId:text("user_id").notNull().references(()=>profiles.id),type:text("type").notNull(),fileName:text("file_name"),status:text("status").notNull(),processedCount:integer("processed_count").default(0),okCount:integer("ok_count").default(0),divergentCount:integer("divergent_count").default(0),missingCount:integer("missing_count").default(0),createdAt:text("created_at").notNull(),completedAt:text("completed_at") },table=>[index("idx_processing_jobs_user_created").on(table.userId,table.createdAt),index("idx_processing_jobs_type_status").on(table.type,table.status)]);
export const comparisonResults = sqliteTable("comparison_results", { id:text("id").primaryKey(),jobId:text("job_id").notNull().references(()=>processingJobs.id),cpfHash:text("cpf_hash").notNull(),status:text("status").notNull(),payrollValue:real("payroll_value"),referenceValue:real("reference_value"),difference:real("difference") });
export const pdfJobs = sqliteTable("pdf_jobs", { id:text("id").primaryKey(),jobId:text("job_id").notNull().references(()=>processingJobs.id),tool:text("tool").notNull(),fileCount:integer("file_count").notNull(),createdAt:text("created_at").notNull() });
export const benefitJobs = sqliteTable("benefit_jobs", { id:text("id").primaryKey(),jobId:text("job_id").notNull().references(()=>processingJobs.id),benefitType:text("benefit_type").notNull(),configuration:text("configuration").notNull().default("{}") });
export const auditLogs = sqliteTable("audit_logs", { id:text("id").primaryKey(),userId:text("user_id").notNull(),userName:text("user_name").notNull(),operation:text("operation").notNull(),module:text("module").notNull(),result:text("result").notNull(),status:text("status").notNull(),fileName:text("file_name"),processedCount:integer("processed_count"),okCount:integer("ok_count"),divergentCount:integer("divergent_count"),missingCount:integer("missing_count"),createdAt:text("created_at").notNull() },table=>[index("idx_audit_logs_created").on(table.createdAt),index("idx_audit_logs_user_created").on(table.userId,table.createdAt)]);
