-- BuildCore CBMS - Migration 004: Financial Analysis, Payments Received & Cash Request Liquidation Ledgers
ALTER TABLE projects
  ADD COLUMN tpc_rate DECIMAL(6,2) NOT NULL DEFAULT 0.00 AFTER revised_budget,
  ADD COLUMN sales_commission DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER tpc_rate,
  ADD COLUMN opex_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER sales_commission,
  ADD COLUMN financial_notes TEXT NULL AFTER opex_amount;

CREATE TABLE IF NOT EXISTS project_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  remarks VARCHAR(255) DEFAULT '',
  reference_no VARCHAR(100) DEFAULT '',
  recorded_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_user FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cash_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  request_date DATE NOT NULL,
  custodian_name VARCHAR(160) NOT NULL,
  custodian_personnel_id BIGINT UNSIGNED NULL,
  custodian_user_id BIGINT UNSIGNED NULL,
  description VARCHAR(255) NOT NULL,
  amount_requested DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'released',
  remarks VARCHAR(255) DEFAULT '',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cr_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_cr_personnel FOREIGN KEY (custodian_personnel_id) REFERENCES personnel(id) ON DELETE SET NULL,
  CONSTRAINT fk_cr_user FOREIGN KEY (custodian_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_cr_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE expenses
  ADD COLUMN cash_request_id BIGINT UNSIGNED NULL AFTER pr_id,
  ADD COLUMN custodian_name VARCHAR(160) DEFAULT '' AFTER cash_request_id,
  ADD CONSTRAINT fk_expenses_cash_request FOREIGN KEY (cash_request_id) REFERENCES cash_requests(id) ON DELETE SET NULL;

INSERT IGNORE INTO schema_migrations (version, name) VALUES ('004', 'project_financial_analysis_payments_cash_requests');
