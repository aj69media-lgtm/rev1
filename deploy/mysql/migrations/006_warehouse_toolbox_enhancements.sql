-- BuildCore CBMS - Migration 006: Warehouse Releases, Reserved Inventory & Equipment Deployment Enhancements
ALTER TABLE inventory_items
  ADD COLUMN reserved_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER current_qty,
  ADD COLUMN issued_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00 AFTER reserved_qty;

ALTER TABLE equipment
  ADD COLUMN asset_number VARCHAR(100) DEFAULT '' AFTER serial_number,
  ADD COLUMN acquisition_date DATE DEFAULT NULL AFTER asset_number,
  ADD COLUMN deployment_date DATE DEFAULT NULL AFTER condition_status,
  ADD COLUMN expected_return_date DATE DEFAULT NULL AFTER deployment_date;

CREATE TABLE IF NOT EXISTS warehouse_releases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_number VARCHAR(64) NOT NULL UNIQUE,
  project_id BIGINT UNSIGNED NOT NULL,
  request_date DATE NOT NULL,
  release_date DATE DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'requested',
  warehouse_location VARCHAR(160) DEFAULT 'Central Warehouse',
  released_by BIGINT UNSIGNED NULL,
  received_by BIGINT UNSIGNED NULL,
  remarks VARCHAR(255) DEFAULT '',
  documents_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wr_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_released FOREIGN KEY (released_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_wr_received FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_release_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  release_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  requested_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  approved_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  released_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  received_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  consumed_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  returned_qty DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  CONSTRAINT fk_wri_release FOREIGN KEY (release_id) REFERENCES warehouse_releases(id) ON DELETE CASCADE,
  CONSTRAINT fk_wri_item FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, name) VALUES ('006', 'warehouse_toolbox_enhancements');
