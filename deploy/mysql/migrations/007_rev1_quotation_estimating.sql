-- Migration 007: REV1 Quotation, Estimating & Commercial Management Module
ALTER TABLE quotations ADD COLUMN current_revision_id BIGINT UNSIGNED NULL;
ALTER TABLE quotations ADD COLUMN current_revision_code VARCHAR(16) NOT NULL DEFAULT 'REV00';
ALTER TABLE quotations ADD COLUMN subject VARCHAR(500) DEFAULT '';
ALTER TABLE quotations ADD COLUMN site_location VARCHAR(255) DEFAULT '';
ALTER TABLE quotations ADD COLUMN province VARCHAR(120) DEFAULT '';
ALTER TABLE quotations ADD COLUMN municipality VARCHAR(120) DEFAULT '';
ALTER TABLE quotations ADD COLUMN barangay VARCHAR(120) DEFAULT '';
ALTER TABLE quotations ADD COLUMN zip_code VARCHAR(20) DEFAULT '';
ALTER TABLE quotations ADD COLUMN attention_to VARCHAR(150) DEFAULT '';
ALTER TABLE quotations ADD COLUMN attention_title VARCHAR(150) DEFAULT '';
ALTER TABLE quotations ADD COLUMN thru_person VARCHAR(150) DEFAULT '';
ALTER TABLE quotations ADD COLUMN thru_title VARCHAR(150) DEFAULT '';
ALTER TABLE quotations ADD COLUMN currency VARCHAR(12) NOT NULL DEFAULT 'PHP';
ALTER TABLE quotations ADD COLUMN vat_rate DECIMAL(6,2) NOT NULL DEFAULT 12.00;
ALTER TABLE quotations ADD COLUMN discount_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00;
ALTER TABLE quotations ADD COLUMN discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE quotations ADD COLUMN estimated_manpower INT NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN estimated_duration_days INT NOT NULL DEFAULT 0;
ALTER TABLE quotations ADD COLUMN subtotal_pre_vat DECIMAL(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE quotations ADD COLUMN vat_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE quotations ADD COLUMN final_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE quotations ADD COLUMN revision_count INT NOT NULL DEFAULT 1;
ALTER TABLE quotations ADD COLUMN sent_at DATETIME NULL;
ALTER TABLE quotations ADD COLUMN accepted_at DATETIME NULL;
ALTER TABLE quotations ADD COLUMN converted_at DATETIME NULL;
ALTER TABLE quotations ADD COLUMN converted_by BIGINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS quotation_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_id BIGINT UNSIGNED NOT NULL,
  revision_code VARCHAR(16) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'draft',
  subject VARCHAR(500) DEFAULT '',
  site_location VARCHAR(255) DEFAULT '',
  province VARCHAR(120) DEFAULT '',
  municipality VARCHAR(120) DEFAULT '',
  barangay VARCHAR(120) DEFAULT '',
  zip_code VARCHAR(20) DEFAULT '',
  attention_to VARCHAR(150) DEFAULT '',
  attention_title VARCHAR(150) DEFAULT '',
  thru_person VARCHAR(150) DEFAULT '',
  thru_title VARCHAR(150) DEFAULT '',
  estimated_manpower INT NOT NULL DEFAULT 0,
  estimated_duration_days INT NOT NULL DEFAULT 0,
  vat_rate DECIMAL(6,2) NOT NULL DEFAULT 12.00,
  discount_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  scope_options_json JSON NOT NULL,
  terms_json JSON NOT NULL,
  notes_json JSON NOT NULL,
  subtotal_mat_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  subtotal_lbr_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_direct_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  subtotal_mat_sell DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  subtotal_lbr_sell DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_selling_pre_vat DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  vat_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_selling_vat_inc DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  final_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  gross_profit_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  gross_profit_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  snapshot_json LONGTEXT NOT NULL,
  revision_reason TEXT NULL,
  prepared_by BIGINT UNSIGNED NULL,
  prepared_by_title VARCHAR(150) DEFAULT '',
  reviewed_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_by_title VARCHAR(150) DEFAULT '',
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rev_code (quotation_id, revision_code),
  CONSTRAINT fk_qrev_q FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_sections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  revision_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  title VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_collapsed TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_qsec_rev FOREIGN KEY (revision_id) REFERENCES quotation_revisions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  revision_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  parent_item_id BIGINT UNSIGNED NULL,
  row_type VARCHAR(24) NOT NULL DEFAULT 'item',
  line_no VARCHAR(32) DEFAULT '',
  item_code VARCHAR(64) DEFAULT '',
  description TEXT NOT NULL,
  specification TEXT NULL,
  qty DECIMAL(14,4) NOT NULL DEFAULT 1.0000,
  unit VARCHAR(32) DEFAULT 'lot',
  mat_pricing_mode VARCHAR(24) NOT NULL DEFAULT 'computed',
  lbr_pricing_mode VARCHAR(24) NOT NULL DEFAULT 'computed',
  visibility_mode VARCHAR(24) NOT NULL DEFAULT 'visible',
  rollup_children TINYINT(1) NOT NULL DEFAULT 0,
  mat_unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  lbr_unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  mat_gp_pct DECIMAL(6,4) NOT NULL DEFAULT 0.3000,
  lbr_gp_pct DECIMAL(6,4) NOT NULL DEFAULT 0.3000,
  mat_sell_rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  lbr_sell_rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  combined_unit_rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  extended_mat_sell DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  extended_lbr_sell DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  extended_selling DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  extended_mat_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  extended_lbr_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  extended_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  gross_profit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  override_mat_rate DECIMAL(14,2) NULL,
  override_lbr_rate DECIMAL(14,2) NULL,
  override_reason TEXT NULL,
  overridden_by BIGINT UNSIGNED NULL,
  overridden_at DATETIME NULL,
  catalog_item_id BIGINT UNSIGNED NULL,
  supplier_ref VARCHAR(255) DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_qitm_rev FOREIGN KEY (revision_id) REFERENCES quotation_revisions(id) ON DELETE CASCADE,
  CONSTRAINT fk_qitm_sec FOREIGN KEY (section_id) REFERENCES quotation_sections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_approvals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  stage VARCHAR(64) NOT NULL,
  decision VARCHAR(40) NOT NULL,
  previous_status VARCHAR(40) DEFAULT '',
  new_status VARCHAR(40) NOT NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qapp_q FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  comment TEXT NOT NULL,
  is_internal TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qcmt_q FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_catalog_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  specification TEXT NULL,
  category VARCHAR(120) NOT NULL,
  subcategory VARCHAR(120) DEFAULT '',
  default_unit VARCHAR(32) NOT NULL DEFAULT 'lot',
  mat_unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  lbr_unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  default_mat_gp_pct DECIMAL(6,4) NOT NULL DEFAULT 0.3000,
  default_lbr_gp_pct DECIMAL(6,4) NOT NULL DEFAULT 0.3000,
  supplier_ref VARCHAR(255) DEFAULT '',
  is_general_requirement TINYINT(1) NOT NULL DEFAULT 0,
  calc_rule VARCHAR(40) DEFAULT 'fixed',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  remarks TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_item_price_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  catalog_item_id BIGINT UNSIGNED NOT NULL,
  cost_type VARCHAR(24) NOT NULL,
  previous_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  new_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  effective_date DATE NOT NULL,
  supplier_ref VARCHAR(255) DEFAULT '',
  updated_by BIGINT UNSIGNED NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qph_cat FOREIGN KEY (catalog_item_id) REFERENCES quotation_catalog_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_units (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  label VARCHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  section_default VARCHAR(16) DEFAULT 'B',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ph_locations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  region VARCHAR(120) NOT NULL,
  province VARCHAR(120) NOT NULL,
  municipality VARCHAR(120) NOT NULL,
  barangay VARCHAR(120) DEFAULT '',
  zip_code VARCHAR(20) DEFAULT '',
  distance_km DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  mobilization_tier VARCHAR(64) DEFAULT 'Metro',
  base_mobilization_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_settings (
  id INT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL DEFAULT 'REV1 CONSTRUCTION CORP.',
  company_address VARCHAR(500) NOT NULL,
  company_email VARCHAR(150) NOT NULL DEFAULT 'info@rev1corp.com',
  company_phone VARCHAR(80) NOT NULL DEFAULT '(+632) 8516 - 4938',
  payee_name VARCHAR(255) NOT NULL DEFAULT 'REV1 CONSTRUCTION CORP',
  prefix VARCHAR(24) NOT NULL DEFAULT 'RCC',
  year_code VARCHAR(8) NOT NULL DEFAULT '26',
  next_seq BIGINT NOT NULL DEFAULT 1998068,
  doc_type VARCHAR(24) NOT NULL DEFAULT 'CONS',
  default_vat_rate DECIMAL(6,2) NOT NULL DEFAULT 12.00,
  default_mat_gp_pct DECIMAL(6,4) NOT NULL DEFAULT 0.3000,
  default_lbr_gp_pct DECIMAL(6,4) NOT NULL DEFAULT 0.3000,
  max_estimator_discount_pct DECIMAL(6,2) NOT NULL DEFAULT 2.00,
  max_pm_discount_pct DECIMAL(6,2) NOT NULL DEFAULT 5.00,
  min_gp_warning_pct DECIMAL(6,2) NOT NULL DEFAULT 20.00,
  require_two_step_approval TINYINT(1) NOT NULL DEFAULT 1,
  allow_self_approval TINYINT(1) NOT NULL DEFAULT 0,
  default_terms_json LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_conversion_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_id BIGINT UNSIGNED NOT NULL,
  revision_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  converted_by BIGINT UNSIGNED NOT NULL,
  override_reason TEXT NULL,
  budget_initialized TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qconv_q FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
  CONSTRAINT fk_qconv_p FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
