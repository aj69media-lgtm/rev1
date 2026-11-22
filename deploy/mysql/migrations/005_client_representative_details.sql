-- BuildCore CBMS - Migration 005: Extended Client Profile & Representative Details
ALTER TABLE clients
  ADD COLUMN representative_title VARCHAR(160) DEFAULT '' AFTER primary_contact,
  ADD COLUMN secondary_contact VARCHAR(200) DEFAULT '' AFTER phone,
  ADD COLUMN notes TEXT NULL AFTER address;

INSERT IGNORE INTO schema_migrations (version, name) VALUES ('005', 'client_representative_details');
