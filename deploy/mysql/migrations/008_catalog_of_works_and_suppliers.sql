-- Migration 008: Catalog of Works Management, Reusable Sets of Works, Suppliers, Version Control & Protected Attachments
INSERT IGNORE INTO modules (slug, name, description, version, dependencies_json, required_permissions_json, is_enabled)
VALUES (
  'catalog',
  'Catalog of Works Management',
  'Master Individual Items Catalog, Configurable Work Categories, Reusable Sets of Works, Version Control & Supplier Pricing.',
  '1.0.0',
  '["quotations"]',
  '["view","create_item","edit_item","manage_categories","create_assembly","edit_assembly","duplicate_assembly","archive_record","restore_record","manage_suppliers","manage_supplier_prices","override_cost","view_internal_costing","request_item"]',
  1
);

ALTER TABLE quotation_catalog_items ADD COLUMN item_type VARCHAR(32) NOT NULL DEFAULT 'Material';
ALTER TABLE quotation_catalog_items ADD COLUMN archived_at DATETIME NULL;
ALTER TABLE quotation_catalog_items ADD COLUMN archived_by BIGINT UNSIGNED NULL;
ALTER TABLE quotation_catalog_items ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  supplier_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL UNIQUE,
  contact_person VARCHAR(150) DEFAULT '',
  email VARCHAR(190) DEFAULT '',
  phone VARCHAR(64) DEFAULT '',
  address TEXT NULL,
  category_tags VARCHAR(255) DEFAULT '',
  payment_terms VARCHAR(100) DEFAULT '30 Days',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_item_supplier_prices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  catalog_item_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  supplier_item_ref VARCHAR(120) DEFAULT '',
  brand VARCHAR(120) DEFAULT '',
  specifications TEXT NULL,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  effective_date DATE NOT NULL,
  valid_until DATE NULL,
  attachment_id BIGINT UNSIGNED NULL,
  remarks TEXT NULL,
  is_preferred TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cisp_item FOREIGN KEY (catalog_item_id) REFERENCES quotation_catalog_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_cisp_sup FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_assemblies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assembly_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  category_name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  specifications TEXT NULL,
  unit VARCHAR(32) NOT NULL DEFAULT 'sq.m',
  default_calc_method VARCHAR(32) NOT NULL DEFAULT 'per_sqm',
  default_qty DECIMAL(14,4) NOT NULL DEFAULT 1.0000,
  labor_requirements TEXT NULL,
  installation_instructions TEXT NULL,
  notes TEXT NULL,
  current_version INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  archived_at DATETIME NULL,
  archived_by BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_assembly_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assembly_id BIGINT UNSIGNED NOT NULL,
  catalog_item_id BIGINT UNSIGNED NULL,
  component_type VARCHAR(32) NOT NULL DEFAULT 'Material',
  item_code VARCHAR(64) DEFAULT '',
  item_name VARCHAR(255) NOT NULL,
  specification TEXT NULL,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  calc_basis VARCHAR(32) NOT NULL DEFAULT 'per_unit',
  consumption_rate DECIMAL(14,4) NOT NULL DEFAULT 1.0000,
  wastage_pct DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  preferred_supplier_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_wai_asm FOREIGN KEY (assembly_id) REFERENCES work_assemblies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_assembly_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assembly_id BIGINT UNSIGNED NOT NULL,
  version_number INT NOT NULL,
  change_summary TEXT NULL,
  snapshot_json LONGTEXT NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_asm_ver (assembly_id, version_number),
  CONSTRAINT fk_wav_asm FOREIGN KEY (assembly_id) REFERENCES work_assemblies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_type VARCHAR(32) NOT NULL DEFAULT 'new_item',
  requested_name VARCHAR(255) NOT NULL,
  category VARCHAR(120) DEFAULT '',
  item_type VARCHAR(32) NOT NULL DEFAULT 'Material',
  specification TEXT NULL,
  suggested_unit VARCHAR(32) DEFAULT 'pcs',
  suggested_supplier VARCHAR(255) DEFAULT '',
  estimated_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  review_notes TEXT NULL,
  created_item_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS protected_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(48) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pa_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
