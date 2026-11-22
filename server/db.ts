import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
export const UPLOADS_DIR = path.resolve(STORAGE_ROOT, 'uploads');
const DB_PATH = process.env.SQLITE_DB_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
  : path.resolve(STORAGE_ROOT, 'cbms.db');

if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version
    )
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      const tx = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name
        );
      });
      tx();
    }
  }
}

export function transaction<T>(fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}

const MIGRATIONS: Array<{ version: string; name: string; sql: string }> = [
  {
    version: '001',
    name: 'initial_cbms_schema',
    sql: `
      -- Modules registry
      CREATE TABLE IF NOT EXISTS modules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        required_permissions_json TEXT NOT NULL DEFAULT '[]',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        install_status TEXT NOT NULL DEFAULT 'installed',
        installed_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Roles & Permissions
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 1,
        is_client_role INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        module_slug TEXT NOT NULL,
        action TEXT NOT NULL,
        UNIQUE(role_id, module_slug, action)
      );

      -- Users & Sessions
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role_id INTEGER NOT NULL REFERENCES roles(id),
        phone TEXT DEFAULT '',
        job_title TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT DEFAULT NULL,
        last_login_at TEXT DEFAULT NULL,
        mfa_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        ip_address TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS login_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        user_id INTEGER DEFAULT NULL,
        success INTEGER NOT NULL,
        ip_address TEXT DEFAULT '',
        reason TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- System Settings
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Clients & Assignments
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        primary_contact TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS client_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        is_primary INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, client_id)
      );

      -- Projects
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        client_id INTEGER NOT NULL REFERENCES clients(id),
        client_contact_info TEXT DEFAULT '',
        location TEXT NOT NULL,
        address TEXT DEFAULT '',
        description TEXT DEFAULT '',
        scope TEXT DEFAULT '',
        contract_amount REAL NOT NULL DEFAULT 0,
        approved_budget REAL NOT NULL DEFAULT 0,
        revised_budget REAL NOT NULL DEFAULT 0,
        project_manager_id INTEGER REFERENCES users(id),
        site_supervisor_id INTEGER REFERENCES users(id),
        start_date TEXT NOT NULL,
        original_end_date TEXT NOT NULL,
        revised_end_date TEXT DEFAULT NULL,
        actual_end_date TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        overall_progress REAL NOT NULL DEFAULT 0,
        schedule_delay_explanation TEXT DEFAULT '',
        delay_explanation_client_visible INTEGER NOT NULL DEFAULT 0,
        hero_image TEXT DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS project_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assignment_role TEXT NOT NULL DEFAULT 'member',
        assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, user_id)
      );

      -- Schedule Revisions, Phases, Activities
      CREATE TABLE IF NOT EXISTS schedule_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL,
        revision_note TEXT DEFAULT '',
        source_filename TEXT DEFAULT '',
        is_approved INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 0,
        approved_by INTEGER REFERENCES users(id),
        approved_at TEXT DEFAULT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, revision_number)
      );

      CREATE TABLE IF NOT EXISTS project_phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id INTEGER NOT NULL REFERENCES schedule_revisions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 1,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        actual_start_date TEXT DEFAULT NULL,
        actual_end_date TEXT DEFAULT NULL,
        weight_percent REAL NOT NULL DEFAULT 0,
        planned_progress REAL NOT NULL DEFAULT 0,
        actual_progress REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'upcoming'
      );

      CREATE TABLE IF NOT EXISTS project_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id INTEGER NOT NULL REFERENCES schedule_revisions(id) ON DELETE CASCADE,
        phase_id INTEGER REFERENCES project_phases(id) ON DELETE SET NULL,
        wbs_code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        actual_start_date TEXT DEFAULT NULL,
        actual_end_date TEXT DEFAULT NULL,
        duration_days INTEGER NOT NULL DEFAULT 1,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        is_milestone INTEGER NOT NULL DEFAULT 0,
        milestone_status TEXT DEFAULT NULL,
        weight_percent REAL NOT NULL DEFAULT 0,
        planned_progress REAL NOT NULL DEFAULT 0,
        actual_progress REAL NOT NULL DEFAULT 0,
        responsible_person TEXT DEFAULT '',
        remarks TEXT DEFAULT '',
        is_critical_path INTEGER NOT NULL DEFAULT 0
      );

      -- Daily Progress Reports
      CREATE TABLE IF NOT EXISTS daily_progress_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        report_date TEXT NOT NULL,
        site_location TEXT DEFAULT '',
        weather TEXT DEFAULT '',
        activities_performed TEXT NOT NULL,
        accomplishments TEXT DEFAULT '',
        work_completed_pct REAL NOT NULL DEFAULT 0,
        manpower_count INTEGER NOT NULL DEFAULT 0,
        materials_used TEXT DEFAULT '',
        equipment_used TEXT DEFAULT '',
        delays_problems TEXT DEFAULT '',
        safety_observations TEXT DEFAULT '',
        quality_observations TEXT DEFAULT '',
        next_day_plan TEXT DEFAULT '',
        remarks TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        prepared_by INTEGER NOT NULL REFERENCES users(id),
        reviewed_by INTEGER REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        reviewed_at TEXT DEFAULT NULL,
        approved_at TEXT DEFAULT NULL,
        is_published_to_client INTEGER NOT NULL DEFAULT 0,
        client_summary TEXT DEFAULT '',
        client_completed_activities TEXT DEFAULT '',
        client_next_activities TEXT DEFAULT '',
        client_published_by INTEGER REFERENCES users(id),
        client_published_at TEXT DEFAULT NULL,
        photos_json TEXT NOT NULL DEFAULT '[]',
        client_photos_json TEXT NOT NULL DEFAULT '[]',
        client_idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Tasks & Comments
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        assigned_to INTEGER REFERENCES users(id),
        assigned_team TEXT DEFAULT '',
        supervisor_id INTEGER REFERENCES users(id),
        reviewer_id INTEGER REFERENCES users(id),
        priority TEXT NOT NULL DEFAULT 'medium',
        start_date TEXT NOT NULL,
        deadline TEXT NOT NULL,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        progress_pct REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        completed_at TEXT DEFAULT NULL,
        client_idempotency_key TEXT UNIQUE,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Budgets, Purchase Requests, Procurement, Expenses
      CREATE TABLE IF NOT EXISTS budget_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        allocated_amount REAL NOT NULL DEFAULT 0,
        revised_amount REAL NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        UNIQUE(project_id, category)
      );

      CREATE TABLE IF NOT EXISTS purchase_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        requested_by INTEGER NOT NULL REFERENCES users(id),
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        request_date TEXT NOT NULL,
        required_date TEXT NOT NULL,
        item_description TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Materials',
        quantity REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'pcs',
        estimated_unit_cost REAL NOT NULL DEFAULT 0,
        estimated_total_cost REAL NOT NULL DEFAULT 0,
        suggested_supplier TEXT DEFAULT '',
        reason TEXT DEFAULT '',
        remarks TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'submitted',
        commitment_amount REAL NOT NULL DEFAULT 0,
        settled_amount REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS purchase_request_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        approver_id INTEGER NOT NULL REFERENCES users(id),
        stage TEXT NOT NULL,
        decision TEXT NOT NULL,
        remarks TEXT DEFAULT '',
        decided_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_number TEXT NOT NULL UNIQUE,
        pr_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        supplier_name TEXT NOT NULL,
        approved_qty REAL NOT NULL DEFAULT 0,
        ordered_qty REAL NOT NULL DEFAULT 0,
        delivered_qty REAL NOT NULL DEFAULT 0,
        actual_unit_cost REAL NOT NULL DEFAULT 0,
        actual_total_cost REAL NOT NULL DEFAULT 0,
        delivery_date TEXT DEFAULT NULL,
        receiving_confirmed_by INTEGER REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'ordered',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        expense_date TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        supplier_recipient TEXT NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'Bank Transfer',
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        pr_id INTEGER REFERENCES purchase_requests(id) ON DELETE SET NULL,
        submitted_by INTEGER NOT NULL REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        remarks TEXT DEFAULT '',
        receipt_doc_id INTEGER DEFAULT NULL,
        client_idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Personnel & Attendance
      CREATE TABLE IF NOT EXISTS personnel (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_code TEXT NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        full_name TEXT NOT NULL,
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        position TEXT NOT NULL,
        trade_skill TEXT NOT NULL,
        employment_status TEXT NOT NULL DEFAULT 'active',
        assigned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        emergency_contact TEXT DEFAULT '',
        daily_rate REAL NOT NULL DEFAULT 0,
        remarks TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        personnel_id INTEGER NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
        work_date TEXT NOT NULL,
        time_in TEXT DEFAULT '08:00',
        time_out TEXT DEFAULT '17:00',
        status TEXT NOT NULL DEFAULT 'present',
        total_hours REAL NOT NULL DEFAULT 8,
        overtime_hours REAL NOT NULL DEFAULT 0,
        remarks TEXT DEFAULT '',
        recorded_by INTEGER NOT NULL REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        client_idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, personnel_id, work_date)
      );

      -- Equipment & Inventory
      CREATE TABLE IF NOT EXISTS equipment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        brand_model TEXT DEFAULT '',
        serial_number TEXT DEFAULT '',
        ownership_type TEXT NOT NULL DEFAULT 'company_owned',
        current_location TEXT DEFAULT '',
        assigned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        assigned_operator_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
        condition_status TEXT NOT NULL DEFAULT 'operational',
        operating_hours REAL NOT NULL DEFAULT 0,
        next_maintenance_date TEXT DEFAULT NULL,
        daily_operating_cost REAL NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS equipment_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        log_type TEXT NOT NULL,
        hours_logged REAL NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        logged_by INTEGER NOT NULL REFERENCES users(id),
        log_date TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'pcs',
        current_qty REAL NOT NULL DEFAULT 0,
        min_stock_level REAL NOT NULL DEFAULT 10,
        storage_location TEXT DEFAULT 'Central Warehouse',
        supplier TEXT DEFAULT '',
        unit_cost REAL NOT NULL DEFAULT 0,
        assigned_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        tx_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0,
        reference_doc TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        performed_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Quality Control
      CREATE TABLE IF NOT EXISTS quality_inspections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        checklist_json TEXT NOT NULL DEFAULT '[]',
        inspection_date TEXT NOT NULL,
        inspector_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'scheduled',
        defects_summary TEXT DEFAULT '',
        remarks TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS quality_defects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inspection_id INTEGER NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'minor',
        assigned_to INTEGER REFERENCES users(id),
        deadline TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        resolution_notes TEXT DEFAULT '',
        resolved_at TEXT DEFAULT NULL
      );

      -- Documents & Protected Storage
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        folder TEXT NOT NULL DEFAULT 'General',
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        description TEXT DEFAULT '',
        is_confidential INTEGER NOT NULL DEFAULT 1,
        is_client_visible INTEGER NOT NULL DEFAULT 0,
        phase_name TEXT DEFAULT '',
        uploaded_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Communications & Notifications
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        channel TEXT NOT NULL DEFAULT 'internal',
        parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        subject TEXT DEFAULT '',
        body TEXT NOT NULL,
        is_announcement INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        link_section TEXT DEFAULT 'overview',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Client Revision Requests & Change Control History
      CREATE TABLE IF NOT EXISTS client_revision_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        client_user_id INTEGER NOT NULL REFERENCES users(id),
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        reason TEXT DEFAULT '',
        preferred_date TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'submitted',
        technical_notes TEXT DEFAULT '',
        cost_impact REAL DEFAULT NULL,
        schedule_impact_days INTEGER DEFAULT NULL,
        change_order_ref TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS client_revision_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES client_revision_requests(id) ON DELETE CASCADE,
        actor_id INTEGER NOT NULL REFERENCES users(id),
        previous_status TEXT DEFAULT '',
        new_status TEXT NOT NULL,
        remarks TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Quotations Foundation (Phase 6 Ready)
      CREATE TABLE IF NOT EXISTS quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_number TEXT NOT NULL UNIQUE,
        client_id INTEGER NOT NULL REFERENCES clients(id),
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        location TEXT DEFAULT '',
        scope TEXT DEFAULT '',
        validity_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        direct_cost REAL NOT NULL DEFAULT 0,
        overhead_pct REAL NOT NULL DEFAULT 0,
        contingency_pct REAL NOT NULL DEFAULT 0,
        markup_pct REAL NOT NULL DEFAULT 0,
        tax_pct REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        prepared_by INTEGER REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Append-only Audit Trail & Real-time Sync Events
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        user_email TEXT NOT NULL,
        action TEXT NOT NULL,
        module TEXT NOT NULL,
        record_type TEXT NOT NULL,
        record_ref TEXT NOT NULL,
        previous_value_json TEXT DEFAULT NULL,
        new_value_json TEXT DEFAULT NULL,
        remarks TEXT DEFAULT '',
        ip_address TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        module TEXT NOT NULL,
        project_id INTEGER DEFAULT NULL,
        client_only INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for frequent queries
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
      CREATE INDEX IF NOT EXISTS idx_activities_project ON project_activities(project_id, revision_id);
      CREATE INDEX IF NOT EXISTS idx_dpr_project_date ON daily_progress_reports(project_id, report_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_expenses_project_status ON expenses(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_pr_project_status ON purchase_requests(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_attendance_project_date ON attendance(project_id, work_date);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module, created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_events_id ON sync_events(id);
    `,
  },
  {
    version: '002',
    name: 'seed_modules_and_rbac_roles',
    sql: `
      INSERT OR IGNORE INTO modules (slug, name, description, version, dependencies_json, required_permissions_json, is_enabled) VALUES
        ('projects', 'Project Management', 'Centralized project workspaces, assignments, and metadata.', '1.0.0', '[]', '["view","create","edit","delete"]', 1),
        ('schedules', 'Schedule & Gantt', 'Excel schedule import, revision tracking, Gantt chart, and critical path.', '1.0.0', '["projects"]', '["view","create","edit","approve"]', 1),
        ('dpr', 'Daily Progress Reports', 'Site daily logs, manpower, equipment, and photo documentation.', '1.0.0', '["projects"]', '["view","create","edit","submit","review","approve","publish_client"]', 1),
        ('tasks', 'Task Management', 'List, Kanban, Calendar views, task assignments, and review workflows.', '1.0.0', '["projects"]', '["view","create","edit","delete","review","approve"]', 1),
        ('financials', 'Budget & Expenses', 'Project budgets, allocations, actual expenses, commitments, and EVM.', '1.0.0', '["projects"]', '["view","create","edit","submit","review","approve","reject","export"]', 1),
        ('procurement', 'Purchase Requests & Procurement', 'Multi-stage PR approvals, PO tracking, and commitment settlement.', '1.0.0', '["projects","financials"]', '["view","create","submit","review","approve","reject"]', 1),
        ('personnel', 'Personnel & Attendance', 'Worker directory, project assignments, and daily attendance tracking.', '1.0.0', '["projects"]', '["view","create","edit"]', 1),
        ('equipment', 'Equipment & Inventory', 'Heavy equipment tracking, maintenance logs, and material stock ledger.', '1.0.0', '["projects"]', '["view","create","edit"]', 1),
        ('quality', 'Quality Control', 'Inspections, checklists, punch lists, defects, and task generation.', '1.0.0', '["projects","tasks"]', '["view","create","edit","approve"]', 1),
        ('documents', 'Document Repository', 'Versioned project documents with confidential access controls.', '1.0.0', '["projects"]', '["view","create","delete","export"]', 1),
        ('communications', 'Communications & Notifications', 'Project message boards, announcements, and database-backed alerts.', '1.0.0', '["projects"]', '["view","create"]', 1),
        ('client_portal', 'Client Portal', 'Restricted client reporting, timeline, photo gallery, and revision requests.', '1.0.0', '["projects","schedules","dpr"]', '["view","create","publish_client"]', 1),
        ('quotations', 'Quotations & Estimating', 'Phase 6 foundation for BOQ estimates and quotation-to-project conversion.', '0.9.0', '["projects"]', '["view","create","approve"]', 1);

      INSERT OR IGNORE INTO roles (slug, name, description, is_system, is_client_role) VALUES
        ('system_admin', 'System Administrator', 'Full platform, user, module, security, and maintenance control.', 1, 0),
        ('executive', 'Company Owner / Executive', 'Executive dashboard, company-wide oversight, and final approvals.', 1, 0),
        ('general_manager', 'General Manager', 'Cross-project operations, financial approvals, and resource oversight.', 1, 0),
        ('project_manager', 'Project Manager', 'Assigned project management, schedule approval, DPR publication, and client liaison.', 1, 0),
        ('project_engineer', 'Project Engineer', 'Schedule imports, engineering reviews, quality tracking, and DPR review.', 1, 0),
        ('site_engineer', 'Site Engineer', 'Daily site progress reporting, technical inspections, and task execution.', 1, 0),
        ('site_supervisor', 'Site Supervisor', 'Crew attendance, daily site execution, and field task supervision.', 1, 0),
        ('procurement_officer', 'Procurement Officer', 'Purchase request processing, supplier orders, and receiving.', 1, 0),
        ('finance_officer', 'Finance Officer', 'Budgets, expense verification, commitment settlement, and EVM reports.', 1, 0),
        ('hr_admin', 'HR / Administrative Officer', 'Personnel directory, assignments, attendance audits, and admin docs.', 1, 0),
        ('warehouse_staff', 'Warehouse / Inventory Personnel', 'Material receiving, issuing, transfers, and stock alerts.', 1, 0),
        ('qc_personnel', 'Quality Control Personnel', 'Site inspections, checklists, punch lists, and defect verification.', 1, 0),
        ('field_personnel', 'Field Personnel', 'Assigned tasks and daily field updates.', 1, 0),
        ('client_rep', 'Client Representative', 'Strictly isolated Client Portal access for assigned projects only.', 1, 1);
    `,
  },
  {
    version: '003',
    name: 'task_personnel_and_qc_reporter',
    sql: `
      ALTER TABLE tasks ADD COLUMN assigned_personnel_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL;
      ALTER TABLE quality_inspections ADD COLUMN reported_by_personnel_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL;
    `,
  },
  {
    version: '004',
    name: 'project_financial_analysis_payments_cash_requests',
    sql: `
      ALTER TABLE projects ADD COLUMN tpc_rate REAL NOT NULL DEFAULT 0;
      ALTER TABLE projects ADD COLUMN sales_commission REAL NOT NULL DEFAULT 0;
      ALTER TABLE projects ADD COLUMN opex_amount REAL NOT NULL DEFAULT 0;
      ALTER TABLE projects ADD COLUMN financial_notes TEXT DEFAULT '';

      CREATE TABLE IF NOT EXISTS project_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        payment_date TEXT NOT NULL,
        amount REAL NOT NULL,
        remarks TEXT DEFAULT '',
        reference_no TEXT DEFAULT '',
        recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cash_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        request_date TEXT NOT NULL,
        custodian_name TEXT NOT NULL,
        custodian_personnel_id INTEGER REFERENCES personnel(id) ON DELETE SET NULL,
        custodian_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        amount_requested REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'released',
        remarks TEXT DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE expenses ADD COLUMN cash_request_id INTEGER REFERENCES cash_requests(id) ON DELETE SET NULL;
      ALTER TABLE expenses ADD COLUMN custodian_name TEXT DEFAULT '';
    `,
  },
  {
    version: '005',
    name: 'client_representative_details',
    sql: `
      ALTER TABLE clients ADD COLUMN representative_title TEXT DEFAULT '';
      ALTER TABLE clients ADD COLUMN secondary_contact TEXT DEFAULT '';
      ALTER TABLE clients ADD COLUMN notes TEXT DEFAULT '';
    `,
  },
  {
    version: '006',
    name: 'warehouse_toolbox_enhancements',
    sql: `
      ALTER TABLE inventory_items ADD COLUMN reserved_qty REAL NOT NULL DEFAULT 0;
      ALTER TABLE inventory_items ADD COLUMN issued_qty REAL NOT NULL DEFAULT 0;

      ALTER TABLE equipment ADD COLUMN asset_number TEXT DEFAULT '';
      ALTER TABLE equipment ADD COLUMN acquisition_date TEXT DEFAULT NULL;
      ALTER TABLE equipment ADD COLUMN deployment_date TEXT DEFAULT NULL;
      ALTER TABLE equipment ADD COLUMN expected_return_date TEXT DEFAULT NULL;

      CREATE TABLE IF NOT EXISTS warehouse_releases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref_number TEXT NOT NULL UNIQUE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        request_date TEXT NOT NULL,
        release_date TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'requested',
        warehouse_location TEXT DEFAULT 'Central Warehouse',
        released_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        remarks TEXT DEFAULT '',
        documents_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS warehouse_release_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        release_id INTEGER NOT NULL REFERENCES warehouse_releases(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        requested_qty REAL NOT NULL DEFAULT 0,
        approved_qty REAL NOT NULL DEFAULT 0,
        released_qty REAL NOT NULL DEFAULT 0,
        received_qty REAL NOT NULL DEFAULT 0,
        consumed_qty REAL NOT NULL DEFAULT 0,
        returned_qty REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending'
      );
    `,
  },
  {
    version: '007',
    name: 'rev1_quotation_estimating',
    sql: `
      ALTER TABLE quotations ADD COLUMN current_revision_id INTEGER DEFAULT NULL;
      ALTER TABLE quotations ADD COLUMN current_revision_code TEXT NOT NULL DEFAULT 'REV00';
      ALTER TABLE quotations ADD COLUMN subject TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN site_location TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN province TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN municipality TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN barangay TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN zip_code TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN attention_to TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN attention_title TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN thru_person TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN thru_title TEXT DEFAULT '';
      ALTER TABLE quotations ADD COLUMN currency TEXT NOT NULL DEFAULT 'PHP';
      ALTER TABLE quotations ADD COLUMN vat_rate REAL NOT NULL DEFAULT 12;
      ALTER TABLE quotations ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN estimated_manpower INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN estimated_duration_days INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN subtotal_pre_vat REAL NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN vat_amount REAL NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN final_amount REAL NOT NULL DEFAULT 0;
      ALTER TABLE quotations ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE quotations ADD COLUMN sent_at TEXT DEFAULT NULL;
      ALTER TABLE quotations ADD COLUMN accepted_at TEXT DEFAULT NULL;
      ALTER TABLE quotations ADD COLUMN converted_at TEXT DEFAULT NULL;
      ALTER TABLE quotations ADD COLUMN converted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS quotation_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        revision_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        subject TEXT DEFAULT '',
        site_location TEXT DEFAULT '',
        province TEXT DEFAULT '',
        municipality TEXT DEFAULT '',
        barangay TEXT DEFAULT '',
        zip_code TEXT DEFAULT '',
        attention_to TEXT DEFAULT '',
        attention_title TEXT DEFAULT '',
        thru_person TEXT DEFAULT '',
        thru_title TEXT DEFAULT '',
        estimated_manpower INTEGER NOT NULL DEFAULT 0,
        estimated_duration_days INTEGER NOT NULL DEFAULT 0,
        vat_rate REAL NOT NULL DEFAULT 12,
        discount_pct REAL NOT NULL DEFAULT 0,
        scope_options_json TEXT NOT NULL DEFAULT '{}',
        terms_json TEXT NOT NULL DEFAULT '{}',
        notes_json TEXT NOT NULL DEFAULT '[]',
        subtotal_mat_cost REAL NOT NULL DEFAULT 0,
        subtotal_lbr_cost REAL NOT NULL DEFAULT 0,
        total_direct_cost REAL NOT NULL DEFAULT 0,
        subtotal_mat_sell REAL NOT NULL DEFAULT 0,
        subtotal_lbr_sell REAL NOT NULL DEFAULT 0,
        total_selling_pre_vat REAL NOT NULL DEFAULT 0,
        vat_amount REAL NOT NULL DEFAULT 0,
        total_selling_vat_inc REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        final_amount REAL NOT NULL DEFAULT 0,
        gross_profit_amount REAL NOT NULL DEFAULT 0,
        gross_profit_pct REAL NOT NULL DEFAULT 0,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        revision_reason TEXT DEFAULT '',
        prepared_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        prepared_by_title TEXT DEFAULT '',
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        approved_by_title TEXT DEFAULT '',
        is_locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(quotation_id, revision_code)
      );

      CREATE TABLE IF NOT EXISTS quotation_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        revision_id INTEGER NOT NULL REFERENCES quotation_revisions(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_collapsed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS quotation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        revision_id INTEGER NOT NULL REFERENCES quotation_revisions(id) ON DELETE CASCADE,
        section_id INTEGER NOT NULL REFERENCES quotation_sections(id) ON DELETE CASCADE,
        parent_item_id INTEGER DEFAULT NULL,
        row_type TEXT NOT NULL DEFAULT 'item',
        line_no TEXT DEFAULT '',
        item_code TEXT DEFAULT '',
        description TEXT NOT NULL,
        specification TEXT DEFAULT '',
        qty REAL NOT NULL DEFAULT 1,
        unit TEXT DEFAULT 'lot',
        mat_pricing_mode TEXT NOT NULL DEFAULT 'computed',
        lbr_pricing_mode TEXT NOT NULL DEFAULT 'computed',
        visibility_mode TEXT NOT NULL DEFAULT 'visible',
        rollup_children INTEGER NOT NULL DEFAULT 0,
        mat_unit_cost REAL NOT NULL DEFAULT 0,
        lbr_unit_cost REAL NOT NULL DEFAULT 0,
        mat_gp_pct REAL NOT NULL DEFAULT 0.3,
        lbr_gp_pct REAL NOT NULL DEFAULT 0.3,
        mat_sell_rate REAL NOT NULL DEFAULT 0,
        lbr_sell_rate REAL NOT NULL DEFAULT 0,
        combined_unit_rate REAL NOT NULL DEFAULT 0,
        extended_mat_sell REAL NOT NULL DEFAULT 0,
        extended_lbr_sell REAL NOT NULL DEFAULT 0,
        extended_selling REAL NOT NULL DEFAULT 0,
        extended_mat_cost REAL NOT NULL DEFAULT 0,
        extended_lbr_cost REAL NOT NULL DEFAULT 0,
        extended_cost REAL NOT NULL DEFAULT 0,
        gross_profit REAL NOT NULL DEFAULT 0,
        override_mat_rate REAL DEFAULT NULL,
        override_lbr_rate REAL DEFAULT NULL,
        override_reason TEXT DEFAULT '',
        overridden_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        overridden_at TEXT DEFAULT NULL,
        catalog_item_id INTEGER DEFAULT NULL,
        supplier_ref TEXT DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS quotation_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        revision_id INTEGER NOT NULL REFERENCES quotation_revisions(id) ON DELETE CASCADE,
        actor_id INTEGER NOT NULL REFERENCES users(id),
        stage TEXT NOT NULL,
        decision TEXT NOT NULL,
        previous_status TEXT DEFAULT '',
        new_status TEXT NOT NULL,
        remarks TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS quotation_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        revision_id INTEGER REFERENCES quotation_revisions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        comment TEXT NOT NULL,
        is_internal INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS quotation_catalog_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        specification TEXT DEFAULT '',
        category TEXT NOT NULL,
        subcategory TEXT DEFAULT '',
        default_unit TEXT NOT NULL DEFAULT 'lot',
        mat_unit_cost REAL NOT NULL DEFAULT 0,
        lbr_unit_cost REAL NOT NULL DEFAULT 0,
        default_mat_gp_pct REAL NOT NULL DEFAULT 0.3,
        default_lbr_gp_pct REAL NOT NULL DEFAULT 0.3,
        supplier_ref TEXT DEFAULT '',
        is_general_requirement INTEGER NOT NULL DEFAULT 0,
        calc_rule TEXT DEFAULT 'fixed',
        is_active INTEGER NOT NULL DEFAULT 1,
        remarks TEXT DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS quotation_item_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_item_id INTEGER NOT NULL REFERENCES quotation_catalog_items(id) ON DELETE CASCADE,
        cost_type TEXT NOT NULL,
        previous_cost REAL NOT NULL DEFAULT 0,
        new_cost REAL NOT NULL DEFAULT 0,
        effective_date TEXT NOT NULL,
        supplier_ref TEXT DEFAULT '',
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        remarks TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS quotation_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS quotation_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        section_default TEXT DEFAULT 'B',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS ph_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region TEXT NOT NULL,
        province TEXT NOT NULL,
        municipality TEXT NOT NULL,
        barangay TEXT DEFAULT '',
        zip_code TEXT DEFAULT '',
        distance_km REAL NOT NULL DEFAULT 0,
        mobilization_tier TEXT DEFAULT 'Metro',
        base_mobilization_cost REAL NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS quotation_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        company_name TEXT NOT NULL DEFAULT 'REV1 CONSTRUCTION CORP.',
        company_address TEXT NOT NULL DEFAULT 'CM 104, CITI CONDOS, 214 MALINAO ST., BRGY. HIGHWAY HILLS, MANDALUYONG CITY',
        company_email TEXT NOT NULL DEFAULT 'info@rev1corp.com',
        company_phone TEXT NOT NULL DEFAULT '(+632) 8516 - 4938',
        payee_name TEXT NOT NULL DEFAULT 'REV1 CONSTRUCTION CORP',
        prefix TEXT NOT NULL DEFAULT 'RCC',
        year_code TEXT NOT NULL DEFAULT '26',
        next_seq INTEGER NOT NULL DEFAULT 1998068,
        doc_type TEXT NOT NULL DEFAULT 'CONS',
        default_vat_rate REAL NOT NULL DEFAULT 12,
        default_mat_gp_pct REAL NOT NULL DEFAULT 0.3,
        default_lbr_gp_pct REAL NOT NULL DEFAULT 0.3,
        max_estimator_discount_pct REAL NOT NULL DEFAULT 2,
        max_pm_discount_pct REAL NOT NULL DEFAULT 5,
        min_gp_warning_pct REAL NOT NULL DEFAULT 20,
        require_two_step_approval INTEGER NOT NULL DEFAULT 1,
        allow_self_approval INTEGER NOT NULL DEFAULT 0,
        default_terms_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS quotation_conversion_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
        revision_id INTEGER NOT NULL REFERENCES quotation_revisions(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        converted_by INTEGER NOT NULL REFERENCES users(id),
        override_reason TEXT DEFAULT '',
        budget_initialized INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_quote_revisions_q ON quotation_revisions(quotation_id);
      CREATE INDEX IF NOT EXISTS idx_quote_items_rev ON quotation_items(revision_id, section_id);
      CREATE INDEX IF NOT EXISTS idx_quote_catalog_cat ON quotation_catalog_items(category, is_active);
      CREATE INDEX IF NOT EXISTS idx_ph_locations_prov ON ph_locations(province, municipality);

      UPDATE modules
      SET description = 'REV1 Quotation, Estimating, GP Pricing Engine, Confidentiality Controls & Project Conversion.',
          version = '1.0.0',
          required_permissions_json = '["view","create","edit","submit","review","approve","reject","export","view_internal_costing","override_pricing","apply_discount","approve_discount","convert_project","manage_settings"]'
      WHERE slug = 'quotations';
    `,
  },
];

