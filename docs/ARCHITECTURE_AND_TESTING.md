# BuildCore CBMS — Architecture, RBAC Matrix, Security & Verification

## 1. Modular Monolithic Architecture

BuildCore CBMS uses a clean, maintainable **Modular Monolith** designed to run natively on Node.js + Express + SQLite (with WebSockets) AND deploy cleanly to shared hosting environments (Apache + PHP 8.3/8.4 + MySQL + REST polling fallback).

```text
├── server.ts                    # Express HTTP + WebSocket server + Vite/dist serving
├── server/
│   ├── db.ts                    # SQLite WAL initialization, migrations (001, 002), 14 RBAC roles
│   ├── auth.ts                  # scrypt password hashing, Bearer sessions, RBAC, project scoping, audit_logs
│   ├── realtime.ts              # WebSocket /ws room & presence + sync_events log + client isolation
│   ├── calculations.ts          # Planned progress, CPM critical path, EVM (PV/EV/AC/SPI/CPI/EAC/ETC), commitment math
│   ├── seed.ts                  # Optional sample portfolio generator (3 projects, schedules, DPRs, QC, PRs)
│   └── routes/
│       ├── authRoutes.ts        # First-run admin claim, login lockout, password change/reset
│       ├── adminRoutes.ts       # Users, roles, module dependencies, clients, audit logs, maintenance cron, JSON backup
│       ├── projectRoutes.ts     # Executive dashboard, projects, Excel schedule import, DPRs, Tasks
│       ├── financeResourceRoutes.ts # Financials, PRs/POs, Personnel/Attendance, Equipment/Inventory, QC, Docs, Sync, Quotations
│       └── clientPortalRoutes.ts    # Strictly isolated Client Portal endpoints (zero internal financial/staff leakage)
├── src/
│   ├── lib/
│   │   ├── api.ts               # Memory-only Bearer token transport & formatters
│   │   └── offlineDb.ts         # IndexedDB snapshot cache + idempotent offline mutation queue
│   ├── context/
│   │   ├── AuthContext.tsx      # Session state & RBAC permission helper
│   │   └── SyncContext.tsx      # WebSocket + 15s REST polling fallback + offline queue auto-flush
│   ├── components/
│   │   ├── AppShell.tsx         # RBAC-filtered sidebar, mobile drawer, live sync status, notifications
│   │   ├── Charts.tsx           # Zero-pill StatusLabel + 4 pure SVG visualization primitives
│   │   ├── PWAComponents.tsx    # Install prompt + offline status toast
│   │   └── ScheduleImportModal.tsx # 4-step Excel (.xlsx/.csv) importer with column mapper & template download
│   └── pages/
│       ├── AuthViews.tsx        # First-run admin bootstrap, sign in, password reset request
│       ├── ExecutiveDashboard.tsx
│       ├── ProjectsListView.tsx
│       ├── ProjectWorkspaceView.tsx
│       ├── ClientPortalView.tsx
│       ├── ReportsView.tsx      # Filtered multi-module reports + CSV, Excel (.xlsx), Print-to-PDF
│       └── GlobalOperationsViews.tsx # Tasks, Procurement, Personnel, Equipment, Revisions, Quotations, Admin
├── deploy/
│   ├── mysql/migrations/        # MySQL 8.0 / MariaDB 10.6+ InnoDB schema & role seeds
│   ├── php-api/                 # Shared hosting GoDaddy cPanel PHP 8.3/8.4 REST API, .htaccess & cron
│   └── self-hosted/             # Nginx HTTPS/WebSocket proxy & systemd service
└── docs/                        # Deployment & architecture documentation
```

---

## 2. Core Data Integrity & Business Rules

1. **Non-Double-Counting Procurement -> Expense Settlement**:
   - Approved Purchase Requests increase `commitment_amount` (open commitment = `MAX(0, commitment_amount - settled_amount)`).
   - When a linked Expense (`pr_id`) is approved (`POST /api/expenses/:id/decision`), an atomic transaction marks the expense `approved` and increments `purchase_requests.settled_amount`, automatically reducing remaining open commitments.
   - `Forecast Final Cost = Actual Spent + Open Commitments` (or `Revised Budget` if higher).
   - Unused budget is **never** counted as profit (`Estimated Profit = Contract Amount - Forecast Final Cost`).
2. **Schedule Revision Preservation & CPM**:
   - Excel imports create a new `schedule_revisions` record (`revision_number + 1`) so historical baselines are never overwritten.
   - Forward & backward Critical Path Method (`computeCriticalPath`) computes float (`LS - ES === 0`) across activity dependencies and flags `is_critical_path`.
3. **Daily Progress Report (DPR) Confidentiality**:
   - Every DPR defaults to `is_published_to_client = 0`.
   - Publishing requires explicit PM/Admin action (`POST /api/dpr/:id/publish-client`) with sanitized `client_summary`, `client_completed_activities`, `client_next_activities`, and selected `client_photos_json`.
   - Internal fields (`delays_problems`, manpower costs, internal remarks) are never returned to Client Portal APIs.
4. **Client Revision Requests Governance**:
   - Client revision requests move through controlled review stages (`submitted` -> `under_review` -> `cost_schedule_assessed` -> `approved_for_quotation` -> `client_approved` -> `implemented` or `declined`).
   - Submitting or reviewing a revision **never** automatically mutates `projects.contract_amount`, budgets, or active schedules.
5. **Earned Value Management (EVM)**:
   - `PV` = Planned % × Budget; `EV` = Actual % × Budget; `AC` = Actual Approved Expenses (`provisional` flag surfaced whenever baseline/expenses are incomplete).
   - `SPI = EV / PV`, `CPI = EV / AC`, `EAC = BAC / CPI`, `ETC = EAC - AC`.

---

## 3. Security & Isolation Controls

- **Password Hashing**: Node `crypto.scryptSync` with unique 16-byte random salt per user and `crypto.timingSafeEqual` verification. (PHP shared-hosting runtime uses `password_hash(..., PASSWORD_DEFAULT)` + `password_verify`).
- **Account Lockout**: 5 consecutive failed logins lock the account for 15 minutes (`login_logs` records all attempts).
- **Session Storage**: Raw Bearer tokens stay in React memory only (never `localStorage`/`sessionStorage`). The database stores only the SHA-256 hash (`sessions.token_hash`).
- **RBAC + Project Scoping**: Every API route enforces `requireAuth`, `requireModule`, `requirePermission`, and `canAccessProject`. Client users (`is_client_role = 1`) are blocked from all internal routes via `requireInternalUser`.
- **Protected File Storage**: Uploaded files are written to `storage/uploads/` outside `public/`. Downloads verify DB record authorization, `is_client_visible` for client users, and canonical path confinement (`resolvedPath.startsWith(UPLOADS_DIR + path.sep)`).
- **Immutable Audit Logs**: `audit_logs` records user, action, module, record ref, before/after JSON, IP, and timestamp with no update/delete endpoints.
- **Offline Idempotency**: Offline-queued DPRs, tasks, expenses, and attendance carry `clientIdempotencyKey` (`UNIQUE` column) so automatic queue flushes never create duplicate records.
