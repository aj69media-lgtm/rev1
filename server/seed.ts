import { hashPassword } from './auth.ts';
import { computeCriticalPath, syncProjectProgressFromSchedule } from './calculations.ts';
import { db, transaction } from './db.ts';
import { ensureQuotationReferenceData } from './quotationSeed.ts';

export function seedSampleWorkspace(adminUserId: number, staffTestPassword?: string): void {
  const existingProjects = db.prepare('SELECT COUNT(*) AS cnt FROM projects').get() as { cnt: number };
  if (existingProjects.cnt > 0) return;

  const today = new Date();
  const isoOffset = (days: number) => {
    const d = new Date(today.getTime() + days * 86400000);
    return d.toISOString().slice(0, 10);
  };

  transaction(() => {
    const roles = new Map<string, number>();
    for (const r of db.prepare('SELECT id, slug FROM roles').all() as Array<{ id: number; slug: string }>) {
      roles.set(r.slug, r.id);
    }

    // Create sample staff and client representative users if a test password was supplied during setup
    let pmId = adminUserId;
    let siteEngId = adminUserId;
    let financeId = adminUserId;
    let procId = adminUserId;
    let qcId = adminUserId;
    let clientUserId: number | null = null;

    if (staffTestPassword && staffTestPassword.length >= 8) {
      const pwHash = hashPassword(staffTestPassword);
      const insertUser = db.prepare(
        `INSERT OR IGNORE INTO users (email, password_hash, full_name, role_id, phone, job_title, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      );

      insertUser.run('pm@buildcore.local', pwHash, 'Elena Vance, PMP', roles.get('project_manager')!, '+1-555-0142', 'Senior Project Manager');
      insertUser.run('engineer@buildcore.local', pwHash, 'Marcus Chen, PE', roles.get('site_engineer')!, '+1-555-0188', 'Lead Site Engineer');
      insertUser.run('finance@buildcore.local', pwHash, 'Priya Patel, CPA', roles.get('finance_officer')!, '+1-555-0164', 'Project Finance Controller');
      insertUser.run('procurement@buildcore.local', pwHash, 'David Morales', roles.get('procurement_officer')!, '+1-555-0177', 'Procurement Lead');
      insertUser.run('qc@buildcore.local', pwHash, 'Hannah Brooks', roles.get('qc_personnel')!, '+1-555-0191', 'QA/QC Inspector');
      insertUser.run('client@meridian-dev.local', pwHash, 'Arthur Sterling', roles.get('client_rep')!, '+1-555-0210', 'VP of Capital Projects');

      const getUid = (email: string) =>
        (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined)?.id || adminUserId;

      pmId = getUid('pm@buildcore.local');
      siteEngId = getUid('engineer@buildcore.local');
      financeId = getUid('finance@buildcore.local');
      procId = getUid('procurement@buildcore.local');
      qcId = getUid('qc@buildcore.local');
      clientUserId = getUid('client@meridian-dev.local');
    }

    // Clients
    const c1 = db
      .prepare(
        'INSERT INTO clients (company_name, primary_contact, email, phone, address) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        'Meridian Commercial Holdings',
        'Arthur Sterling',
        'client@meridian-dev.local',
        '+1-555-0210',
        '400 Harbor Plaza, Suite 1200'
      );
    const c2 = db
      .prepare(
        'INSERT INTO clients (company_name, primary_contact, email, phone, address) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        'Pacific Logistics Group',
        'Sandra Takahashi',
        'projects@pacificlogistics.example',
        '+1-555-0340',
        '880 Port Terminal Way'
      );
    const c3 = db
      .prepare(
        'INSERT INTO clients (company_name, primary_contact, email, phone, address) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        'Metro Civic Health Authority',
        'Dr. Samuel Okafor',
        'facilities@metrocivic.example',
        '+1-555-0499',
        '150 Civic Center Blvd'
      );

    const client1Id = Number(c1.lastInsertRowid);
    const client2Id = Number(c2.lastInsertRowid);
    const client3Id = Number(c3.lastInsertRowid);

    if (clientUserId) {
      db.prepare('INSERT OR IGNORE INTO client_users (user_id, client_id, is_primary) VALUES (?, ?, 1)').run(
        clientUserId,
        client1Id
      );
    }

    // Projects
    const p1 = db
      .prepare(
        `INSERT INTO projects (
          ref_number, name, client_id, client_contact_info, location, address, description, scope,
          contract_amount, approved_budget, revised_budget, project_manager_id, site_supervisor_id,
          start_date, original_end_date, status, hero_image, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'PRJ-2026-001',
        'Meridian Corporate Tower B',
        client1Id,
        'Arthur Sterling · +1-555-0210',
        'Downtown Financial District',
        '425 Market Street, Parcel 4B',
        '8-story Grade-A mixed-use commercial office tower with subterranean parking and high-efficiency curtain wall.',
        'Excavation, deep foundations, structural steel erection, MEP rough-in, curtain wall glazing, and lobby fit-out.',
        14800000,
        11950000,
        12250000,
        pmId,
        siteEngId,
        isoOffset(-120),
        isoOffset(180),
        'active',
        '/src/assets/images/hero_commercial_tower_1795251920498.jpg',
        adminUserId
      );

    const p2 = db
      .prepare(
        `INSERT INTO projects (
          ref_number, name, client_id, client_contact_info, location, address, description, scope,
          contract_amount, approved_budget, revised_budget, project_manager_id, site_supervisor_id,
          start_date, original_end_date, status, hero_image, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'PRJ-2026-002',
        'Harborview Cold-Chain Logistics Hub',
        client2Id,
        'Sandra Takahashi · +1-555-0340',
        'Port Terminal Zone 3',
        '910 Freight Corridor',
        '120,000 sq ft automated cold-storage warehouse and dock distribution facility.',
        'Site grading, post-tensioned industrial slab, insulated tilt-up panels, refrigeration plant, and 18 loading bays.',
        8450000,
        6900000,
        6900000,
        pmId,
        siteEngId,
        isoOffset(-90),
        isoOffset(110),
        'active',
        '/src/assets/images/site_structural_steel_1795251919634.jpg',
        adminUserId
      );

    const p3 = db
      .prepare(
        `INSERT INTO projects (
          ref_number, name, client_id, client_contact_info, location, address, description, scope,
          contract_amount, approved_budget, revised_budget, project_manager_id, site_supervisor_id,
          start_date, original_end_date, actual_end_date, status, overall_progress, hero_image, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'PRJ-2025-014',
        'Metro Civic Diagnostic Wing',
        client3Id,
        'Dr. Samuel Okafor · +1-555-0499',
        'Civic Medical Campus',
        '150 Civic Center Blvd, North Wing',
        'Outpatient imaging center and cleanroom diagnostic annex.',
        'Full turnkey interior structural retrofit, shielded radiology suites, medical gas piping, and commissioning.',
        5200000,
        4350000,
        4350000,
        pmId,
        siteEngId,
        isoOffset(-280),
        isoOffset(-15),
        isoOffset(-12),
        'completed',
        100,
        '/src/assets/images/site_interior_fitout_1795251920513.jpg',
        adminUserId
      );

    const p1Id = Number(p1.lastInsertRowid);
    const p2Id = Number(p2.lastInsertRowid);
    const p3Id = Number(p3.lastInsertRowid);

    // Project Assignments
    const assignStmt = db.prepare(
      'INSERT OR IGNORE INTO project_assignments (project_id, user_id, assignment_role) VALUES (?, ?, ?)'
    );
    for (const pid of [p1Id, p2Id, p3Id]) {
      for (const uid of new Set([adminUserId, pmId, siteEngId, financeId, procId, qcId])) {
        assignStmt.run(pid, uid, 'team');
      }
    }
    if (clientUserId) {
      assignStmt.run(p1Id, clientUserId, 'client_representative');
    }

    // Schedule Revision & Phases for Project 1
    const rev1 = db
      .prepare(
        `INSERT INTO schedule_revisions (project_id, revision_number, revision_note, source_filename, is_approved, is_active, approved_by, approved_at, created_by)
         VALUES (?, 1, 'Baseline Approved Master Schedule', 'Meridian_Tower_Master_Schedule.xlsx', 1, 1, ?, datetime('now'), ?)`
      )
      .run(p1Id, pmId, pmId);
    const rev1Id = Number(rev1.lastInsertRowid);

    const phasesP1 = [
      { name: 'Site Prep & Deep Foundations', order: 1, start: isoOffset(-120), end: isoOffset(-55), weight: 22 },
      { name: 'Structural Steel & Decking', order: 2, start: isoOffset(-54), end: isoOffset(20), weight: 30 },
      { name: 'Building Envelope & Curtain Wall', order: 3, start: isoOffset(-5), end: isoOffset(85), weight: 23 },
      { name: 'MEP & Interior Fit-Out', order: 4, start: isoOffset(35), end: isoOffset(150), weight: 18 },
      { name: 'Testing & Client Handover', order: 5, start: isoOffset(151), end: isoOffset(180), weight: 7 },
    ];

    const phaseIds: number[] = [];
    for (const ph of phasesP1) {
      const res = db
        .prepare(
          `INSERT INTO project_phases (project_id, revision_id, name, sort_order, start_date, end_date, weight_percent)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(p1Id, rev1Id, ph.name, ph.order, ph.start, ph.end, ph.weight);
      phaseIds.push(Number(res.lastInsertRowid));
    }

    const p1Activities = [
      { pid: phaseIds[0], wbs: '1.1', name: 'Excavation & Shoring Wall', start: isoOffset(-120), end: isoOffset(-88), dur: 33, deps: '[]', ms: 0, w: 10, act: 100 },
      { pid: phaseIds[0], wbs: '1.2', name: 'Mat Foundation Rebar & Concrete Pour', start: isoOffset(-87), end: isoOffset(-55), dur: 33, deps: '["1.1"]', ms: 1, w: 12, act: 100 },
      { pid: phaseIds[1], wbs: '2.1', name: 'Primary Steel Columns Levels 1-4', start: isoOffset(-54), end: isoOffset(-18), dur: 37, deps: '["1.2"]', ms: 0, w: 15, act: 100 },
      { pid: phaseIds[1], wbs: '2.2', name: 'Upper Steel Framing & Composite Slabs', start: isoOffset(-17), end: isoOffset(20), dur: 38, deps: '["2.1"]', ms: 1, w: 15, act: 72 },
      { pid: phaseIds[2], wbs: '3.1', name: 'Curtain Wall Mullions & Glazing', start: isoOffset(-5), end: isoOffset(85), dur: 91, deps: '["2.1"]', ms: 0, w: 23, act: 28 },
      { pid: phaseIds[3], wbs: '4.1', name: 'MEP Risers, HVAC Ductwork & Lobby Framing', start: isoOffset(35), end: isoOffset(150), dur: 116, deps: '["2.2"]', ms: 0, w: 18, act: 10 },
      { pid: phaseIds[4], wbs: '5.1', name: 'Final Commissioning & Turnover', start: isoOffset(151), end: isoOffset(180), dur: 30, deps: '["3.1","4.1"]', ms: 1, w: 7, act: 0 },
    ];

    for (const a of p1Activities) {
      db.prepare(
        `INSERT INTO project_activities (
          project_id, revision_id, phase_id, wbs_code, name, start_date, end_date, duration_days,
          dependencies_json, is_milestone, milestone_status, weight_percent, actual_progress, responsible_person
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        p1Id,
        rev1Id,
        a.pid,
        a.wbs,
        a.name,
        a.start,
        a.end,
        a.dur,
        a.deps,
        a.ms,
        a.ms ? (a.act >= 100 ? 'completed' : 'upcoming') : null,
        a.w,
        a.act,
        'Marcus Chen, PE'
      );
    }

    // Mark critical path on Project 1
    const p1ActsRows = db
      .prepare('SELECT * FROM project_activities WHERE project_id = ? AND revision_id = ?')
      .all(p1Id, rev1Id) as any[];
    const critSet = computeCriticalPath(p1ActsRows);
    for (const cid of critSet) {
      db.prepare('UPDATE project_activities SET is_critical_path = 1 WHERE id = ?').run(cid);
    }

    // Schedule for Project 2 (behind schedule example for realistic dashboard alerts)
    const rev2 = db
      .prepare(
        `INSERT INTO schedule_revisions (project_id, revision_number, revision_note, source_filename, is_approved, is_active, approved_by, approved_at, created_by)
         VALUES (?, 1, 'Baseline Logistics Schedule', 'Harborview_Schedule.xlsx', 1, 1, ?, datetime('now'), ?)`
      )
      .run(p2Id, pmId, pmId);
    const rev2Id = Number(rev2.lastInsertRowid);
    const p2ph1 = Number(
      db
        .prepare(
          'INSERT INTO project_phases (project_id, revision_id, name, sort_order, start_date, end_date, weight_percent) VALUES (?, ?, ?, 1, ?, ?, 40)'
        )
        .run(p2Id, rev2Id, 'Earthworks & Post-Tensioned Slab', isoOffset(-90), isoOffset(-20)).lastInsertRowid
    );
    const p2ph2 = Number(
      db
        .prepare(
          'INSERT INTO project_phases (project_id, revision_id, name, sort_order, start_date, end_date, weight_percent) VALUES (?, ?, ?, 2, ?, ?, 60)'
        )
        .run(p2Id, rev2Id, 'Tilt-Up Panels & Cold Storage Steel', isoOffset(-19), isoOffset(110)).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO project_activities (project_id, revision_id, phase_id, wbs_code, name, start_date, end_date, duration_days, dependencies_json, is_milestone, weight_percent, actual_progress, is_critical_path)
       VALUES (?, ?, ?, '1.1', 'Subgrade Compaction & Vapor Barrier', ?, ?, 71, '[]', 1, 40, 88, 1)`
    ).run(p2Id, rev2Id, p2ph1, isoOffset(-90), isoOffset(-20));
    db.prepare(
      `INSERT INTO project_activities (project_id, revision_id, phase_id, wbs_code, name, start_date, end_date, duration_days, dependencies_json, is_milestone, weight_percent, actual_progress, is_critical_path)
       VALUES (?, ?, ?, '2.1', 'Insulated Structural Steel Bay Erection', ?, ?, 130, '["1.1"]', 0, 60, 12, 1)`
    ).run(p2Id, rev2Id, p2ph2, isoOffset(-19), isoOffset(110));

    // Schedule for Project 3 (Completed)
    const rev3 = db
      .prepare(
        `INSERT INTO schedule_revisions (project_id, revision_number, revision_note, source_filename, is_approved, is_active, approved_by, approved_at, created_by)
         VALUES (?, 1, 'As-Built Final Schedule', 'Civic_Annex_Final.xlsx', 1, 1, ?, datetime('now'), ?)`
      )
      .run(p3Id, pmId, pmId);
    const rev3Id = Number(rev3.lastInsertRowid);
    const p3ph1 = Number(
      db
        .prepare(
          'INSERT INTO project_phases (project_id, revision_id, name, sort_order, start_date, end_date, weight_percent) VALUES (?, ?, ?, 1, ?, ?, 100)'
        )
        .run(p3Id, rev3Id, 'Interior Retrofit & Commissioning', isoOffset(-280), isoOffset(-15)).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO project_activities (project_id, revision_id, phase_id, wbs_code, name, start_date, end_date, duration_days, dependencies_json, is_milestone, milestone_status, weight_percent, actual_progress, is_critical_path)
       VALUES (?, ?, ?, '1.1', 'Diagnostic Wing Turnkey Completion', ?, ?, 265, '[]', 1, 'completed', 100, 100, 1)`
    ).run(p3Id, rev3Id, p3ph1, isoOffset(-280), isoOffset(-15));

    syncProjectProgressFromSchedule(p1Id);
    syncProjectProgressFromSchedule(p2Id);
    syncProjectProgressFromSchedule(p3Id);

    // Budget Allocations
    const categories: Array<[string, number]> = [
      ['Labor', 3200000],
      ['Materials', 4600000],
      ['Equipment', 1250000],
      ['Subcontractors', 2100000],
      ['Transportation and logistics', 380000],
      ['Permits and fees', 290000],
      ['Administrative expenses', 280000],
      ['Other project expenses', 150000],
    ];
    for (const [cat, amt] of categories) {
      db.prepare(
        'INSERT INTO budget_allocations (project_id, category, allocated_amount, revised_amount) VALUES (?, ?, ?, ?)'
      ).run(p1Id, cat, amt, amt);
      db.prepare(
        'INSERT INTO budget_allocations (project_id, category, allocated_amount, revised_amount) VALUES (?, ?, ?, ?)'
      ).run(p2Id, cat, Math.round(amt * 0.56), Math.round(amt * 0.56));
    }

    // Purchase Requests (demonstrating commitment vs partial settlement)
    const pr1 = db
      .prepare(
        `INSERT INTO purchase_requests (
          ref_number, project_id, requested_by, request_date, required_date, item_description,
          category, quantity, unit, estimated_unit_cost, estimated_total_cost, suggested_supplier,
          reason, status, commitment_amount, settled_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'PR-2026-0101',
        p1Id,
        siteEngId,
        isoOffset(-25),
        isoOffset(-5),
        'High-Strength Structural Wide-Flange Steel Beams (W18x50)',
        'Materials',
        120,
        'tons',
        2850,
        342000,
        'Pacific Northwest Steel Corp',
        'Levels 5-7 structural frame erection',
        'partially_delivered',
        342000,
        171000
      );
    const pr1Id = Number(pr1.lastInsertRowid);
    db.prepare(
      `INSERT INTO purchase_request_approvals (pr_id, approver_id, stage, decision, remarks)
       VALUES (?, ?, 'Management', 'approved', 'Verified against structural BOQ')`
    ).run(pr1Id, pmId);
    db.prepare(
      `INSERT INTO purchase_orders (po_number, pr_id, project_id, supplier_name, approved_qty, ordered_qty, delivered_qty, actual_unit_cost, actual_total_cost, delivery_date, status)
       VALUES ('PO-2026-0044', ?, ?, 'Pacific Northwest Steel Corp', 120, 120, 60, 2850, 342000, ?, 'partially_delivered')`
    ).run(pr1Id, p1Id, isoOffset(-8));

    db.prepare(
      `INSERT INTO purchase_requests (
        ref_number, project_id, requested_by, request_date, required_date, item_description,
        category, quantity, unit, estimated_unit_cost, estimated_total_cost, suggested_supplier,
        reason, status, commitment_amount, settled_amount
      ) VALUES ('PR-2026-0102', ?, ?, ?, ?, 'Low-E Double-Glazed Curtain Wall Units (Lot B)', 'Materials', 240, 'panels', 1650, 396000, 'VetroTech Facade Systems', 'East & South elevation glazing', 'submitted', 0, 0)`
    ).run(p1Id, siteEngId, isoOffset(-2), isoOffset(18));

    // Actual Expenses (with PR settlement + direct labor/equipment/subcontractor expenses)
    const expRows: Array<[string, number, string, string, string, number, string, number | null]> = [
      ['EXP-2026-001', p1Id, isoOffset(-95), 'Subcontractors', 'Deep Shoring & Caisson Drilling Mobilization', 1240000, 'GeoFoundations LLC', null],
      ['EXP-2026-002', p1Id, isoOffset(-62), 'Materials', 'Ready-Mix Concrete 6000 PSI Mat Pour (2,400 cu yd)', 685000, 'Metro Concrete Supply', null],
      ['EXP-2026-003', p1Id, isoOffset(-34), 'Labor', 'Structural Ironworker & Formwork Crew Payroll - Cycle 1', 790000, 'Internal Site Payroll', null],
      ['EXP-2026-004', p1Id, isoOffset(-15), 'Equipment', 'Tower Crane Lease & Rigging Operations (Month 1-3)', 215000, 'Apex Heavy Rentals', null],
      ['EXP-2026-005', p1Id, isoOffset(-8), 'Materials', 'Steel Wide-Flange Shipment 1 Settlement (60 tons)', 171000, 'Pacific Northwest Steel Corp', pr1Id],
      ['EXP-2026-006', p1Id, isoOffset(-4), 'Permits and fees', 'Municipal Structural Inspection & Crane Airspace Permit', 64500, 'City Building Dept', null],
      ['EXP-2026-007', p2Id, isoOffset(-45), 'Materials', 'Post-Tensioning Tendons & Anchorages', 420000, 'Tension Systems Inc', null],
      ['EXP-2026-008', p2Id, isoOffset(-20), 'Equipment', 'Laser Screed & Earthmoving Fleet Rental', 185000, 'Apex Heavy Rentals', null],
      ['EXP-2025-091', p3Id, isoOffset(-60), 'Subcontractors', 'Radiology Lead-Lining & Medical Gas Commissioning', 3890000, 'MedBuild Contractors', null],
    ];
    for (const [ref, pid, dt, cat, desc, amt, sup, linkedPr] of expRows) {
      db.prepare(
        `INSERT INTO expenses (ref_number, project_id, expense_date, category, description, amount, supplier_recipient, payment_method, pr_id, submitted_by, approved_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Bank Transfer', ?, ?, ?, 'approved')`
      ).run(ref, pid, dt, cat, desc, amt, sup, linkedPr, siteEngId, financeId);
    }

    // Daily Progress Reports (2 internal, 2 published to Client Portal with generated photography!)
    const dprPhotosP1 = [
      {
        url: '/src/assets/images/site_foundation_pour_1795251920176.jpg',
        caption: 'Mat foundation rebar grid inspection and concrete placement preparation',
        phase: 'Site Prep & Deep Foundations',
        date: isoOffset(-64),
      },
      {
        url: '/src/assets/images/site_structural_steel_1795251919634.jpg',
        caption: 'Structural steel framing and composite decking advancing on Levels 5-6',
        phase: 'Structural Steel & Decking',
        date: isoOffset(-5),
      },
      {
        url: '/src/assets/images/site_interior_fitout_1795251920513.jpg',
        caption: 'Ground lobby curtain wall glazing and MEP overhead rough-in',
        phase: 'Building Envelope & Curtain Wall',
        date: isoOffset(-1),
      },
    ];

    db.prepare(
      `INSERT INTO daily_progress_reports (
        project_id, report_date, site_location, weather, activities_performed, accomplishments,
        work_completed_pct, manpower_count, materials_used, equipment_used, delays_problems,
        safety_observations, quality_observations, next_day_plan, status, prepared_by, reviewed_by, approved_by,
        is_published_to_client, client_summary, client_completed_activities, client_next_activities,
        client_published_by, client_published_at, photos_json, client_photos_json
      ) VALUES (?, ?, '425 Market Street', 'Clear · 18°C', ?, ?, 100, 42, '145 cu yd 6000 PSI concrete, #8 rebar', 'Tower Crane #1, Concrete Boom Pump', 'None', 'Zero incidents; 100% tie-off compliance verified', 'Slump test 4.5 in passed QC', 'Strip perimeter formwork and prep anchor bolts', 'approved', ?, ?, ?, 1, ?, ?, ?, ?, datetime('now'), ?, ?)`
    ).run(
      p1Id,
      isoOffset(-64),
      'Completed mat foundation rebar tying and continuous concrete pour across Sector A.',
      'Mat foundation structural pour 100% completed.',
      siteEngId,
      pmId,
      pmId,
      'Mat foundation concrete pour completed on schedule with full structural QA sign-off.',
      'Completed Sector A & B foundation mat pour and curing protection.',
      'Begin primary structural steel column erection on gridlines A-F.',
      pmId,
      JSON.stringify([dprPhotosP1[0]]),
      JSON.stringify([dprPhotosP1[0]])
    );

    db.prepare(
      `INSERT INTO daily_progress_reports (
        project_id, report_date, site_location, weather, activities_performed, accomplishments,
        work_completed_pct, manpower_count, materials_used, equipment_used, delays_problems,
        safety_observations, quality_observations, next_day_plan, status, prepared_by, reviewed_by, approved_by,
        is_published_to_client, client_summary, client_completed_activities, client_next_activities,
        client_published_by, client_published_at, photos_json, client_photos_json
      ) VALUES (?, ?, '425 Market Street', 'Partly Cloudy · 16°C', ?, ?, 72, 54, '24 tons W18 steel beams, 4,200 sq ft metal deck', 'Liebherr Tower Crane, 2 Scissor Lifts', 'Wind hold 45 mins at 14:00 (internal crane log)', 'Toolbox talk on overhead rigging completed', 'Ultrasonic weld testing passed 18/18 joints', 'Continue Level 6 decking and start East curtain wall brackets', 'approved', ?, ?, ?, 1, ?, ?, ?, ?, datetime('now'), ?, ?)`
    ).run(
      p1Id,
      isoOffset(-1),
      'Erected Level 6 steel girders and installed metal floor decking; began ground lobby stud layout.',
      'Level 6 structural steel 72% complete; lobby framing started.',
      siteEngId,
      pmId,
      pmId,
      'Structural steel erection has reached Level 6 with ultrasonic weld inspections passing 100%. Ground lobby framing is underway.',
      'Completed primary girders on Level 6 and exterior curtain wall anchor brackets on Levels 1-3.',
      'Complete Level 6 metal decking and begin glazing unit installation on East facade.',
      pmId,
      JSON.stringify([dprPhotosP1[1], dprPhotosP1[2]]),
      JSON.stringify([dprPhotosP1[1], dprPhotosP1[2]])
    );

    // Private internal draft DPR (must NEVER appear in Client Portal!)
    db.prepare(
      `INSERT INTO daily_progress_reports (
        project_id, report_date, site_location, weather, activities_performed, accomplishments,
        work_completed_pct, manpower_count, delays_problems, safety_observations, next_day_plan,
        status, prepared_by, is_published_to_client, photos_json
      ) VALUES (?, ?, '425 Market Street', 'Overcast · 15°C', 'Internal subcontractor dispute resolution regarding overtime steel crew.', 'Crew schedule realigned.', 74, 48, 'CONFIDENTIAL: Subcontractor crew late arrival.', 'Corrective warning issued to rigging lead.', 'Resume full steel hoisting at 07:00.', 'submitted', ?, 0, '[]')`
    ).run(p1Id, isoOffset(0), siteEngId);

    // Tasks
    const tasks: Array<[string, number, string, string, string, string, string, number]> = [
      ['TSK-101', p1Id, 'Complete Level 6 Shear Stud Welding', 'Weld 1,200 shear connectors across Level 6 composite beams.', 'high', isoOffset(-4), isoOffset(3), 'in_progress', 65],
      ['TSK-102', p1Id, 'Submit East Facade Mullion Shop Drawings', 'Coordinate revised wind-load anchor tolerances with structural engineer.', 'critical', isoOffset(-6), isoOffset(1), 'for_review', 90],
      ['TSK-103', p1Id, 'Lobby MEP Chilled Water Riser Pressure Test', 'Hydrostatic pressure test at 150 PSI for 4 hours.', 'medium', isoOffset(2), isoOffset(10), 'pending', 0],
      ['TSK-104', p1Id, 'Sub-Basement Waterproofing Membrane Patch', 'Repair seam overlap prior to backfill inspection.', 'high', isoOffset(-10), isoOffset(-2), 'overdue', 40],
      ['TSK-201', p2Id, 'Pour Loading Bay Apron Slab Section 2', 'Laser-screed 8-inch reinforced concrete apron.', 'high', isoOffset(-3), isoOffset(4), 'in_progress', 55],
    ] as any;

    for (const t of tasks as any[]) {
      db.prepare(
        `INSERT INTO tasks (ref_number, project_id, title, description, assigned_to, supervisor_id, reviewer_id, priority, start_date, deadline, status, progress_pct, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(t[0], t[1], t[2], t[3], siteEngId, pmId, pmId, t[4], t[5], t[6], t[7], t[8], pmId);
    }

    // Personnel & Attendance
    const crew: Array<[string, string, string, string, number, number]> = [
      ['EMP-001', 'Roberto Alvarez', 'Steel Foreman', 'Structural Rigging', p1Id, 340],
      ['EMP-002', 'Linh Nguyen', 'Lead Electrician', 'MEP / High Voltage', p1Id, 320],
      ['EMP-003', 'Carlos Mendez', 'Concrete Finisher', 'Post-Tension Slabs', p2Id, 285],
      ['EMP-004', 'Kendra Washington', 'Crane Operator', 'Tower Crane Class A', p1Id, 410],
      ['EMP-005', 'Tariq Hassan', 'Safety & Rigging Lead', 'OSHA 30 / Rigging', p1Id, 310],
    ];
    for (const [code, name, pos, skill, pid, rate] of crew) {
      const pRes = db
        .prepare(
          `INSERT INTO personnel (employee_code, full_name, position, trade_skill, employment_status, assigned_project_id, daily_rate)
           VALUES (?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(code, name, pos, skill, pid, rate);
      db.prepare(
        `INSERT INTO attendance (project_id, personnel_id, work_date, time_in, time_out, status, total_hours, overtime_hours, recorded_by)
         VALUES (?, ?, ?, '07:00', '16:30', 'present', 8.5, 1.0, ?)`
      ).run(pid, Number(pRes.lastInsertRowid), isoOffset(0), siteEngId);
    }

    // Equipment & Inventory
    db.prepare(
      `INSERT INTO equipment (equipment_code, name, type, brand_model, serial_number, ownership_type, current_location, assigned_project_id, condition_status, operating_hours, next_maintenance_date, daily_operating_cost)
       VALUES
       ('EQ-TC-01', 'Luffing Tower Crane #1', 'Tower Crane', 'Liebherr 280 EC-H', 'LH-992841', 'rented', '425 Market Street', ?, 'operational', 1420, ?, 1450),
       ('EQ-EX-04', 'Hydraulic Excavator 22T', 'Earthmoving', 'CAT 320 GC', 'CAT-320-8841', 'company_owned', '910 Freight Corridor', ?, 'operational', 2810, ?, 680),
       ('EQ-GEN-02', 'Diesel Site Generator 250kVA', 'Power', 'Cummins C250D5', 'CM-44102', 'company_owned', '425 Market Street', ?, 'maintenance', 915, ?, 240)`
    ).run(p1Id, isoOffset(14), p2Id, isoOffset(21), p1Id, isoOffset(2));

    db.prepare(
      `INSERT INTO inventory_items (sku, name, category, unit, current_qty, min_stock_level, storage_location, supplier, unit_cost, assigned_project_id)
       VALUES
       ('MAT-REB-16', 'Deformed Steel Rebar #5 (16mm)', 'Structural Steel', 'tons', 44, 15, 'Meridian Yard A', 'Pacific Northwest Steel', 980, ?),
       ('MAT-CEM-50', 'Portland Type I/II Cement Bags (50kg)', 'Concrete & Masonry', 'bags', 180, 250, 'Harborview Shed 2', 'Metro Concrete Supply', 11.5, ?),
       ('MAT-GLZ-ANCH', 'Stainless Facade Embed Brackets', 'Building Envelope', 'pcs', 420, 100, 'Meridian Secure Cage', 'VetroTech Facade Systems', 48, ?)`
    ).run(p1Id, p2Id, p1Id);

    // Quality Control Inspection & Defect
    const qcInsp = db
      .prepare(
        `INSERT INTO quality_inspections (ref_number, project_id, title, checklist_json, inspection_date, inspector_id, status, defects_summary)
         VALUES ('QC-2026-019', ?, 'Level 5-6 Structural Bolted & Welded Connections', ?, ?, ?, 'reinspection', '1 minor coating touch-up required on Grid C4')`
      )
      .run(
        p1Id,
        JSON.stringify([
          { item: 'Torque verification on ASTM A490 bolts', passed: true },
          { item: 'Ultrasonic testing on moment frame welds', passed: true },
          { item: 'Intumescent fireproofing primer thickness', passed: false },
        ]),
        isoOffset(-2),
        qcId
      );
    db.prepare(
      `INSERT INTO quality_defects (inspection_id, project_id, description, severity, assigned_to, deadline, status)
       VALUES (?, ?, 'Touch up intumescent primer DFT on Gridline C4 beam splice', 'minor', ?, ?, 'open')`
    ).run(Number(qcInsp.lastInsertRowid), p1Id, siteEngId, isoOffset(4));

    // Documents (confidential vs client-visible)
    db.prepare(
      `INSERT INTO documents (project_id, category, folder, title, file_name, stored_path, mime_type, file_size, version, description, is_confidential, is_client_visible, phase_name, uploaded_by)
       VALUES
       (?, 'Contracts', 'Legal', 'Executed Prime Construction Contract (Confidential)', 'Prime_Contract_Meridian.pdf', 'seeded://contract', 'application/pdf', 2450000, 1, 'Signed prime GMP contract and internal fee schedule', 1, 0, 'Preconstruction', ?),
       (?, 'Drawings', 'Structural', 'Approved Structural Steel IFC Drawings Rev 2', 'IFC_Structural_Rev2.pdf', 'seeded://drawings', 'application/pdf', 8120000, 2, 'Issued for construction structural steel plans', 0, 1, 'Structural Steel & Decking', ?)`
    ).run(p1Id, pmId, p1Id, siteEngId);

    // Messages (internal vs client channel)
    db.prepare(
      `INSERT INTO messages (project_id, channel, sender_id, subject, body, is_announcement)
       VALUES
       (?, 'internal', ?, 'Crane Wind Hold Protocol', 'All rigging leads: confirm anemometer checks every 2 hours during afternoon gusts.', 1),
       (?, 'client', ?, 'Level 6 Structural Milestone Update', 'Dear Arthur, Level 6 structural steel framing is 72% complete and ultrasonic weld tests passed 100%.', 1)`
    ).run(p1Id, pmId, p1Id, pmId);

    // Client Revision Request (with proper change-control history)
    if (clientUserId) {
      const cr = db
        .prepare(
          `INSERT INTO client_revision_requests (
            ref_number, project_id, client_user_id, category, description, reason, preferred_date,
            status, technical_notes, cost_impact, schedule_impact_days, change_order_ref
          ) VALUES ('CR-2026-004', ?, ?, 'Finishes', 'Upgrade main lobby elevator surround from brushed aluminum to honed travertine stone cladding.', 'Executive branding alignment for tenant reception', ?, 'under_cost_evaluation', 'Structural backing stud spacing confirmed adequate for stone anchor loads.', 48500, 4, 'CO-DRAFT-004')`
        )
        .run(p1Id, clientUserId, isoOffset(45));
      const crId = Number(cr.lastInsertRowid);
      db.prepare(
        'INSERT INTO client_revision_history (request_id, actor_id, previous_status, new_status, remarks) VALUES (?, ?, ?, ?, ?)'
      ).run(crId, clientUserId, '', 'submitted', 'Client requested travertine cladding upgrade');
      db.prepare(
        'INSERT INTO client_revision_history (request_id, actor_id, previous_status, new_status, remarks) VALUES (?, ?, ?, ?, ?)'
      ).run(crId, siteEngId, 'submitted', 'under_technical_review', 'Verified wall framing dead-load capacity');
      db.prepare(
        'INSERT INTO client_revision_history (request_id, actor_id, previous_status, new_status, remarks) VALUES (?, ?, ?, ?, ?)'
      ).run(crId, pmId, 'under_technical_review', 'under_cost_evaluation', 'Stone supplier quote received; preparing formal variation quotation CO-DRAFT-004');
    }

    // Future Quotation Foundation Record
    db.prepare(
      `INSERT INTO quotations (quote_number, client_id, title, location, scope, validity_date, status, notes, prepared_by)
       VALUES ('QT-2026-012', ?, 'Meridian Phase II Parking Deck Expansion', '425 Market Street West Lot', '3-level precast parking structure — awaiting company Excel estimating workbook formula import.', ?, 'draft', 'Placeholder structure ready for workbook calculation integration.', ?)`
    ).run(client1Id, isoOffset(30), pmId);
  });

  // Seed REV1 Quotation reference catalog, PH locations, settings, and Likha ni Inay Cebu reference workbook
  ensureQuotationReferenceData();
}