export function seedDefaultRolePermissions(): void {
  const roles = db.prepare('SELECT id, slug FROM roles').all() as Array<{ id: number; slug: string }>;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, module_slug, action) VALUES (?, ?, ?)'
  );

  const allModules = [
    'projects',
    'schedules',
    'dpr',
    'tasks',
    'financials',
    'procurement',
    'personnel',
    'equipment',
    'inventory',
    'quality',
    'documents',
    'communications',
    'reports',
    'client_portal',
    'quotations',
    'admin',
  ];
  const allActions = [
    'view',
    'create',
    'edit',
    'delete',
    'submit',
    'review',
    'approve',
    'reject',
    'export',
    'publish_client',
  ];
  const quotationFullActions = [
    'view',
    'create',
    'edit',
    'delete',
    'submit',
    'review',
    'approve',
    'reject',
    'export',
    'view_internal_costing',
    'override_pricing',
    'apply_discount',
    'approve_discount',
    'convert_project',
    'manage_settings',
  ];

  const tx = db.transaction(() => {
    for (const role of roles) {
      if (['system_admin', 'executive', 'general_manager'].includes(role.slug)) {
        for (const m of allModules) {
          if (m === 'admin' && role.slug !== 'system_admin') {
            insert.run(role.id, 'admin', 'view');
            continue;
          }
          const acts = m === 'quotations' ? quotationFullActions : allActions;
          for (const a of acts) {
            insert.run(role.id, m, a);
          }
        }
      } else if (role.slug === 'project_manager') {
        for (const m of allModules.filter((x) => x !== 'admin')) {
          const acts =
            m === 'quotations'
              ? ['view', 'create', 'edit', 'submit', 'review', 'approve', 'export', 'view_internal_costing', 'apply_discount', 'convert_project']
              : allActions;
          for (const a of acts) {
            insert.run(role.id, m, a);
          }
        }
      } else if (['project_engineer', 'site_engineer'].includes(role.slug)) {
        for (const m of ['projects', 'schedules', 'dpr', 'tasks', 'quality', 'documents', 'communications', 'equipment', 'inventory', 'reports']) {
          for (const a of ['view', 'create', 'edit', 'submit', 'review']) {
            insert.run(role.id, m, a);
          }
        }
        for (const a of ['view', 'create', 'edit', 'submit', 'view_internal_costing', 'export']) {
          insert.run(role.id, 'quotations', a);
        }
        insert.run(role.id, 'procurement', 'view');
        insert.run(role.id, 'procurement', 'create');
        insert.run(role.id, 'procurement', 'submit');
        insert.run(role.id, 'personnel', 'view');
        insert.run(role.id, 'financials', 'view');
      } else if (role.slug === 'site_supervisor') {
        for (const m of ['projects', 'schedules', 'dpr', 'tasks', 'personnel', 'equipment', 'inventory', 'quality', 'communications']) {
          for (const a of ['view', 'create', 'edit', 'submit']) {
            insert.run(role.id, m, a);
          }
        }
      } else if (role.slug === 'procurement_officer') {
        for (const m of ['projects', 'procurement', 'inventory', 'documents', 'communications', 'reports']) {
          for (const a of ['view', 'create', 'edit', 'submit', 'review', 'approve', 'export']) {
            insert.run(role.id, m, a);
          }
        }
        insert.run(role.id, 'financials', 'view');
        // Procurement officer may view client-facing quote line items for sourcing reference, without internal GP/costing by default
        insert.run(role.id, 'quotations', 'view');
      } else if (role.slug === 'finance_officer') {
        for (const m of ['projects', 'financials', 'procurement', 'documents', 'communications', 'reports']) {
          for (const a of ['view', 'create', 'edit', 'review', 'approve', 'reject', 'export']) {
            insert.run(role.id, m, a);
          }
        }
        for (const a of ['view', 'review', 'approve', 'reject', 'export', 'view_internal_costing', 'approve_discount']) {
          insert.run(role.id, 'quotations', a);
        }
      } else if (role.slug === 'hr_admin') {
        for (const m of ['projects', 'personnel', 'documents', 'communications', 'reports']) {
          for (const a of ['view', 'create', 'edit', 'export']) {
            insert.run(role.id, m, a);
          }
        }
      } else if (role.slug === 'warehouse_staff') {
        for (const m of ['projects', 'inventory', 'equipment', 'procurement', 'communications']) {
          for (const a of ['view', 'create', 'edit']) {
            insert.run(role.id, m, a);
          }
        }
      } else if (role.slug === 'qc_personnel') {
        for (const m of ['projects', 'quality', 'tasks', 'dpr', 'documents', 'communications']) {
          for (const a of ['view', 'create', 'edit', 'submit', 'approve', 'reject']) {
            insert.run(role.id, m, a);
          }
        }
      } else if (role.slug === 'field_personnel') {
        for (const m of ['projects', 'tasks', 'dpr', 'communications']) {
          insert.run(role.id, m, 'view');
        }
        insert.run(role.id, 'tasks', 'edit');
        insert.run(role.id, 'dpr', 'create');
      } else if (role.slug === 'client_rep') {
        insert.run(role.id, 'client_portal', 'view');
        insert.run(role.id, 'client_portal', 'create');
      }
    }
  });
  tx();
}
