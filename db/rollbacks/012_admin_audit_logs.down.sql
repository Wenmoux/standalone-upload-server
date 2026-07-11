DROP TRIGGER IF EXISTS trg_admin_audit_logs_immutable ON admin_audit_logs;
DROP FUNCTION IF EXISTS prevent_admin_audit_log_mutation();
DROP TABLE IF EXISTS admin_audit_logs;
