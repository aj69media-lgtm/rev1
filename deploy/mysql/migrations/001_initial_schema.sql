-- BuildCore CBMS - MySQL 8.0+ / MariaDB 10.6+ Initial Schema Migration
-- Engine: InnoDB | Charset: utf8mb4 | Collation: utf8mb4_unicode_ci

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  dependencies_json JSON NOT NULL,
  required_permissions_json JSON NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  install_status VARCHAR(32) NOT NULL DEFAULT 'installed',
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 1,
  is_client_role TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id BIGINT UNSIGNED NOT NULL,
  module_slug VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  UNIQUE KEY uniq_role_mod_action (role_id, module_slug, action),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(64) DEFAULT '',
  job_title VARCHAR(150) DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL DEFAULT NULL,
  last_login_at DATETIME NULL DEFAULT NULL,
  mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  ip_address VARCHAR(64) DEFAULT '',
  user_agent VARCHAR(255) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  user_id BIGINT UNSIGNED NULL DEFAULT NULL,
  success TINYINT(1) NOT NULL,
  ip_address VARCHAR(64) DEFAULT '',
  reason VARCHAR(255) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_logs_email (email, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(128) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clients (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(200) NOT NULL,
  primary_contact VARCHAR(150) NOT NULL,
  email VARCHAR(191) NOT NULL,
  phone VARCHAR(64) DEFAULT '',
  address TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_client_user (user_id, client_id),
  CONSTRAINT fk_cu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cu_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  client_id BIGINT UNSIGNED NOT NULL,
  client_contact_info VARCHAR(255) DEFAULT '',
  location VARCHAR(255) NOT NULL,
  address TEXT,
  description TEXT,
  scope TEXT,
  contract_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  approved_budget DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  revised_budget DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  project_manager_id BIGINT UNSIGNED NULL,
  site_supervisor_id BIGINT UNSIGNED NULL,
  start_date DATE NOT NULL,
  original_end_date DATE NOT NULL,
  revised_end_date DATE NULL DEFAULT NULL,
  actual_end_date DATE NULL DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  overall_progress DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  schedule_delay_explanation TEXT,
  delay_explanation_client_visible TINYINT(1) NOT NULL DEFAULT 0,
  hero_image VARCHAR(255) DEFAULT '',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_projects_status (status),
  INDEX idx_projects_client (client_id),
  CONSTRAINT fk_proj_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_proj_pm FOREIGN KEY (project_manager_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_proj_sup FOREIGN KEY (site_supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_proj_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  assignment_role VARCHAR(64) NOT NULL DEFAULT 'member',
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_proj_user (project_id, user_id),
  CONSTRAINT fk_pa_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedule_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  revision_number INT NOT NULL,
  revision_note VARCHAR(255) DEFAULT '',
  source_filename VARCHAR(255) DEFAULT '',
  is_approved TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL DEFAULT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_proj_rev (project_id, revision_number),
  CONSTRAINT fk_sr_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_app FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_sr_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_phases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 1,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  actual_start_date DATE NULL DEFAULT NULL,
  actual_end_date DATE NULL DEFAULT NULL,
  weight_percent DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  planned_progress DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  actual_progress DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'upcoming',
  CONSTRAINT fk_pp_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_rev FOREIGN KEY (revision_id) REFERENCES schedule_revisions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_activities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NOT NULL,
  phase_id BIGINT UNSIGNED NULL,
  wbs_code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  actual_start_date DATE NULL DEFAULT NULL,
  actual_end_date DATE NULL DEFAULT NULL,
  duration_days INT NOT NULL DEFAULT 1,
  dependencies_json JSON NOT NULL,
  is_milestone TINYINT(1) NOT NULL DEFAULT 0,
  milestone_status VARCHAR(32) NULL DEFAULT NULL,
  weight_percent DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  planned_progress DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  actual_progress DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  responsible_person VARCHAR(150) DEFAULT '',
  remarks TEXT,
  is_critical_path TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_act_proj_rev (project_id, revision_id),
  CONSTRAINT fk_pact_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pact_rev FOREIGN KEY (revision_id) REFERENCES schedule_revisions(id) ON DELETE CASCADE,
  CONSTRAINT fk_pact_phase FOREIGN KEY (phase_id) REFERENCES project_phases(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_progress_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  site_location VARCHAR(255) DEFAULT '',
  weather VARCHAR(120) DEFAULT '',
  activities_performed TEXT NOT NULL,
  accomplishments TEXT,
  work_completed_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  manpower_count INT NOT NULL DEFAULT 0,
  materials_used TEXT,
  equipment_used TEXT,
  delays_problems TEXT,
  safety_observations TEXT,
  quality_observations TEXT,
  next_day_plan TEXT,
  remarks TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  prepared_by BIGINT UNSIGNED NOT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL DEFAULT NULL,
  approved_at DATETIME NULL DEFAULT NULL,
  is_published_to_client TINYINT(1) NOT NULL DEFAULT 0,
  client_summary TEXT,
  client_completed_activities TEXT,
  client_next_activities TEXT,
  client_published_by BIGINT UNSIGNED NULL,
  client_published_at DATETIME NULL DEFAULT NULL,
  photos_json JSON NOT NULL,
  client_photos_json JSON NOT NULL,
  client_idempotency_key VARCHAR(128) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dpr_proj_date (project_id, report_date),
  CONSTRAINT fk_dpr_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_dpr_prep FOREIGN KEY (prepared_by) REFERENCES users(id),
  CONSTRAINT fk_dpr_rev FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_dpr_app FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_dpr_cpub FOREIGN KEY (client_published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assigned_to BIGINT UNSIGNED NULL,
  assigned_team VARCHAR(120) DEFAULT '',
  supervisor_id BIGINT UNSIGNED NULL,
  reviewer_id BIGINT UNSIGNED NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'medium',
  start_date DATE NOT NULL,
  deadline DATE NOT NULL,
  dependencies_json JSON NOT NULL,
  progress_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  completed_at DATETIME NULL DEFAULT NULL,
  client_idempotency_key VARCHAR(128) NULL UNIQUE,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tasks_proj_status (project_id, status),
  CONSTRAINT fk_tasks_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_sup FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_rev FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  comment TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tc_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tc_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budget_allocations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  category VARCHAR(120) NOT NULL,
  allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  revised_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  UNIQUE KEY uniq_proj_cat (project_id, category),
  CONSTRAINT fk_ba_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  request_date DATE NOT NULL,
  required_date DATE NOT NULL,
  item_description TEXT NOT NULL,
  category VARCHAR(120) NOT NULL DEFAULT 'Materials',
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  estimated_unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  estimated_total_cost DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  suggested_supplier VARCHAR(200) DEFAULT '',
  reason TEXT,
  remarks TEXT,
  status VARCHAR(48) NOT NULL DEFAULT 'submitted',
  commitment_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  settled_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pr_proj_status (project_id, status),
  CONSTRAINT fk_pr_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_user FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_pr_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_request_approvals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pr_id BIGINT UNSIGNED NOT NULL,
  approver_id BIGINT UNSIGNED NOT NULL,
  stage VARCHAR(64) NOT NULL,
  decision VARCHAR(32) NOT NULL,
  remarks TEXT,
  decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pra_pr FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_pra_user FOREIGN KEY (approver_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(64) NOT NULL UNIQUE,
  pr_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  supplier_name VARCHAR(200) NOT NULL,
  approved_qty DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ordered_qty DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  delivered_qty DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  actual_unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  actual_total_cost DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  delivery_date DATE NULL DEFAULT NULL,
  receiving_confirmed_by BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ordered',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_pr FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_rec FOREIGN KEY (receiving_confirmed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  expense_date DATE NOT NULL,
  category VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  supplier_recipient VARCHAR(200) NOT NULL,
  payment_method VARCHAR(64) NOT NULL DEFAULT 'Bank Transfer',
  task_id BIGINT UNSIGNED NULL,
  pr_id BIGINT UNSIGNED NULL,
  submitted_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  remarks TEXT,
  receipt_doc_id BIGINT UNSIGNED NULL,
  client_idempotency_key VARCHAR(128) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_exp_proj_status (project_id, status),
  CONSTRAINT fk_exp_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_exp_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  CONSTRAINT fk_exp_pr FOREIGN KEY (pr_id) REFERENCES purchase_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_exp_sub FOREIGN KEY (submitted_by) REFERENCES users(id),
  CONSTRAINT fk_exp_app FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personnel (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(191) DEFAULT '',
  phone VARCHAR(64) DEFAULT '',
  position VARCHAR(120) NOT NULL,
  trade_skill VARCHAR(120) NOT NULL,
  employment_status VARCHAR(32) NOT NULL DEFAULT 'active',
  assigned_project_id BIGINT UNSIGNED NULL,
  emergency_contact VARCHAR(200) DEFAULT '',
  daily_rate DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  remarks TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pers_proj FOREIGN KEY (assigned_project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  personnel_id BIGINT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  time_in VARCHAR(16) DEFAULT '08:00',
  time_out VARCHAR(16) DEFAULT '17:00',
  status VARCHAR(32) NOT NULL DEFAULT 'present',
  total_hours DECIMAL(5,2) NOT NULL DEFAULT 8.00,
  overtime_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  remarks TEXT,
  recorded_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  client_idempotency_key VARCHAR(128) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_att_proj_pers_date (project_id, personnel_id, work_date),
  CONSTRAINT fk_att_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_att_pers FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE,
  CONSTRAINT fk_att_rec FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT fk_att_upd FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipment (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipment_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(120) NOT NULL,
  brand_model VARCHAR(150) DEFAULT '',
  serial_number VARCHAR(120) DEFAULT '',
  ownership_type VARCHAR(64) NOT NULL DEFAULT 'company_owned',
  current_location VARCHAR(200) DEFAULT '',
  assigned_project_id BIGINT UNSIGNED NULL,
  assigned_operator_id BIGINT UNSIGNED NULL,
  condition_status VARCHAR(32) NOT NULL DEFAULT 'operational',
  operating_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  next_maintenance_date DATE NULL DEFAULT NULL,
  daily_operating_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_eq_proj FOREIGN KEY (assigned_project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_eq_op FOREIGN KEY (assigned_operator_id) REFERENCES personnel(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipment_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipment_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  log_type VARCHAR(64) NOT NULL,
  hours_logged DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  logged_by BIGINT UNSIGNED NOT NULL,
  log_date DATE NOT NULL,
  CONSTRAINT fk_eql_eq FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  CONSTRAINT fk_eql_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_eql_user FOREIGN KEY (logged_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(120) NOT NULL,
  description TEXT,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  current_qty DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  min_stock_level DECIMAL(12,2) NOT NULL DEFAULT 10.00,
  storage_location VARCHAR(200) DEFAULT 'Central Warehouse',
  supplier VARCHAR(200) DEFAULT '',
  unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  assigned_project_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_inv_proj FOREIGN KEY (assigned_project_id) REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  tx_type VARCHAR(32) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  reference_doc VARCHAR(120) DEFAULT '',
  notes TEXT,
  performed_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_itx_item FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_itx_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_itx_user FOREIGN KEY (performed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quality_inspections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  checklist_json JSON NOT NULL,
  inspection_date DATE NOT NULL,
  inspector_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  defects_summary TEXT,
  remarks TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qi_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_qi_insp FOREIGN KEY (inspector_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quality_defects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'minor',
  assigned_to BIGINT UNSIGNED NULL,
  deadline DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  linked_task_id BIGINT UNSIGNED NULL,
  resolution_notes TEXT,
  resolved_at DATETIME NULL DEFAULT NULL,
  CONSTRAINT fk_qd_insp FOREIGN KEY (inspection_id) REFERENCES quality_inspections(id) ON DELETE CASCADE,
  CONSTRAINT fk_qd_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_qd_user FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_qd_task FOREIGN KEY (linked_task_id) REFERENCES tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  category VARCHAR(120) NOT NULL,
  folder VARCHAR(120) NOT NULL DEFAULT 'General',
  title VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  description TEXT,
  is_confidential TINYINT(1) NOT NULL DEFAULT 1,
  is_client_visible TINYINT(1) NOT NULL DEFAULT 0,
  phase_name VARCHAR(150) DEFAULT '',
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_doc_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  channel VARCHAR(32) NOT NULL DEFAULT 'internal',
  parent_id BIGINT UNSIGNED NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(255) DEFAULT '',
  body TEXT NOT NULL,
  is_announcement TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_parent FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  link_section VARCHAR(64) DEFAULT 'overview',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_revision_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  client_user_id BIGINT UNSIGNED NOT NULL,
  category VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  reason TEXT,
  preferred_date VARCHAR(64) DEFAULT '',
  status VARCHAR(64) NOT NULL DEFAULT 'submitted',
  technical_notes TEXT,
  cost_impact DECIMAL(15,2) NULL DEFAULT NULL,
  schedule_impact_days INT NULL DEFAULT NULL,
  change_order_ref VARCHAR(64) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_crr_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_crr_user FOREIGN KEY (client_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_revision_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  previous_status VARCHAR(64) DEFAULT '',
  new_status VARCHAR(64) NOT NULL,
  remarks TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_crh_req FOREIGN KEY (request_id) REFERENCES client_revision_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_crh_actor FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quote_number VARCHAR(64) NOT NULL UNIQUE,
  client_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  location VARCHAR(255) DEFAULT '',
  scope TEXT,
  validity_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  direct_cost DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  overhead_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  contingency_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  markup_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  tax_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  prepared_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_q_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_q_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_q_prep FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_q_app FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  user_email VARCHAR(191) NOT NULL,
  action VARCHAR(64) NOT NULL,
  module VARCHAR(64) NOT NULL,
  record_type VARCHAR(64) NOT NULL,
  record_ref VARCHAR(128) NOT NULL,
  previous_value_json JSON NULL,
  new_value_json JSON NULL,
  remarks TEXT,
  ip_address VARCHAR(64) DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_mod (module, created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  module VARCHAR(64) NOT NULL,
  project_id BIGINT UNSIGNED NULL DEFAULT NULL,
  client_only TINYINT(1) NOT NULL DEFAULT 0,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sync_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, name) VALUES ('001', 'initial_cbms_schema');
SET FOREIGN_KEY_CHECKS = 1;
