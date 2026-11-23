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

  ensureCatalogOfWorksSeed();
}

export function ensureCatalogOfWorksSeed(): void {
  transaction(() => {
    // A. Ensure all configurable units exist
    const allUnits: Array<[string, string]> = [
      ['lot', 'Lot'],
      ['pcs', 'Pieces'],
      ['set/s', 'Sets'],
      ['assy', 'Assembly'],
      ['unit', 'Units'],
      ['sqm', 'Square Meters (sqm)'],
      ['sq.m', 'Square Meters (sq.m)'],
      ['cu.m', 'Cubic Meters (cu.m)'],
      ['cu.m.', 'Cubic Meters (cu.m.)'],
      ['ln.m', 'Linear Meters (ln.m)'],
      ['bags', 'Bags'],
      ['kgs', 'Kilograms'],
      ['kg', 'Kilograms (kg)'],
      ['sheet', 'Sheets'],
      ['roll', 'Rolls'],
      ['gals', 'Gallons'],
      ['box', 'Boxes'],
      ['pair', 'Pairs'],
      ['tubes', 'Tubes'],
      ['lengths', 'Standard Lengths (6m)'],
      ['day', 'Man-Days'],
      ['days', 'Days'],
      ['hours', 'Hours'],
    ];
    const insUnit = db.prepare('INSERT OR IGNORE INTO quotation_units (code, label) VALUES (?, ?)');
    for (const [code, label] of allUnits) insUnit.run(code, label);

    // B. Ensure all required Work Categories exist (all 17 Part 2.3 categories)
    const allCategories: Array<[string, string, number]> = [
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
      ['Concrete Works', 'B', 11],
      ['Waterproofing Works', 'B', 12],
      ['Ceiling Works', 'B', 13],
      ['Roofing Works', 'B', 14],
      ['Metal Works', 'B', 15],
      ['Fabrication Works', 'C', 16],
      ['Custom Works', 'B', 17],
    ];
    const insCat = db.prepare(
      'INSERT OR IGNORE INTO quotation_categories (name, section_default, sort_order) VALUES (?, ?, ?)'
    );
    for (const [name, sec, ord] of allCategories) insCat.run(name, sec, ord);

    // C. Update item_type on existing GR items cleanly
    db.prepare("UPDATE quotation_catalog_items SET item_type = 'Service' WHERE is_general_requirement = 1 AND item_type = 'Material'").run();

    // D. Seed essential construction Material & Labor items for Sets of Works (idempotent INSERT OR IGNORE)
    const prepUser = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
    const moreItems: Array<{
      code: string;
      name: string;
      desc: string;
      spec: string;
      cat: string;
      sub: string;
      unit: string;
      type: string;
      matCost: number;
      lbrCost: number;
      supplier: string;
    }> = [
      { code: 'RBR-10', name: 'Deformed Rebar, 10mm x 6m', desc: 'rebar, 10 mm Grade 40', spec: 'ASTM A615 / PNS 49', cat: 'Masonry Works', sub: 'Reinforcement', unit: 'pcs', type: 'Material', matCost: 189, lbrCost: 75.6, supplier: 'Pag-asa Steel' },
      { code: 'CHB-4', name: 'Concrete Hollow Blocks 4" thk', desc: "CHB 4'' thk standard", spec: '400 psi non-load bearing', cat: 'Masonry Works', sub: 'Blocks', unit: 'pcs', type: 'Material', matCost: 21, lbrCost: 8.4, supplier: 'Cebu Concrete Corp' },
      { code: 'CEM-40', name: 'Portland Cement, 40kg Bag', desc: 'Portland Cement Type I', spec: '40kg/bag', cat: 'Masonry Works', sub: 'Binders', unit: 'bags', type: 'Material', matCost: 253, lbrCost: 101.2, supplier: 'Republic Cement' },
      { code: 'TIL-6060', name: 'Tiles, 60cm x 60cm Polished Porcelain White', desc: 'Polished Porcelain Floor Tile 600x600mm', spec: 'Rectified edge, glossy white', cat: 'Tiling Works', sub: 'Floor Tiles', unit: 'pcs', type: 'Material', matCost: 200, lbrCost: 80, supplier: 'Wilcon Depot' },
      { code: 'TIL-ADH', name: 'ABC Tile Adhesive, 25kg', desc: 'ABC Tile Adhesive 25kgs bag', spec: 'Heavy-duty polymer modified', cat: 'Tiling Works', sub: 'Adhesives', unit: 'bags', type: 'Material', matCost: 330, lbrCost: 132, supplier: 'ABC Chemical' },
      { code: 'PNT-SKM', name: 'MondoSkim Coat, 20kg Bag', desc: 'Interior concrete skim coat 20kg', spec: '20 sq.m coverage/bag', cat: 'Painting Works', sub: 'Surface Prep', unit: 'bags', type: 'Material', matCost: 560, lbrCost: 224, supplier: 'Davies Paints' },
      { code: 'PNT-TOP', name: 'Davies Megacryl Semi-Gloss Topcoat', desc: 'Water-based acrylic semi-gloss finish', spec: '1 gallon container', cat: 'Painting Works', sub: 'Topcoat', unit: 'gals', type: 'Material', matCost: 820, lbrCost: 328, supplier: 'Davies Paints' },
      { code: 'PLM-WC', name: 'Water Closet Set (Dual Flush)', desc: 'One-piece ceramic water closet with seat cover & angle valve', spec: '3/6L dual flush', cat: 'Plumbing Works', sub: 'Fixtures', unit: 'set/s', type: 'Material', matCost: 8270, lbrCost: 2067.5, supplier: 'HCG Philippines' },
      { code: 'ELC-FLR', name: 'LED Fluorescent Light Fixture', desc: 'Linear LED batten / recessed light 18W daylight', spec: '220V 6500K', cat: 'Electrical Works', sub: 'Lighting', unit: 'pcs', type: 'Material', matCost: 350, lbrCost: 87.5, supplier: 'Firefly Electric' },
      { code: 'TIE-16', name: 'GI Tie Wire #16', desc: 'Galvanized iron tie wire gauge #16', spec: 'Standard 1.6mm galvanized binding wire', cat: 'Masonry Works', sub: 'Reinforcement', unit: 'kg', type: 'Material', matCost: 95, lbrCost: 0, supplier: 'Hardware & Fasteners PH' },
      { code: 'SND-WSH', name: 'Washed River Sand (S1)', desc: 'Screened washed sand for masonry mortar & plastering', spec: 'Fine clean river sand', cat: 'Masonry Works', sub: 'Aggregates', unit: 'cu.m', type: 'Material', matCost: 1450, lbrCost: 0, supplier: 'Cebu Aggregates & Hardware' },
      { code: 'CBD-12', name: 'Cement Board 12mm (4x8 ft)', desc: 'High-density fiber cement backing board for counters & wet areas', spec: '1220 x 2440 x 12mm moisture resistant', cat: 'Carpentry Works', sub: 'Boards', unit: 'sheet', type: 'Material', matCost: 920, lbrCost: 0, supplier: 'Wilcon Depot' },
      { code: 'WPR-MEM', name: 'Elastomeric Liquid Waterproofing Membrane', desc: 'Acrylic elastomeric waterproofing coating', spec: '20L pail / 2-coat system', cat: 'Waterproofing Works', sub: 'Coatings', unit: 'gals', type: 'Material', matCost: 980, lbrCost: 220, supplier: 'ABC Chemical' },
      { code: 'LBR-MAS', name: 'Skilled Mason (Daily Rate)', desc: 'Qualified CHB laying, concrete & plastering mason', spec: '8-hour standard shift', cat: 'Masonry Works', sub: 'Labor', unit: 'day', type: 'Labor', matCost: 0, lbrCost: 850, supplier: 'Internal Workforce' },
      { code: 'LBR-HLP', name: 'Construction Helper / Laborer (Daily Rate)', desc: 'Material handling, mixing & general site support helper', spec: '8-hour standard shift', cat: 'Masonry Works', sub: 'Labor', unit: 'day', type: 'Labor', matCost: 0, lbrCost: 650, supplier: 'Internal Workforce' },
      { code: 'LBR-TIL', name: 'Skilled Tile Setter (Daily Rate)', desc: 'Precision floor/wall tile layout, cutting & grouting specialist', spec: '8-hour standard shift', cat: 'Tiling Works', sub: 'Labor', unit: 'day', type: 'Labor', matCost: 0, lbrCost: 900, supplier: 'Internal Workforce' },
      { code: 'LBR-PNT', name: 'Skilled Painter (Daily Rate)', desc: 'Surface skim coating, sanding & finish coat painter', spec: '8-hour standard shift', cat: 'Painting Works', sub: 'Labor', unit: 'day', type: 'Labor', matCost: 0, lbrCost: 820, supplier: 'Internal Workforce' },
      { code: 'LBR-PLM', name: 'Licensed Plumber (Daily Rate)', desc: 'Waterline, sanitary drainage & fixture installation plumber', spec: '8-hour standard shift', cat: 'Plumbing Works', sub: 'Labor', unit: 'day', type: 'Labor', matCost: 0, lbrCost: 920, supplier: 'Internal Workforce' },
      { code: 'LBR-ELC', name: 'Licensed Electrician (Daily Rate)', desc: 'Conduit, wiring, termination & lighting installation electrician', spec: '8-hour standard shift', cat: 'Electrical Works', sub: 'Labor', unit: 'day', type: 'Labor', matCost: 0, lbrCost: 950, supplier: 'Internal Workforce' },
    ];
    const insMore = db.prepare(
      `INSERT OR IGNORE INTO quotation_catalog_items (
        item_code, name, description, specification, category, subcategory, default_unit,
        item_type, mat_unit_cost, lbr_unit_cost, default_mat_gp_pct, default_lbr_gp_pct,
        supplier_ref, is_general_requirement, calc_rule, is_active, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.3, 0.3, ?, 0, 'fixed', 1, ?)`
    );
    for (const it of moreItems) {
      insMore.run(it.code, it.name, it.desc, it.spec, it.cat, it.sub, it.unit, it.type, it.matCost, it.lbrCost, it.supplier, prepUser?.id || null);
    }

    // E. Seed Master Suppliers Directory
    const supplierSeed: Array<[string, string, string, string, string, string, string]> = [
      ['SUP-001', 'Cebu Concrete Corp', 'Ramon Villanueva', 'sales@cebuconcrete.example', '(+6332) 412-8801', 'Mandaue City, Cebu', 'Masonry & Concrete'],
      ['SUP-002', 'Pag-asa Steel', 'Elena Soriano', 'orders@pagasasteel.example', '(+632) 8631-2100', 'Pasig City, Metro Manila', 'Rebar & Structural Steel'],
      ['SUP-003', 'Republic Cement', 'Carlo Mendoza', 'trade@republiccement.example', '(+632) 8819-5510', 'Taguig City, Metro Manila', 'Cement & Binders'],
      ['SUP-004', 'Wilcon Depot', 'Grace Bautista', 'b2b@wilcon.example', '(+632) 8634-8387', 'Quezon City, Metro Manila', 'Tiles, Plumbing & Hardware'],
      ['SUP-005', 'ABC Chemical', 'Victor Lim', 'commercial@abcchemical.example', '(+632) 8361-9900', 'Valenzuela City, Metro Manila', 'Adhesives & Waterproofing'],
      ['SUP-006', 'Davies Paints', 'Patricia Tan', 'projects@daviespaints.example', '(+632) 8641-7101', 'Pasig City, Metro Manila', 'Paints & Coatings'],
      ['SUP-007', 'DecoBuild Supplies', 'Mark Reyes', 'hello@decobuild.example', '(+632) 8522-1490', 'Makati City, Metro Manila', 'Acoustic & Interior Finishes'],
      ['SUP-008', 'Sta. Clara Lumber', 'Nestor Cruz', 'sales@staclaralumber.example', '(+632) 8441-3020', 'Caloocan City, Metro Manila', 'Plywood & Millwork'],
      ['SUP-009', 'Matimco', 'Diane Go', 'orders@matimco.example', '(+6332) 346-1080', 'Mandaue City, Cebu', 'Doors & Engineered Wood'],
      ['SUP-010', 'HCG Philippines', 'Bryan Sy', 'projects@hcg.example', '(+632) 8895-0012', 'Makati City, Metro Manila', 'Sanitary & Plumbing Fixtures'],
      ['SUP-011', 'Firefly Electric', 'Kevin Ong', 'sales@firefly.example', '(+632) 8789-1000', 'Pasig City, Metro Manila', 'Electrical & Lighting'],
      ['SUP-012', 'Cebu Aggregates & Hardware', 'Joel Navarro', 'dispatch@cebuaggregates.example', '(+6332) 254-3318', 'Cebu City, Cebu', 'Aggregates, CHB & Hardware'],
      ['SUP-013', 'Metro Steel Supply', 'Sandra Co', 'quotes@metrosteel.example', '(+632) 8701-4422', 'Quezon City, Metro Manila', 'Rebar, Tie Wire & Metal'],
      ['SUP-014', 'Hardware & Fasteners PH', 'Allan Santos', 'sales@fastenersph.example', '(+632) 8551-7710', 'Mandaluyong City, Metro Manila', 'Consumables & Fasteners'],
    ];
    const insSup = db.prepare(
      `INSERT OR IGNORE INTO suppliers (supplier_code, name, contact_person, email, phone, address, category_tags, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of supplierSeed) insSup.run(...s, prepUser?.id || null);

    // F. Seed Multi-Supplier Material Price Records (idempotent per item+supplier pair)
    {
      const getItem = (code: string) =>
        db.prepare('SELECT id, default_unit, mat_unit_cost, specification FROM quotation_catalog_items WHERE item_code = ?').get(code) as any;
      const getSup = (name: string) =>
        db.prepare('SELECT id FROM suppliers WHERE name = ?').get(name) as { id: number } | undefined;

      const hasPrice = db.prepare(
        'SELECT 1 FROM catalog_item_supplier_prices WHERE catalog_item_id = ? AND supplier_id = ? LIMIT 1'
      );
      const hasPreferred = db.prepare(
        'SELECT 1 FROM catalog_item_supplier_prices WHERE catalog_item_id = ? AND is_preferred = 1 LIMIT 1'
      );
      const insPrice = db.prepare(
        `INSERT INTO catalog_item_supplier_prices (
          catalog_item_id, supplier_id, supplier_item_ref, brand, specifications, unit,
          unit_price, effective_date, is_preferred, is_active, remarks, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?, 1, ?, ?)`
      );

      const linkPrice = (
        itemCode: string,
        supplierName: string,
        ref: string,
        brand: string,
        price: number,
        preferred: number,
        remarks: string
      ) => {
        const it = getItem(itemCode);
        const sup = getSup(supplierName);
        if (!it || !sup) return;
        if (hasPrice.get(it.id, sup.id)) return;
        const setPref = preferred && !hasPreferred.get(it.id) ? 1 : 0;
        insPrice.run(it.id, sup.id, ref, brand, it.specification || '', it.default_unit, price, setPref, remarks, prepUser?.id || null);
      };

      // Multi-supplier comparisons for key materials
      linkPrice('CHB-4', 'Cebu Concrete Corp', 'CCC-CHB4-STD', 'CebuCrete', 21.0, 1, 'Baseline preferred Cebu CHB supplier');
      linkPrice('CHB-4', 'Cebu Aggregates & Hardware', 'CAH-BLK-4', 'VisayasBlock', 19.75, 0, 'Pickup bulk rate (>500 pcs)');
      linkPrice('CHB-4', 'Wilcon Depot', 'WLC-CHB-04', 'StrongBlock', 22.5, 0, 'Metro retail branch rate');

      linkPrice('RBR-10', 'Pag-asa Steel', 'PGS-10MM-G40', 'Pag-asa Steel', 189.0, 1, 'Primary Grade 40 6m rebar');
      linkPrice('RBR-10', 'Metro Steel Supply', 'MSS-RBR10-6M', 'Capitol Steel', 184.5, 0, 'Minimum 100 lengths order');

      linkPrice('CEM-40', 'Republic Cement', 'REP-T1-40KG', 'Republic Type I', 253.0, 1, 'Standard 40kg Portland cement');
      linkPrice('CEM-40', 'Wilcon Depot', 'WLC-CEM-40', 'Holcim Excel', 260.0, 0, 'Store pickup price');

      linkPrice('TIE-16', 'Hardware & Fasteners PH', 'HFP-TW16', 'GalvaBind', 95.0, 1, 'Standard #16 GI tie wire');
      linkPrice('TIE-16', 'Metro Steel Supply', 'MSS-TW16', 'SteelTie', 91.0, 0, '25kg coil equivalent per kg');

      linkPrice('SND-WSH', 'Cebu Aggregates & Hardware', 'CAH-SND-S1', 'Washed River S1', 1450.0, 1, 'Delivered within Metro Cebu');
      linkPrice('TIL-6060', 'Wilcon Depot', 'WLC-POR-6060', 'Mariwasa / Wilcon', 200.0, 1, '60x60 Polished Porcelain White');
      linkPrice('TIL-ADH', 'ABC Chemical', 'ABC-ADH-25', 'ABC Heavy Duty', 330.0, 1, '25kg bag tile adhesive');
      linkPrice('PNT-SKM', 'Davies Paints', 'DAV-SKM-20', 'MondoSkim', 560.0, 1, '20kg interior skim coat');
      linkPrice('PNT-TOP', 'Davies Paints', 'DAV-MEG-1G', 'Megacryl', 820.0, 1, '1 gallon semi-gloss topcoat');
      linkPrice('CBD-12', 'Wilcon Depot', 'WLC-CBD-12', 'HardieFlex', 920.0, 1, '12mm fiber cement board 4x8');
      linkPrice('PLM-WC', 'HCG Philippines', 'HCG-WC-DUAL', 'HCG', 8270.0, 1, 'Complete dual flush set');
      linkPrice('ELC-FLR', 'Firefly Electric', 'FFY-LED-18W', 'Firefly', 350.0, 1, '18W 6500K LED linear fixture');
    }

    // G. Seed Reusable Sets of Works (Work Assemblies) with Version 1 Snapshots (idempotent)
    {
      const getCat = (name: string) =>
        db.prepare('SELECT id, name FROM quotation_categories WHERE name = ?').get(name) as { id: number; name: string } | undefined;
      const getIt = (code: string) =>
        db.prepare('SELECT * FROM quotation_catalog_items WHERE item_code = ?').get(code) as any;
      const getSupId = (name: string) =>
        (db.prepare('SELECT id FROM suppliers WHERE name = ?').get(name) as { id: number } | undefined)?.id ?? null;

      type SeedComp = {
        code: string;
        type: string;
        basis: 'per_unit' | 'fixed';
        rate: number;
        wastage: number;
        supplierName?: string;
        notes?: string;
      };

      const seedAssembly = (def: {
        asmCode: string;
        name: string;
        category: string;
        desc: string;
        spec: string;
        unit: string;
        calcMethod: string;
        defaultQty: number;
        laborReq: string;
        instructions: string;
        notes: string;
        components: SeedComp[];
      }) => {
        const existingAsm = db
          .prepare('SELECT id, current_version FROM work_assemblies WHERE assembly_code = ?')
          .get(def.asmCode) as { id: number; current_version: number } | undefined;

        let assemblyId = existingAsm?.id;
        if (!assemblyId) {
          const cat = getCat(def.category);
          const aRes = db
            .prepare(
              `INSERT INTO work_assemblies (
                assembly_code, name, category_id, category_name, description, specifications,
                unit, default_calc_method, default_qty, labor_requirements, installation_instructions,
                notes, current_version, is_active, created_by, updated_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
            )
            .run(
              def.asmCode,
              def.name,
              cat?.id ?? null,
              def.category,
              def.desc,
              def.spec,
              def.unit,
              def.calcMethod,
              def.defaultQty,
              def.laborReq,
              def.instructions,
              def.notes,
              prepUser?.id || null,
              prepUser?.id || null
            );
          assemblyId = Number(aRes.lastInsertRowid);
        }

        const hasComp = db.prepare(
          'SELECT 1 FROM work_assembly_items WHERE assembly_id = ? AND item_code = ? LIMIT 1'
        );
        const insComp = db.prepare(
          `INSERT INTO work_assembly_items (
            assembly_id, catalog_item_id, component_type, item_code, item_name,
            specification, unit, calc_basis, consumption_rate, wastage_pct,
            preferred_supplier_id, notes, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        const compRows: any[] = [];
        let addedAnyComp = false;
        def.components.forEach((c, idx) => {
          const it = getIt(c.code);
          if (!it) return;
          const supId = c.supplierName ? getSupId(c.supplierName) : null;
          if (!hasComp.get(assemblyId, it.item_code)) {
            addedAnyComp = true;
            insComp.run(
              assemblyId,
              it.id,
              c.type,
              it.item_code,
              it.name,
              it.specification || '',
              it.default_unit,
              c.basis,
              c.rate,
              c.wastage,
              supId,
              c.notes || '',
              idx + 1
            );
          }
          compRows.push({
            catalog_item_id: it.id,
            component_type: c.type,
            item_code: it.item_code,
            item_name: it.name,
            specification: it.specification || '',
            unit: it.default_unit,
            calc_basis: c.basis,
            consumption_rate: c.rate,
            wastage_pct: c.wastage,
            preferred_supplier_id: supId,
            notes: c.notes || '',
            sort_order: idx + 1,
          });
        });

        const snapshotPayload = JSON.stringify({
          assembly_code: def.asmCode,
          name: def.name,
          category_name: def.category,
          description: def.desc,
          specifications: def.spec,
          unit: def.unit,
          default_calc_method: def.calcMethod,
          default_qty: def.defaultQty,
          labor_requirements: def.laborReq,
          installation_instructions: def.instructions,
          notes: def.notes,
          components: compRows,
        });

        const hasV1 = db
          .prepare('SELECT id FROM work_assembly_versions WHERE assembly_id = ? AND version_number = 1')
          .get(assemblyId);
        if (!hasV1) {
          db.prepare(
            `INSERT INTO work_assembly_versions (assembly_id, version_number, change_summary, snapshot_json, changed_by)
             VALUES (?, 1, 'Initial master template baseline', ?, ?)`
          ).run(assemblyId, snapshotPayload, prepUser?.id || null);
        } else if (addedAnyComp && existingAsm?.current_version === 1) {
          db.prepare(
            `UPDATE work_assembly_versions SET snapshot_json = ? WHERE assembly_id = ? AND version_number = 1`
          ).run(snapshotPayload, assemblyId);
        }
      };

      seedAssembly({
        asmCode: 'SOW-MAS-001',
        name: 'Interior Wall Construction',
        category: 'Masonry Works',
        desc: 'Construction of an interior CHB 4" partition wall, including vertical/horizontal rebar reinforcement, GI tie wire, mortar & plastering.',
        spec: '100mm CHB non-load bearing partition with 10mm rebar @ 600mm O.C.',
        unit: 'sq.m',
        calcMethod: 'per_sqm',
        defaultQty: 1,
        laborReq: '1 Skilled Mason + 1 Helper per 8 sq.m/day',
        instructions: 'Layout floor line, drill dowel starters, lay CHB with Class B mortar, grout cells at rebar locations.',
        notes: 'Configurable baseline template; verify slab dowel clearances prior to pouring.',
        components: [
          { code: 'CHB-4', type: 'Material', basis: 'per_unit', rate: 12.5, wastage: 5, supplierName: 'Cebu Concrete Corp', notes: '12.5 pcs per sq.m' },
          { code: 'RBR-10', type: 'Material', basis: 'per_unit', rate: 0.75, wastage: 5, supplierName: 'Pag-asa Steel', notes: 'Vertical & horizontal reinforcement' },
          { code: 'TIE-16', type: 'Material', basis: 'per_unit', rate: 0.12, wastage: 5, supplierName: 'Hardware & Fasteners PH', notes: 'Rebar intersections' },
          { code: 'CEM-40', type: 'Material', basis: 'per_unit', rate: 0.65, wastage: 5, supplierName: 'Republic Cement', notes: 'Mortar + 2-side plastering' },
          { code: 'SND-WSH', type: 'Material', basis: 'per_unit', rate: 0.055, wastage: 10, supplierName: 'Cebu Aggregates & Hardware', notes: 'Screened washed sand' },
          { code: 'LBR-MAS', type: 'Labor', basis: 'per_unit', rate: 0.125, wastage: 0, notes: 'Mason output ~8 sq.m/day' },
          { code: 'LBR-HLP', type: 'Labor', basis: 'per_unit', rate: 0.125, wastage: 0, notes: 'Helper support' },
        ],
      });

      seedAssembly({
        asmCode: 'SOW-MAS-002',
        name: 'Pantry Counter Construction',
        category: 'Masonry Works',
        desc: 'Reinforced CHB & cement board pantry counter substructure with tile adhesive and ceramic/porcelain finish.',
        spec: '600mm deep x 850mm high masonry base with fiber cement top substrate',
        unit: 'ln.m',
        calcMethod: 'per_lnm',
        defaultQty: 1,
        laborReq: '1 Mason + 1 Helper',
        instructions: 'Erect CHB support piers, anchor fiber cement board substrate, apply adhesive and porcelain counter tiles.',
        notes: 'Plumbing sink cutout & faucet rough-in coordinated separately.',
        components: [
          { code: 'CHB-4', type: 'Material', basis: 'per_unit', rate: 10, wastage: 5, supplierName: 'Cebu Concrete Corp', notes: 'Base piers & walls' },
          { code: 'RBR-10', type: 'Material', basis: 'per_unit', rate: 1.2, wastage: 5, supplierName: 'Pag-asa Steel', notes: 'Counter slab reinforcement' },
          { code: 'TIE-16', type: 'Material', basis: 'per_unit', rate: 0.15, wastage: 5, supplierName: 'Hardware & Fasteners PH' },
          { code: 'CEM-40', type: 'Material', basis: 'per_unit', rate: 0.9, wastage: 5, supplierName: 'Republic Cement' },
          { code: 'SND-WSH', type: 'Material', basis: 'per_unit', rate: 0.07, wastage: 10, supplierName: 'Cebu Aggregates & Hardware' },
          { code: 'CBD-12', type: 'Material', basis: 'per_unit', rate: 0.35, wastage: 5, supplierName: 'Wilcon Depot', notes: 'Moisture-resistant backing' },
          { code: 'TIL-ADH', type: 'Material', basis: 'per_unit', rate: 0.4, wastage: 5, supplierName: 'ABC Chemical' },
          { code: 'TIL-6060', type: 'Material', basis: 'per_unit', rate: 2.8, wastage: 10, supplierName: 'Wilcon Depot', notes: 'Countertop tile finish' },
          { code: 'LBR-MAS', type: 'Labor', basis: 'per_unit', rate: 0.5, wastage: 0 },
          { code: 'LBR-HLP', type: 'Labor', basis: 'per_unit', rate: 0.5, wastage: 0 },
        ],
      });

      seedAssembly({
        asmCode: 'SOW-TIL-001',
        name: 'Floor Tiling (60x60 Porcelain)',
        category: 'Tiling Works',
        desc: 'Complete floor tiling installation using 600x600mm polished porcelain tiles on polymer-modified tile adhesive.',
        spec: '2.78 pcs/sq.m nominal, 2mm spacer joint',
        unit: 'sq.m',
        calcMethod: 'per_sqm',
        defaultQty: 1,
        laborReq: '1 Tile Setter + 1 Helper per 10 sq.m/day',
        instructions: 'Check floor levelness, butter tile backs and notched-trowel bed, align spacers and grout.',
        notes: 'Standard 8% cutting wastage included.',
        components: [
          { code: 'TIL-6060', type: 'Material', basis: 'per_unit', rate: 2.78, wastage: 8, supplierName: 'Wilcon Depot', notes: '60x60 floor tiles' },
          { code: 'TIL-ADH', type: 'Material', basis: 'per_unit', rate: 0.2, wastage: 5, supplierName: 'ABC Chemical', notes: '~5 sq.m per 25kg bag' },
          { code: 'LBR-TIL', type: 'Labor', basis: 'per_unit', rate: 0.1, wastage: 0, notes: 'Tile setter 10 sq.m/day' },
          { code: 'LBR-HLP', type: 'Labor', basis: 'per_unit', rate: 0.1, wastage: 0, notes: 'Helper support' },
        ],
      });

      seedAssembly({
        asmCode: 'SOW-PNT-001',
        name: 'Interior Wall Painting (Skim Coat + 2-Coat Finish)',
        category: 'Painting Works',
        desc: 'Surface preparation with interior skim coat followed by sanding and two coats of semi-gloss acrylic finish.',
        spec: 'VOC-compliant architectural latex paint system',
        unit: 'sq.m',
        calcMethod: 'per_sqm',
        defaultQty: 1,
        laborReq: '1 Painter + 1 Helper per 18 sq.m/day',
        instructions: 'Clean masonry substrate, apply 2 passes skim coat, sand #120/#180, apply primer and 2 topcoats.',
        notes: 'Covers standard 3.0m clear height interior walls.',
        components: [
          { code: 'PNT-SKM', type: 'Material', basis: 'per_unit', rate: 0.05, wastage: 5, supplierName: 'Davies Paints', notes: '20 sq.m per 20kg bag' },
          { code: 'PNT-TOP', type: 'Material', basis: 'per_unit', rate: 0.08, wastage: 5, supplierName: 'Davies Paints', notes: '2 coats semi-gloss coverage' },
          { code: 'LBR-PNT', type: 'Labor', basis: 'per_unit', rate: 0.055, wastage: 0 },
          { code: 'LBR-HLP', type: 'Labor', basis: 'per_unit', rate: 0.055, wastage: 0 },
        ],
      });

      seedAssembly({
        asmCode: 'SOW-PLM-001',
        name: 'Plumbing Fixtures Installation (Water Closet)',
        category: 'Plumbing Works',
        desc: 'Supply and installation of complete dual-flush ceramic water closet with angle valve and braided hose.',
        spec: '3/6L dual flush rough-in 305mm',
        unit: 'set/s',
        calcMethod: 'per_pc',
        defaultQty: 1,
        laborReq: '1 Plumber per 2 sets/day',
        instructions: 'Set wax ring gasket, bolt flange, connect supply line, silicone perimeter seal & leak test.',
        notes: 'Per fixture set.',
        components: [
          { code: 'PLM-WC', type: 'Material', basis: 'per_unit', rate: 1, wastage: 0, supplierName: 'HCG Philippines' },
          { code: 'LBR-PLM', type: 'Labor', basis: 'per_unit', rate: 0.5, wastage: 0 },
        ],
      });

      seedAssembly({
        asmCode: 'SOW-ELC-001',
        name: 'Lighting Installation (LED Linear Fixture)',
        category: 'Electrical Works',
        desc: 'Installation and termination of 18W 6500K LED linear batten fixture.',
        spec: '220V AC 60Hz, ceiling/surface mount',
        unit: 'pcs',
        calcMethod: 'per_pc',
        defaultQty: 1,
        laborReq: '1 Electrician per 8 fixtures/day',
        instructions: 'Mount bracket, terminate junction box with wire nuts/tape, energize and test illumination.',
        notes: 'Excludes main branch circuit home-run.',
        components: [
          { code: 'ELC-FLR', type: 'Material', basis: 'per_unit', rate: 1, wastage: 2, supplierName: 'Firefly Electric' },
          { code: 'LBR-ELC', type: 'Labor', basis: 'per_unit', rate: 0.125, wastage: 0 },
        ],
      });
    }
  });
}

