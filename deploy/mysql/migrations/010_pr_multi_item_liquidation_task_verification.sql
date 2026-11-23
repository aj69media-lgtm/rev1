-- Migration 010: Multi-Item Purchase Requests, Financial Cash Liquidation Accountability,
-- Task Completion Photo Verification, and Protected Attachment Extensions
-- Compatible with MySQL 8.0+ / MariaDB 10.6+ (GoDaddy cPanel Shared Hosting)

ALTER TABLE protected_attachments
  ADD COLUMN project_id BIGINT NULL DEFAULT NULL,
  ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN caption VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN thumbnail_path VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN is_amended TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN amendment_note TEXT NULL,
  ADD COLUMN amended_by BIGINT NULL,
  ADD COLUMN amended_at DATETIME NULL DEFAULT NULL;

CREATE INDEX idx_protected_attachments_proj ON protected_attachments(project_id, entity_type);

-- Multi-Item Purchase Requests
ALTER TABLE purchase_requests
  ADD COLUMN requesting_department VARCHAR(120) NOT NULL DEFAULT 'Operations',
  ADD COLUMN site_location VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN preferred_supplier_id BIGINT NULL DEFAULT NULL,
  ADD COLUMN preferred_supplier_name VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN item_count INT NOT NULL DEFAULT 1,
  ADD COLUMN approved_total_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00;

CREATE TABLE IF NOT EXISTS purchase_request_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  pr_id BIGINT NOT NULL,
  catalog_item_id BIGINT NULL DEFAULT NULL,
  inventory_item_id BIGINT NULL DEFAULT NULL,
  item_code VARCHAR(80) NOT NULL DEFAULT '',
  item_description VARCHAR(255) NOT NULL,
  specifications TEXT NULL,
  category VARCHAR(120) NOT NULL DEFAULT 'Materials',
  requested_qty DECIMAL(14,3) NOT NULL DEFAULT 1.000,
  approved_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  ordered_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  delivered_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  unit VARCHAR(40) NOT NULL DEFAULT 'pcs',
  estimated_unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  estimated_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  approved_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  preferred_supplier_id BIGINT NULL DEFAULT NULL,
  preferred_supplier_name VARCHAR(255) NOT NULL DEFAULT '',
  item_status VARCHAR(40) NOT NULL DEFAULT 'pending',
  approver_remarks TEXT NULL,
  remarks TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pri_pr FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_pr_items_pr ON purchase_request_items(pr_id, sort_order);

ALTER TABLE purchase_orders
  ADD COLUMN supplier_id BIGINT NULL DEFAULT NULL,
  ADD COLUMN discrepancy_notes TEXT NULL,
  ADD COLUMN remarks TEXT NULL;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  po_id BIGINT NOT NULL,
  pr_id BIGINT NOT NULL,
  pr_item_id BIGINT NULL DEFAULT NULL,
  catalog_item_id BIGINT NULL DEFAULT NULL,
  inventory_item_id BIGINT NULL DEFAULT NULL,
  item_code VARCHAR(80) NOT NULL DEFAULT '',
  item_description VARCHAR(255) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT 'pcs',
  approved_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  ordered_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  delivered_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  actual_unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  actual_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  supplier_id BIGINT NULL DEFAULT NULL,
  supplier_name VARCHAR(255) NOT NULL DEFAULT '',
  discrepancy_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  discrepancy_notes TEXT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'ordered',
  CONSTRAINT fk_poi_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_poi_pr FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_poi_pri FOREIGN KEY (pr_item_id) REFERENCES purchase_request_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  po_id BIGINT NOT NULL,
  pr_id BIGINT NOT NULL,
  pr_item_id BIGINT NULL DEFAULT NULL,
  project_id BIGINT NOT NULL,
  inventory_item_id BIGINT NULL DEFAULT NULL,
  delivered_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  accepted_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  rejected_qty DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  actual_unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  actual_total_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  delivery_date DATE NOT NULL,
  dr_number VARCHAR(120) NOT NULL DEFAULT '',
  invoice_number VARCHAR(120) NOT NULL DEFAULT '',
  discrepancy_notes TEXT NULL,
  added_to_warehouse TINYINT(1) NOT NULL DEFAULT 0,
  received_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_por_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_por_pr FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_por_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Financial Entry & Cash Liquidation Accountability
ALTER TABLE expenses
  ADD COLUMN employee_name VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN submitted_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN no_receipt_exception TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN exception_reason TEXT NULL,
  ADD COLUMN exception_status VARCHAR(40) NOT NULL DEFAULT 'none',
  ADD COLUMN exception_approved_by BIGINT NULL DEFAULT NULL,
  ADD COLUMN exception_approved_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN exception_remarks TEXT NULL,
  ADD COLUMN reviewed_by BIGINT NULL DEFAULT NULL,
  ADD COLUMN reviewed_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN approved_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN rejection_reason TEXT NULL,
  ADD COLUMN amendment_count INT NOT NULL DEFAULT 0,
  ADD COLUMN is_system_settlement TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS expense_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  expense_id BIGINT NOT NULL,
  actor_id BIGINT NULL,
  action VARCHAR(80) NOT NULL,
  previous_status VARCHAR(40) NOT NULL DEFAULT '',
  new_status VARCHAR(40) NOT NULL DEFAULT '',
  remarks TEXT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_eh_expense FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_expense_history_exp ON expense_history(expense_id, id);

INSERT IGNORE INTO system_settings (setting_key, setting_value)
VALUES ('allow_self_liquidation_approval', '0');

-- Task Completion Photographic Proof & Verification
ALTER TABLE tasks
  ADD COLUMN completion_status VARCHAR(50) NOT NULL DEFAULT 'none',
  ADD COLUMN completion_date DATE NULL DEFAULT NULL,
  ADD COLUMN completion_remarks TEXT NULL,
  ADD COLUMN submitted_for_review_by BIGINT NULL DEFAULT NULL,
  ADD COLUMN submitted_for_review_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN verified_by BIGINT NULL DEFAULT NULL,
  ADD COLUMN verified_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN verification_remarks TEXT NULL,
  ADD COLUMN rejection_reason TEXT NULL,
  ADD COLUMN evidence_locked TINYINT(1) NOT NULL DEFAULT 0;

UPDATE tasks
SET completion_status = 'verified',
    completion_date = COALESCE(completion_date, DATE(completed_at), CURDATE())
WHERE status = 'completed' AND completion_status = 'none';

CREATE TABLE IF NOT EXISTS task_completion_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT NOT NULL,
  actor_id BIGINT NULL,
  action VARCHAR(80) NOT NULL,
  previous_status VARCHAR(40) NOT NULL DEFAULT '',
  new_status VARCHAR(40) NOT NULL DEFAULT '',
  completion_status VARCHAR(50) NOT NULL DEFAULT '',
  remarks TEXT NULL,
  attachment_ids_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tch_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_task_completion_history_task ON task_completion_history(task_id, id);
