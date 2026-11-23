-- Migration 009: Preserve Work Package Assembly Version, Selected Supplier Snapshot & Measurement Formula on Quotation Items
ALTER TABLE quotation_items ADD COLUMN source_assembly_id BIGINT UNSIGNED NULL;
ALTER TABLE quotation_items ADD COLUMN source_assembly_code VARCHAR(64) DEFAULT '';
ALTER TABLE quotation_items ADD COLUMN source_assembly_version INT NULL;
ALTER TABLE quotation_items ADD COLUMN supplier_id BIGINT UNSIGNED NULL;
ALTER TABLE quotation_items ADD COLUMN supplier_price_id BIGINT UNSIGNED NULL;
ALTER TABLE quotation_items ADD COLUMN component_type VARCHAR(32) DEFAULT '';
ALTER TABLE quotation_items ADD COLUMN calc_basis VARCHAR(32) DEFAULT '';
ALTER TABLE quotation_items ADD COLUMN consumption_rate DECIMAL(14,4) NULL;
ALTER TABLE quotation_items ADD COLUMN wastage_pct DECIMAL(6,2) NULL;
ALTER TABLE quotation_items ADD COLUMN measurement_qty DECIMAL(14,4) NULL;
ALTER TABLE quotation_items ADD COLUMN formula_text TEXT NULL;
CREATE INDEX idx_quote_items_asm ON quotation_items(source_assembly_id);
