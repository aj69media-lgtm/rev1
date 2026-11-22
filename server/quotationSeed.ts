import { db, transaction } from './db.ts';
import {
  buildDefaultScopeSubject,
  getReferenceLikhaDataset,
  recalculateRevision,
  type ScopeOptions,
  type QuotationTerms,
} from './quotationEngine.ts';

export const DEFAULT_TERMS: QuotationTerms = {
  mobilization: 'Subject for Approval.',
  delivery: 'Subject for Approval.',
  warranty: '12 month/s warranty on Purchased Items and Workmanship except Force Majeure.',
  paymentTerms: '50% Down Payment, 50% Progress Billing.',
  downPaymentPct: 50,
  progressBillingPct: 50,
  retentionPct: 0,
  payeeName: 'REV1 CONSTRUCTION CORP',
  validity: 'Quote valid for 1 month/s from the Date of Issuance.',
  clientConsiderations: 'N/A',
  inclusions: 'Supply of above Equipment, Materials, and/or Construction Services.',
  exclusions: 'Excludes all others not mentioned on the above Quote.',
  additionalConditions: 'Any variation works outside the approved scope require a signed Variation Order prior to execution.',
};

export const DEFAULT_SCOPE_OPTIONS: ScopeOptions = {
  chkSupply: true,
  chkInstall: true,
  chkDelivery: true,
  chkDesign: false,
  chkTC: true,
  tradeType: 'optCons',
};

