# BuildCore CBMS — Installation, Migration & Deployment Guide

This guide provides step-by-step instructions to install, configure, migrate, and operate **BuildCore CBMS** across three environments:

1. **Local Development** (Node.js 20+ / SQLite — Zero-config preview & WebSocket real-time)
2. **Shared Hosting — GoDaddy cPanel** (Compiled React SPA + PHP 8.3/8.4 + MySQL/MariaDB + REST Polling + Cron Jobs — no persistent Node server required)
3. **Self-Hosted VPS / Dedicated Server** (Ubuntu/Debian Linux + Node.js + WebSocket + Nginx SSL Reverse Proxy + systemd + Automated Backups)

---

## 1. Environment Variables Reference

Copy `.env.example` to `.env` and configure the variables appropriate for your environment. **Never commit `.env` or real secrets to version control.**

| Variable | Local (Node + SQLite) | Shared Hosting (cPanel PHP + MySQL) | Self-Hosted VPS | Description |
|---|---|---|---|---|
| `NODE_ENV` | `development` | N/A | `production` | Runtime mode |
| `PORT` | `3000` | N/A | `3000` | Express HTTP/WS port |
| `APP_URL` | `http://localhost:3000` | `https://yourdomain.com` | `https://cbms.yourdomain.com` | Canonical public URL |
| `APP_NAME` | `BuildCore CBMS` | `BuildCore CBMS` | `BuildCore CBMS` | Display name |
| `SESSION_SECRET` | Random 64-hex string | Random 64-hex string | Random 64-hex string | Session signing secret |
| `SESSION_TTL_HOURS` | `24` | `24` | `24` | Session expiration lifetime |
| `MAX_FAILED_LOGINS` | `5` | `5` | `5` | Lockout threshold |
| `LOCKOUT_MINUTES` | `15` | `15` | `15` | Temporary lockout duration |
| `SQLITE_DB_PATH` | `./storage/cbms.db` | N/A | `/opt/cbms/storage/cbms.db` | SQLite database file |
| `DB_DRIVER` | `sqlite` | `mysql` | `sqlite` or `mysql` | Database driver |
| `DB_HOST` | N/A | `localhost` | `127.0.0.1` | MySQL host |
| `DB_PORT` | N/A | `3306` | `3306` | MySQL port |
| `DB_DATABASE` | N/A | `cpaneluser_cbms` | `cbms_prod` | MySQL schema name |
| `DB_USERNAME` | N/A | `cpaneluser_cbmsuser` | `cbms_user` | MySQL user |
| `DB_PASSWORD` | N/A | `<strong-db-password>` | `<strong-db-password>` | MySQL password |
| `STORAGE_DIR` | `./storage/uploads` | `/home/<user>/cbms/storage/uploads` | `/opt/cbms/storage/uploads` | Protected file upload directory (outside webroot) |
| `MAX_UPLOAD_MB` | `10` | `10` | `25` | Max upload size per file |

Generate a cryptographically random `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Local Development Installation (Node.js + SQLite)

### Prerequisites
- Node.js `20.x` or `22.x` LTS (`node -v`)
- npm `10.x`+ (`npm -v`)

### Steps
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to set a random `SESSION_SECRET`. SQLite automatically initializes at `storage/cbms.db`.
3. **Start the full-stack server (Express + WebSocket + Vite):**
   ```bash
   npm run dev
   ```
4. **Access the application:**
   - Open `http://localhost:3000`.
   - On first run, the **Initial System Administrator Setup** screen appears automatically.
   - Enter your company name, admin full name, email, and a strong password (min 8 characters).
   - Optionally check **Seed sample projects & role test users** and provide a single temporary password for those sample accounts.
5. **Production build check:**
   ```bash
   npm run build
   npm run lint
   ```

---

## 3. Shared Hosting Deployment (GoDaddy cPanel / Apache / PHP 8.3+ / MySQL)

Shared hosting accounts (such as GoDaddy cPanel) generally **do not allow persistent Node.js processes or WebSocket daemons**. BuildCore CBMS supports this cleanly via:
- Pre-compiled static React + PWA assets (`npm run build` -> `dist/`)
- PHP 8.3/8.4 modular REST API (`deploy/php-api/`) using PDO MySQL
- Automatic REST delta polling fallback (`/api/sync/events?since=<id>`) when WebSockets are unavailable
- cPanel Cron Jobs (`deploy/php-api/cron/run_scheduled_tasks.php`)

