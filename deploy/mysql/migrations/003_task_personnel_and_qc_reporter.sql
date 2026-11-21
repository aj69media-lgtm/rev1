-- BuildCore CBMS - Migration 003: Task Personnel Assignment & QC Reporting Personnel
ALTER TABLE tasks
  ADD COLUMN assigned_personnel_id BIGINT UNSIGNED NULL AFTER assigned_to,
  ADD CONSTRAINT fk_tasks_personnel FOREIGN KEY (assigned_personnel_id) REFERENCES personnel(id) ON DELETE SET NULL;

ALTER TABLE quality_inspections
  ADD COLUMN reported_by_personnel_id BIGINT UNSIGNED NULL AFTER inspector_id,
  ADD CONSTRAINT fk_qi_reported_personnel FOREIGN KEY (reported_by_personnel_id) REFERENCES personnel(id) ON DELETE SET NULL;

INSERT IGNORE INTO schema_migrations (version, name) VALUES ('003', 'task_personnel_and_qc_reporter');
