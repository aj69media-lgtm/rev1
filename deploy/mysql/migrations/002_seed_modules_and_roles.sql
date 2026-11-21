-- BuildCore CBMS - MySQL 8.0+ / MariaDB 10.6+ Seed Modules & 14 RBAC Roles
SET NAMES utf8mb4;

INSERT IGNORE INTO modules (slug, name, description, version, dependencies_json, required_permissions_json, is_enabled) VALUES
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

INSERT IGNORE INTO roles (slug, name, description, is_system, is_client_role) VALUES
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

-- Grant full operational permissions to system_admin, executive, general_manager
INSERT IGNORE INTO role_permissions (role_id, module_slug, action)
SELECT r.id, m.slug, a.act
FROM roles r
CROSS JOIN modules m
CROSS JOIN (
  SELECT 'view' AS act UNION ALL SELECT 'create' UNION ALL SELECT 'edit' UNION ALL SELECT 'delete'
  UNION ALL SELECT 'submit' UNION ALL SELECT 'review' UNION ALL SELECT 'approve'
  UNION ALL SELECT 'reject' UNION ALL SELECT 'publish_client' UNION ALL SELECT 'export'
) a
WHERE r.slug IN ('system_admin', 'executive', 'general_manager');

INSERT IGNORE INTO role_permissions (role_id, module_slug, action)
SELECT id, 'admin', a.act
FROM roles
CROSS JOIN (SELECT 'view' AS act UNION ALL SELECT 'create' UNION ALL SELECT 'edit' UNION ALL SELECT 'delete' UNION ALL SELECT 'export') a
WHERE slug = 'system_admin';

-- Project Manager baseline permissions
INSERT IGNORE INTO role_permissions (role_id, module_slug, action)
SELECT r.id, p.m, p.a
FROM roles r
CROSS JOIN (
  SELECT 'projects' AS m, 'view' AS a UNION ALL SELECT 'projects','create' UNION ALL SELECT 'projects','edit'
  UNION ALL SELECT 'schedules','view' UNION ALL SELECT 'schedules','create' UNION ALL SELECT 'schedules','edit' UNION ALL SELECT 'schedules','approve'
  UNION ALL SELECT 'dpr','view' UNION ALL SELECT 'dpr','create' UNION ALL SELECT 'dpr','review' UNION ALL SELECT 'dpr','approve' UNION ALL SELECT 'dpr','publish_client'
  UNION ALL SELECT 'tasks','view' UNION ALL SELECT 'tasks','create' UNION ALL SELECT 'tasks','edit' UNION ALL SELECT 'tasks','review' UNION ALL SELECT 'tasks','approve'
  UNION ALL SELECT 'financials','view' UNION ALL SELECT 'financials','create' UNION ALL SELECT 'financials','submit' UNION ALL SELECT 'financials','review' UNION ALL SELECT 'financials','export'
  UNION ALL SELECT 'procurement','view' UNION ALL SELECT 'procurement','create' UNION ALL SELECT 'procurement','submit' UNION ALL SELECT 'procurement','review'
  UNION ALL SELECT 'personnel','view' UNION ALL SELECT 'personnel','create' UNION ALL SELECT 'personnel','edit'
  UNION ALL SELECT 'equipment','view' UNION ALL SELECT 'equipment','create'
  UNION ALL SELECT 'quality','view' UNION ALL SELECT 'quality','create' UNION ALL SELECT 'quality','approve'
  UNION ALL SELECT 'documents','view' UNION ALL SELECT 'documents','create' UNION ALL SELECT 'documents','export'
  UNION ALL SELECT 'communications','view' UNION ALL SELECT 'communications','create'
  UNION ALL SELECT 'client_portal','view' UNION ALL SELECT 'client_portal','publish_client'
  UNION ALL SELECT 'quotations','view' UNION ALL SELECT 'quotations','create'
) p
WHERE r.slug = 'project_manager';

-- Client Representative strictly isolated to Client Portal
INSERT IGNORE INTO role_permissions (role_id, module_slug, action)
SELECT r.id, 'client_portal', a.act
FROM roles r
CROSS JOIN (SELECT 'view' AS act UNION ALL SELECT 'create') a
WHERE r.slug = 'client_rep';

INSERT IGNORE INTO schema_migrations (version, name) VALUES ('002', 'seed_modules_and_rbac_roles');