### Step 3.1: Verify PHP Version & Extensions in cPanel
1. Log into **GoDaddy cPanel** -> **Select PHP Version**.
2. Choose **PHP 8.3** (or **8.4**).
3. Ensure these extensions are enabled:
   - `pdo`, `pdo_mysql`, `json`, `mbstring`, `openssl`, `fileinfo`, `zip`, `gd`
4. Optional verification: Upload `deploy/php-api/check_compatibility.php` briefly to a non-public check or run via SSH:
   ```bash
   php deploy/php-api/check_compatibility.php
   ```
   Confirm `"compatible": true`, then remove `check_compatibility.php` from any public directory.

### Step 3.2: Create MySQL Database & Run Migrations
1. In cPanel -> **MySQL Databases**:
   - Create a database (e.g., `cpaneluser_cbms`).
   - Create a database user with a strong password (e.g., `cpaneluser_cbmsuser`).
   - Assign **ALL PRIVILEGES** on `cpaneluser_cbms` to `cpaneluser_cbmsuser`.
2. In cPanel -> **phpMyAdmin** (or SSH `mysql` CLI):
   - Select `cpaneluser_cbms`.
   - Import `/deploy/mysql/migrations/001_initial_schema.sql` (creates all 30 InnoDB `utf8mb4` tables & indexes).
   - Import `/deploy/mysql/migrations/002_seed_modules_and_roles.sql` (seeds the 13 modules, 14 RBAC roles, and permissions matrix).
   - Verify `schema_migrations` contains versions `001` and `002`.

### Step 3.3: Build Frontend & Upload Files Safely
1. Locally, compile the production SPA + PWA bundle:
   ```bash
   npm install
   npm run build
   ```
2. Organize your cPanel directory structure so secrets and uploaded documents remain **outside `public_html/`**:
   ```text
   /home/<cpanel_user>/
   ├── cbms/
   │   ├── .env                          # Environment secrets (chmod 600)
   │   ├── config/config.php             # From deploy/php-api/config/config.php
   │   ├── cron/run_scheduled_tasks.php  # From deploy/php-api/cron/run_scheduled_tasks.php
   │   └── storage/
   │       ├── .htaccess                 # From deploy/php-api/storage/.htaccess
   │       ├── uploads/                  # chmod 750
   │       └── backups/                  # chmod 750
   └── public_html/                      # Webroot (or subdomain document root)
       ├── .htaccess                     # From deploy/php-api/public/.htaccess
       ├── index.html                    # From dist/index.html
       ├── manifest.webmanifest          # From dist/manifest.webmanifest
       ├── sw.js                         # From dist/sw.js
       ├── assets/                       # From dist/assets/
       ├── src/assets/                   # From dist/src/assets/
       └── api/
           └── index.php                 # From deploy/php-api/public/index.php
   ```
3. In `public_html/api/index.php`, confirm `require_once` points to `/home/<cpanel_user>/cbms/config/config.php` (adjust relative path if your document root is a subdirectory or subdomain):
   ```php
   require_once '/home/<cpanel_user>/cbms/config/config.php';
   ```
4. Set file permissions via cPanel File Manager or SSH:
   - `/home/<cpanel_user>/cbms/.env` -> `0600`
   - `/home/<cpanel_user>/cbms/storage/uploads` -> `0750`
   - `/home/<cpanel_user>/cbms/storage/backups` -> `0750`

### Step 3.4: Configure `.env` for Shared Hosting
Create `/home/<cpanel_user>/cbms/.env`:
```ini
APP_URL="https://yourdomain.com"
APP_NAME="BuildCore CBMS"
DB_HOST="localhost"
DB_PORT="3306"
DB_NAME="cpaneluser_cbms"
DB_USER="cpaneluser_cbmsuser"
DB_PASSWORD="REPLACE_WITH_STRONG_PASSWORD"
STORAGE_PATH="/home/<cpanel_user>/cbms/storage/uploads"
SESSION_TTL_HOURS=24
```

