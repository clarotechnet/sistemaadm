CREATE INDEX `idx_audit_logs_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user_created` ON `audit_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_processing_jobs_user_created` ON `processing_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_processing_jobs_type_status` ON `processing_jobs` (`type`,`status`);