export function ensureQuotationReferenceData(): void {
  transaction(() => {
    // 1. Settings singleton
    db.prepare(
      `INSERT OR IGNORE INTO quotation_settings (
        id, company_name, company_address, company_email, company_phone, payee_name,
        prefix, year_code, next_seq, doc_type, default_vat_rate,
        default_mat_gp_pct, default_lbr_gp_pct, max_estimator_discount_pct,
        max_pm_discount_pct, min_gp_warning_pct, require_two_step_approval,
        allow_self_approval, default_terms_json
      ) VALUES (1, 'REV1 CONSTRUCTION CORP.', 'CM 104, CITI CONDOS, 214 MALINAO ST., BRGY. HIGHWAY HILLS, MANDALUYONG CITY',
        'info@rev1corp.example', '(+632) 8516-4938', 'REV1 CONSTRUCTION CORP',
        'RCC', '26', 1998068, 'CONS', 12, 0.3, 0.3, 2, 5, 20, 1, 0, ?)`
    ).run(JSON.stringify(DEFAULT_TERMS));

    // 2. Units
    const units: Array<[string, string]> = [
      ['lot', 'Lot'],
      ['pcs', 'Pieces'],
      ['set/s', 'Sets'],
      ['assy', 'Assembly'],
      ['unit', 'Units'],
      ['sqm', 'Square Meters (sq.m)'],
      ['cu.m', 'Cubic Meters (cu.m)'],
      ['ln.m', 'Linear Meters (ln.m)'],
      ['bags', 'Bags'],
      ['kgs', 'Kilograms'],
      ['sheet', 'Sheets'],
      ['roll', 'Rolls'],
      ['gals', 'Gallons'],
      ['box', 'Boxes'],
      ['pair', 'Pairs'],
      ['tubes', 'Tubes'],
      ['days', 'Days'],
      ['hours', 'Hours'],
    ];
    const insUnit = db.prepare('INSERT OR IGNORE INTO quotation_units (code, label) VALUES (?, ?)');
    for (const [code, label] of units) {
      insUnit.run(code, label);
    }

    // 3. Categories
    const categories: Array<[string, string, number]> = [
      ['General Requirements', 'A', 1],
      ['Masonry Works', 'B', 2],
      ['Tiling Works', 'B', 3],
      ['Painting Works', 'B', 4],
      ['Carpentry Works', 'B', 5],
      ['Custom Millwork', 'B', 6],
      ['Doors & Windows', 'B', 7],
      ['Plumbing Works', 'B', 8],
      ['Electrical Works', 'B', 9],
      ['Commercial Fixtures', 'C', 10],
    ];
    const insCat = db.prepare(
      'INSERT OR IGNORE INTO quotation_categories (name, section_default, sort_order) VALUES (?, ?, ?)'
    );
    for (const [name, sec, ord] of categories) {
      insCat.run(name, sec, ord);
    }

    // 4. PH Locations reference (PH_Data)
    const locCount = (db.prepare('SELECT COUNT(*) AS cnt FROM ph_locations').get() as { cnt: number }).cnt;
    if (locCount === 0) {
      const locs: Array<[string, string, string, string, string, number, string, number]> = [
        ['NCR', 'Metro Manila', 'Mandaluyong City', 'Highway Hills', '1550', 0, 'Metro Manila Base', 15000],
        ['NCR', 'Metro Manila', 'Makati City', 'Poblacion', '1210', 4.5, 'Metro Manila Core', 18000],
        ['NCR', 'Metro Manila', 'Quezon City', 'Novaliches', '1123', 18, 'Metro North', 24000],
        ['NCR', 'Metro Manila', 'Taguig City', 'Bonifacio Global City', '1634', 7.2, 'Metro Manila Core', 18500],
        ['NCR', 'Metro Manila', 'Pasig City', 'Ortigas Center', '1605', 3.1, 'Metro Manila Base', 16000],
        ['Region IV-A', 'Laguna', 'Santa Rosa City', 'Balibago', '4026', 42, 'Near Luzon', 35000],
        ['Region IV-A', 'Cavite', 'Bacoor City', 'Molino', '4102', 26, 'Near Luzon', 28000],
        ['Region III', 'Pampanga', 'San Fernando City', 'Dolores', '2000', 71, 'Central Luzon', 42000],
        ['Region VII', 'Cebu', 'Cebu City', 'Lahug', '6000', 572, 'Visayas Air/Sea', 132400],
        ['Region VI', 'Iloilo', 'Iloilo City', 'Mandurriao', '5000', 465, 'Visayas Air/Sea', 118000],
        ['Region XI', 'Davao del Sur', 'Davao City', 'Poblacion', '8000', 978, 'Mindanao Air/Sea', 165000],
      ];
      const insLoc = db.prepare(
        `INSERT INTO ph_locations (region, province, municipality, barangay, zip_code, distance_km, mobilization_tier, base_mobilization_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of locs) insLoc.run(...l);
    }

    // 5. Reusable Catalog & General Requirements Library
    const catCount = (db.prepare('SELECT COUNT(*) AS cnt FROM quotation_catalog_items').get() as { cnt: number }).cnt;
    if (catCount === 0) {
      const catalog: Array<{
        code: string;
        name: string;
        desc: string;
        spec: string;
        cat: string;
        sub: string;
        unit: string;
        matCost: number;
        lbrCost: number;
        isGR: number;
        rule: string;
        supplier: string;
      }> = [
        { code: 'GR-MOB', name: 'Mobilization / Demobilization', desc: 'Crew and equipment mobilization and demobilization to project site', spec: 'Round-trip logistics', cat: 'General Requirements', sub: 'Logistics', unit: 'lot', matCost: 0, lbrCost: 61500, isGR: 1, rule: 'location_based', supplier: 'Internal Logistics' },
        { code: 'GR-VIS', name: 'Site Visit & Survey', desc: 'Pre-construction engineering site inspection and verification', spec: 'Per scheduled trip', cat: 'General Requirements', sub: 'Engineering', unit: 'set/s', matCost: 0, lbrCost: 6000, isGR: 1, rule: 'fixed', supplier: 'Internal Engineering' },
        { code: 'GR-TRN', name: 'Manpower Transport / Delivery', desc: 'Crew shuttle and site transport allowance', spec: 'Deployment batch', cat: 'General Requirements', sub: 'Logistics', unit: 'set/s', matCost: 0, lbrCost: 20000, isGR: 1, rule: 'manpower_based', supplier: 'Transport Fleet' },
        { code: 'GR-RPT', name: 'Rapid Testing / Medical Clearance', desc: 'Pre-deployment site health & safety clearance', spec: 'Per worker', cat: 'General Requirements', sub: 'Safety', unit: 'set/s', matCost: 0, lbrCost: 500, isGR: 1, rule: 'manpower_based', supplier: 'Accredited Clinic' },
        { code: 'GR-PPE', name: 'Personal Protective Equipment (PPE)', desc: 'Hard hats, vests, safety shoes, gloves and eye protection', spec: 'DOLE OSH compliant', cat: 'General Requirements', sub: 'Safety', unit: 'set/s', matCost: 0, lbrCost: 500, isGR: 1, rule: 'manpower_based', supplier: 'SafetyPro PH' },
        { code: 'GR-TLS', name: 'Tools and Equipment', desc: 'Site hand tools, laser levels, scaffolding and power tools', spec: 'Project duration', cat: 'General Requirements', sub: 'Equipment', unit: 'set/s', matCost: 0, lbrCost: 1500, isGR: 1, rule: 'duration_based', supplier: 'Central Warehouse' },
        { code: 'GR-01', name: 'Site Management & Temporary Facilities', desc: 'Consolidated site management, temporary office/storage and welfare facilities', spec: 'Full project duration', cat: 'General Requirements', sub: 'Management', unit: 'lot', matCost: 0, lbrCost: 132400, isGR: 1, rule: 'duration_based', supplier: 'REV1 Site Ops' },
        { code: 'GR-ACC', name: 'Accommodation (Out-of-Town Crew)', desc: 'Crew quarters / barracks rental for out-of-base projects', spec: 'Monthly allocation', cat: 'General Requirements', sub: 'Welfare', unit: 'set/s', matCost: 0, lbrCost: 9500, isGR: 1, rule: 'duration_based', supplier: 'Regional Lodging' },
        { code: 'GR-UTL', name: 'Temporary Utilities (Power & Water)', desc: 'Temporary power and water connection allowance during works', spec: 'Monthly allowance', cat: 'General Requirements', sub: 'Utilities', unit: 'set/s', matCost: 0, lbrCost: 2000, isGR: 1, rule: 'duration_based', supplier: 'Site Utilities' },
        { code: 'GR-ENG', name: 'Engineering / Supervision', desc: 'Project engineer & site supervisor deployment allowance', spec: 'Per month', cat: 'General Requirements', sub: 'Supervision', unit: 'set/s', matCost: 0, lbrCost: 18000, isGR: 1, rule: 'duration_based', supplier: 'REV1 Engineering' },
        { code: 'GR-FD', name: 'Food Allowance', desc: 'Site crew meal subsidy during extended shift schedules', spec: 'Per deployment cycle', cat: 'General Requirements', sub: 'Welfare', unit: 'set/s', matCost: 0, lbrCost: 2200, isGR: 1, rule: 'manpower_based', supplier: 'Site Petty Cash' },
        { code: 'GR-PLN', name: 'Plans, Prints, Professional Sign & Seals', desc: 'Signed & sealed architectural/MEP plans by licensed professionals', spec: 'Complete permit set', cat: 'General Requirements', sub: 'Permits', unit: 'lot', matCost: 0, lbrCost: 37500, isGR: 1, rule: 'fixed', supplier: 'Partner Design Studio' },
        { code: 'GR-PRF', name: 'Professional Fee', desc: 'Technical consultation and project management professional fee', spec: 'Standard engagement', cat: 'General Requirements', sub: 'Management', unit: 'lot', matCost: 0, lbrCost: 30000, isGR: 1, rule: 'fixed', supplier: 'REV1 Management' },
        { code: 'GR-DSN', name: 'Design Fee', desc: '3D rendering, shop drawings and as-built drafting', spec: 'Full interior/arch package', cat: 'General Requirements', sub: 'Design', unit: 'lot', matCost: 0, lbrCost: 30000, isGR: 1, rule: 'fixed', supplier: 'REV1 Design' },
        { code: 'GR-PRT', name: 'Print Outs & As-Built Documentation', desc: 'Blueprint plotting, submittals and closeout binders', spec: '3 sets', cat: 'General Requirements', sub: 'Documentation', unit: 'lot', matCost: 0, lbrCost: 15000, isGR: 1, rule: 'fixed', supplier: 'Reprographics PH' },
        { code: 'GR-HAL', name: 'Provision for Hauling of Materials', desc: 'Debris hauling and material delivery shuttle on site', spec: 'Trucking allowance', cat: 'General Requirements', sub: 'Logistics', unit: 'lot', matCost: 0, lbrCost: 9150, isGR: 1, rule: 'fixed', supplier: 'Hauling Contractor' },
        { code: 'GR-BND', name: 'Bonds / Insurances (CARI / Performance)', desc: 'Contractor All-Risk Insurance and performance bond allocation', spec: 'As required by client', cat: 'General Requirements', sub: 'Insurance', unit: 'lot', matCost: 0, lbrCost: 0, isGR: 1, rule: 'fixed', supplier: 'Surety Partner' },
        { code: 'GR-PRM', name: "Gov't Permits & Legwork", desc: 'Barangay, building, occupancy and mall/admin work permits', spec: 'Processing & fees', cat: 'General Requirements', sub: 'Permits', unit: 'lot', matCost: 0, lbrCost: 30000, isGR: 1, rule: 'fixed', supplier: 'Permit Liaison' },
        { code: 'GR-TC', name: 'Engineering, Programming, Testing & Commissioning', desc: 'System balancing, electrical megger testing and commissioning', spec: 'Closeout QA', cat: 'General Requirements', sub: 'T&C', unit: 'lot', matCost: 0, lbrCost: 10000, isGR: 1, rule: 'fixed', supplier: 'REV1 QA/QC' },
        { code: 'GR-DEL', name: 'Delivery Fee', desc: 'Freight & inter-island / regional materials delivery', spec: 'Standard cargo', cat: 'General Requirements', sub: 'Logistics', unit: 'lot', matCost: 0, lbrCost: 30000, isGR: 1, rule: 'location_based', supplier: '2GO / Cargo Partner' },

        // Construction Items Catalog (from reference workbook)
        { code: 'RBR-10', name: 'Deformed Rebar, 10mm x 6m', desc: 'rebar, 10 mm Grade 40', spec: 'ASTM A615 / PNS 49', cat: 'Masonry Works', sub: 'Reinforcement', unit: 'pcs', matCost: 189, lbrCost: 75.6, isGR: 0, rule: 'fixed', supplier: 'Pag-asa Steel' },
        { code: 'CHB-4', name: 'Concrete Hollow Blocks 4" thk', desc: "CHB 4'' thk standard", spec: '400 psi non-load bearing', cat: 'Masonry Works', sub: 'Blocks', unit: 'pcs', matCost: 21, lbrCost: 8.4, isGR: 0, rule: 'fixed', supplier: 'Cebu Concrete Corp' },
        { code: 'CEM-40', name: 'Portland Cement, 40kg Bag', desc: 'Portland Cement Type I', spec: '40kg/bag', cat: 'Masonry Works', sub: 'Binders', unit: 'bags', matCost: 253, lbrCost: 101.2, isGR: 0, rule: 'fixed', supplier: 'Republic Cement' },
        { code: 'TIL-6060', name: 'Tiles, 60cm x 60cm Polished Porcelain White', desc: 'Polished Porcelain Floor Tile 600x600mm', spec: 'Rectified edge, glossy white', cat: 'Tiling Works', sub: 'Floor Tiles', unit: 'pcs', matCost: 200, lbrCost: 80, isGR: 0, rule: 'fixed', supplier: 'Wilcon Depot' },
        { code: 'TIL-ADH', name: 'ABC Tile Adhesive, 25kg', desc: 'ABC Tile Adhesive 25kgs bag', spec: 'Heavy-duty polymer modified', cat: 'Tiling Works', sub: 'Adhesives', unit: 'bags', matCost: 330, lbrCost: 132, isGR: 0, rule: 'fixed', supplier: 'ABC Chemical' },
        { code: 'PNT-SKM', name: 'MondoSkim Coat, 20kg Bag', desc: 'Interior concrete skim coat 20kg', spec: '20 sq.m coverage/bag', cat: 'Painting Works', sub: 'Surface Prep', unit: 'bags', matCost: 560, lbrCost: 224, isGR: 0, rule: 'fixed', supplier: 'Davies Paints' },
        { code: 'PNT-TOP', name: 'Davies Megacryl Semi-Gloss Topcoat', desc: 'Water-based acrylic semi-gloss finish', spec: '1 gallon container', cat: 'Painting Works', sub: 'Topcoat', unit: 'gals', matCost: 820, lbrCost: 328, isGR: 0, rule: 'fixed', supplier: 'Davies Paints' },
        { code: 'CAR-SLT', name: 'Interior Acoustic Slat Panel (600x2400mm)', desc: 'Wood-finish PET acoustic wall/ceiling slat panel', spec: '600 x 2400 x 21mm', cat: 'Carpentry Works', sub: 'Ceilings', unit: 'pcs', matCost: 3900, lbrCost: 1560, isGR: 0, rule: 'fixed', supplier: 'DecoBuild Supplies' },
        { code: 'MWK-PLY18', name: '18mm Marine Plywood', desc: 'Phenolic / Marine grade plywood 4x8 ft', spec: '18mm thickness', cat: 'Custom Millwork', sub: 'Boards', unit: 'sheet', matCost: 2450, lbrCost: 980, isGR: 0, rule: 'fixed', supplier: 'Sta. Clara Lumber' },
        { code: 'DRW-FLSH', name: 'Solid Wooden Flush Door Set', desc: 'Complete solid core flush door with jamb and lockset', spec: '900 x 2100mm', cat: 'Doors & Windows', sub: 'Doors', unit: 'set/s', matCost: 6500, lbrCost: 1625, isGR: 0, rule: 'fixed', supplier: 'Matimco' },
        { code: 'PLM-WC', name: 'Water Closet Set (Dual Flush)', desc: 'One-piece ceramic water closet with seat cover & angle valve', spec: '3/6L dual flush', cat: 'Plumbing Works', sub: 'Fixtures', unit: 'set/s', matCost: 8270, lbrCost: 2067.5, isGR: 0, rule: 'fixed', supplier: 'HCG Philippines' },
        { code: 'ELC-FLR', name: 'LED Fluorescent Light Fixture', desc: 'Linear LED batten / recessed light 18W daylight', spec: '220V 6500K', cat: 'Electrical Works', sub: 'Lighting', unit: 'pcs', matCost: 350, lbrCost: 87.5, isGR: 0, rule: 'fixed', supplier: 'Firefly Electric' },
        { code: 'CFX-01', name: 'Fabricated Double-Sided Gondola Shelf', desc: 'Powder-coated steel retail gondola display rack (double-sided)', spec: '1200 x 900 x 1500mm', cat: 'Commercial Fixtures', sub: 'Retail Racking', unit: 'pcs', matCost: 8500, lbrCost: 850, isGR: 0, rule: 'fixed', supplier: 'REV1 Fabrication' },
        { code: 'CFX-02', name: 'Fabricated Wall Gondola Shelf', desc: 'Powder-coated steel retail wall display gondola', spec: '1200 x 450 x 2100mm', cat: 'Commercial Fixtures', sub: 'Retail Racking', unit: 'pcs', matCost: 6500, lbrCost: 650, isGR: 0, rule: 'fixed', supplier: 'REV1 Fabrication' },
        { code: 'CFX-03', name: 'Gondola End Cap Display', desc: 'Steel retail gondola end-cap shelving unit', spec: '900 x 450 x 1500mm', cat: 'Commercial Fixtures', sub: 'Retail Racking', unit: 'pcs', matCost: 6200, lbrCost: 620, isGR: 0, rule: 'fixed', supplier: 'REV1 Fabrication' },
        { code: 'CFX-RACK', name: 'Heavy-Duty Steel Storage Rack (5 Layers)', desc: 'Boltless industrial stockroom shelving rack 5-tier', spec: '2000 x 600 x 2000mm', cat: 'Commercial Fixtures', sub: 'Stockroom', unit: 'unit', matCost: 5200, lbrCost: 1300, isGR: 0, rule: 'fixed', supplier: 'REV1 Fabrication' },
      ];

      const insCatItem = db.prepare(
        `INSERT INTO quotation_catalog_items (
          item_code, name, description, specification, category, subcategory,
          default_unit, mat_unit_cost, lbr_unit_cost, default_mat_gp_pct, default_lbr_gp_pct,
          supplier_ref, is_general_requirement, calc_rule, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.3, 0.3, ?, ?, ?, 1)`
      );
      const insHist = db.prepare(
        `INSERT INTO quotation_item_price_history (
          catalog_item_id, cost_type, previous_cost, new_cost, effective_date, supplier_ref, remarks
        ) VALUES (?, ?, 0, ?, date('now'), ?, 'Initial REV1 workbook baseline')`
      );
      for (const c of catalog) {
        const res = insCatItem.run(
          c.code, c.name, c.desc, c.spec, c.cat, c.sub,
          c.unit, c.matCost, c.lbrCost, c.supplier, c.isGR, c.rule
        );
        const cid = Number(res.lastInsertRowid);
        if (c.matCost > 0) insHist.run(cid, 'material', c.matCost, c.supplier);
        if (c.lbrCost > 0) insHist.run(cid, 'labor', c.lbrCost, c.supplier);
      }
    }

    // 6. Seed Likha ni Inay Cebu Ground Floor Reference Quotation (RCC26-1998067-CONS REV01) if absent
    const existingRefQuote = db
      .prepare("SELECT id FROM quotations WHERE quote_number = 'RCC26-1998067-CONS'")
      .get() as { id: number } | undefined;

    if (!existingRefQuote) {
      let client = db
        .prepare("SELECT id FROM clients WHERE company_name LIKE '%Likha%' OR company_name LIKE '%CMPMI%' LIMIT 1")
        .get() as { id: number } | undefined;
      if (!client) {
        const clRes = db
          .prepare(
            `INSERT INTO clients (company_name, primary_contact, representative_title, email, phone, address, notes)
             VALUES ('CMPMI (Likha ni Inay Cebu)', 'Maida B. Decano', 'President', 'projects@cmpmi.example', '(+6332) 555-0140', 'Cebu City, Cebu', 'Commercial retail fit-out client (reference account)')`
          )
          .run();
        client = { id: Number(clRes.lastInsertRowid) };
      }

      const prepUser = db
        .prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1")
        .get() as { id: number } | undefined;

      const refData = getReferenceLikhaDataset();
      const summary = recalculateRevision(refData);
      const subject = buildDefaultScopeSubject(DEFAULT_SCOPE_OPTIONS, 'LIKHA NI INAY CEBU GROUND FLOOR ARCHITECTURAL WORKS');
      const notes = [
        'Client Considerations: N/A',
        'Supply of above Equipment and/or Services.',
        'Excludes all others not mentioned on the above Quote.',
      ];

      const qRes = db
        .prepare(
          `INSERT INTO quotations (
            quote_number, client_id, title, location, scope, validity_date, status,
            direct_cost, tax_pct, total_amount, prepared_by, notes,
            current_revision_code, subject, site_location, province, municipality,
            attention_to, attention_title, thru_person, thru_title, currency,
            vat_rate, discount_pct, discount_amount, estimated_manpower, estimated_duration_days,
            subtotal_pre_vat, vat_amount, final_amount, revision_count
          ) VALUES (
            'RCC26-1998067-CONS', ?, 'Likha ni Inay Cebu Ground Floor Fit-Out', 'Cebu City, Cebu',
            'Architectural, Masonry, Tiling, Painting, Carpentry, Millwork, Doors, Plumbing, Electrical & Commercial Fixtures',
            date('now', '+30 days'), 'approved',
            ?, 12, ?, ?, 'Reference REV1 quotation matching RCC26-1998067-CONS REV01 workbook.',
            'REV01', ?, 'CEBU CITY, CEBU', 'Cebu', 'Cebu City',
            'Ms. Maida B. Decano', 'CMPMI - President', 'Engr. Gerry Garcia', 'Project Manager', 'PHP',
            12, 0, 0, 15, 90,
            ?, ?, ?, 1
          )`
        )
        .run(
          client.id,
          summary.totalDirectCost,
          summary.finalAmount,
          prepUser?.id || null,
          subject,
          summary.totalSellingPreVat,
          summary.vatAmount,
          summary.finalAmount
        );
      const quotationId = Number(qRes.lastInsertRowid);

      const revRes = db
        .prepare(
          `INSERT INTO quotation_revisions (
            quotation_id, revision_code, status, subject, site_location, province, municipality,
            attention_to, attention_title, thru_person, thru_title,
            estimated_manpower, estimated_duration_days, vat_rate, discount_pct,
            scope_options_json, terms_json, notes_json,
            subtotal_mat_cost, subtotal_lbr_cost, total_direct_cost,
            subtotal_mat_sell, subtotal_lbr_sell, total_selling_pre_vat,
            vat_amount, total_selling_vat_inc, discount_amount, final_amount,
            gross_profit_amount, gross_profit_pct, snapshot_json, revision_reason,
            prepared_by, prepared_by_title, approved_by, approved_by_title, is_locked
          ) VALUES (
            ?, 'REV01', 'approved', ?, 'CEBU CITY, CEBU', 'Cebu', 'Cebu City',
            'Ms. Maida B. Decano', 'CMPMI - President', 'Engr. Gerry Garcia', 'Project Manager',
            15, 90, 12, 0,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, 0, ?,
            ?, ?, ?, 'Baseline validated REV01 reference workbook import',
            ?, 'Technical Sales Supervisor', ?, 'President', 1
          )`
        )
        .run(
          quotationId,
          subject,
          JSON.stringify(DEFAULT_SCOPE_OPTIONS),
          JSON.stringify(DEFAULT_TERMS),
          JSON.stringify(notes),
          summary.subtotalMatCost,
          summary.subtotalLbrCost,
          summary.totalDirectCost,
          summary.subtotalMatSell,
          summary.subtotalLbrSell,
          summary.totalSellingPreVat,
          summary.vatAmount,
          summary.totalSellingVatInc,
          summary.finalAmount,
          summary.grossProfitAmount,
          summary.grossProfitPct,
          JSON.stringify({ vatRate: 12, discountPct: 0, sections: summary.sectionSubtotals }),
          prepUser?.id || null,
          prepUser?.id || null
        );
      const revisionId = Number(revRes.lastInsertRowid);
      db.prepare('UPDATE quotations SET current_revision_id = ? WHERE id = ?').run(revisionId, quotationId);

      // Sections
      const secIdMap = new Map<string, number>();
      const insSec = db.prepare(
        'INSERT INTO quotation_sections (revision_id, code, title, sort_order, is_collapsed) VALUES (?, ?, ?, ?, 0)'
      );
      for (const sec of refData.sections) {
        const sRes = insSec.run(revisionId, sec.code, sec.title, sec.sortOrder);
        secIdMap.set(sec.tempKey!, Number(sRes.lastInsertRowid));
      }

      // Items (two-pass to link parent_item_id for subitems)
      const itemKeyToId = new Map<string, number>();
      const insItem = db.prepare(
        `INSERT INTO quotation_items (
          revision_id, section_id, parent_item_id, row_type, line_no, item_code, description, specification,
          qty, unit, mat_pricing_mode, lbr_pricing_mode, visibility_mode, rollup_children,
          mat_unit_cost, lbr_unit_cost, mat_gp_pct, lbr_gp_pct,
          mat_sell_rate, lbr_sell_rate, combined_unit_rate,
          extended_mat_sell, extended_lbr_sell, extended_selling,
          extended_mat_cost, extended_lbr_cost, extended_cost, gross_profit, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of summary.items) {
        const sectionId = secIdMap.get(it.sectionKey!)!;
        const parentId = it.parentKey ? itemKeyToId.get(it.parentKey) ?? null : null;
        const itRes = insItem.run(
          revisionId,
          sectionId,
          parentId,
          it.rowType,
          it.lineNo,
          it.itemCode,
          it.description,
          it.specification || '',
          it.qty,
          it.unit,
          it.matPricingMode,
          it.lbrPricingMode,
          it.visibilityMode,
          it.matUnitCost,
          it.lbrUnitCost,
          it.matGpPct,
          it.lbrGpPct,
          it.matSellRate,
          it.lbrSellRate,
          it.combinedUnitRate,
          it.extendedMatSell,
          it.extendedLbrSell,
          it.extendedSelling,
          it.extendedMatCost,
          it.extendedLbrCost,
          it.extendedCost,
          it.grossProfit,
          it.sortOrder
        );
        if (it.tempKey) {
          itemKeyToId.set(it.tempKey, Number(itRes.lastInsertRowid));
        }
      }

      if (prepUser) {
        db.prepare(
          `INSERT INTO quotation_approvals (quotation_id, revision_id, actor_id, stage, decision, previous_status, new_status, remarks)
           VALUES (?, ?, ?, 'Management Approval', 'approved', 'for_approval', 'approved', 'Reference workbook calculation verified')`
        ).run(quotationId, revisionId, prepUser.id);
      }
    }
  });
}