### Step 3.5: Configure cPanel Cron Jobs
In cPanel -> **Cron Jobs**, add a recurring job every 15 minutes (`*/15 * * * *`):
```bash
/usr/local/bin/php /home/<cpanel_user>/cbms/cron/run_scheduled_tasks.php >/dev/null 2>&1
```
Add a daily automated MySQL backup job at 02:00 AM (`0 2 * * *`):
```bash
mysqldump --single-transaction --no-tablespaces -u cpaneluser_cbmsuser -p'REPLACE_WITH_STRONG_PASSWORD' cpaneluser_cbms | gzip > /home/<cpanel_user>/cbms/storage/backups/cbms-$(date +\%F).sql.gz
```
*(Consider moving credentials into `~/.my.cnf` with `chmod 600` instead of inline `-p` flags.)*

### Step 3.6: Verify Shared Hosting Deployment
1. Visit `https://yourdomain.com/api/health` -> verify HTTP `200` and `"status": "ok"`.
2. Visit `https://yourdomain.com/` -> claim your first-run System Administrator account.
3. Visit `https://yourdomain.com/client-portal` -> verify SPA fallback works via `.htaccess`.
4. Verify `/storage/` and `/.env` return HTTP `403 Forbidden`.

---

## 4. Self-Hosted VPS / Dedicated Server Deployment (Ubuntu/Debian)

For full real-time WebSocket (`/ws`) collaboration, native Excel `.xlsx` import, and SQLite WAL or MySQL performance, deploy the Node.js application behind Nginx + TLS.

### Step 4.1: Provision Server Dependencies
```bash
sudo apt update && sudo apt install -y curl git nginx certbot python3-certbot-nginx build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### Step 4.2: Deploy Code & Build
```bash
sudo mkdir -p /opt/cbms/storage/uploads /opt/cbms/storage/backups
sudo chown -R www-data:www-data /opt/cbms
# Copy repository files to /opt/cbms, then:
cd /opt/cbms
sudo -u www-data npm ci
sudo -u www-data npm run build
```

### Step 4.3: Configure `.env` & Systemd Service
1. Create `/opt/cbms/.env` from `.env.example` with `NODE_ENV=production`, `PORT=3000`, `APP_URL=https://cbms.example.com`, and a generated `SESSION_SECRET`. Set `chmod 600 /opt/cbms/.env`.
2. Install the systemd unit from `/deploy/self-hosted/cbms.service`:
   ```bash
   sudo cp /opt/cbms/deploy/self-hosted/cbms.service /etc/systemd/system/cbms.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now cbms
   sudo systemctl status cbms
   ```

### Step 4.4: Configure Nginx Reverse Proxy & SSL
1. Copy `/opt/cbms/deploy/self-hosted/nginx.conf` to `/etc/nginx/sites-available/cbms`.
2. Replace `cbms.example.com` with your domain.
3. Obtain TLS certificates via Let's Encrypt:
   ```bash
   sudo ln -s /etc/nginx/sites-available/cbms /etc/nginx/sites-enabled/
   sudo certbot --nginx -d cbms.example.com
   sudo nginx -t && sudo systemctl reload nginx
   ```

---

## 5. Backup, Restore & Disaster Recovery

### SQLite (Local / Self-Hosted)
- **Live Backup (WAL-safe):**
  - Inside the app: **Admin & Maintenance -> Download JSON Backup**, OR via CLI:
    ```bash
    sqlite3 /opt/cbms/storage/cbms.db ".backup '/opt/cbms/storage/backups/cbms-$(date +%F).db'"
    ```
  - Also archive `/opt/cbms/storage/uploads/` alongside database backups.
- **Restore:**
  ```bash
  sudo systemctl stop cbms
  cp /opt/cbms/storage/backups/cbms-YYYY-MM-DD.db /opt/cbms/storage/cbms.db
  sudo systemctl start cbms
  ```

### MySQL (Shared Hosting / Self-Hosted)
- **Restore:**
  ```bash
  gunzip < /home/<cpanel_user>/cbms/storage/backups/cbms-YYYY-MM-DD.sql.gz | mysql -u <db_user> -p <db_name>
  ```
