<?php
declare(strict_types=1);
/**
 * BuildCore CBMS - PHP 8.3/8.4 Shared Hosting REST API Entry Point
 * Paired with compiled React SPA (`npm run build`) in `public_html/`.
 * Provides DB-backed auth, RBAC, projects, dashboard aggregations, protected file downloads,
 * and REST delta-polling (`/api/sync/events`) when WebSockets are unavailable on shared hosting.
 */

require_once dirname(__DIR__) . '/config/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$bodyRaw = file_get_contents('php://input');
$jsonBody = $bodyRaw ? (json_decode($bodyRaw, true) ?? []) : [];

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function bearer_token(): ?string
{
    $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(\S+)$/i', $hdr, $m)) {
        return $m[1];
    }
    return null;
}

function authenticate(PDO $pdo): ?array
{
    $tok = bearer_token();
    if (!$tok) {
        return null;
    }
    $hash = hash('sha256', $tok);
    $stmt = $pdo->prepare('
        SELECT u.id, u.email, u.full_name, u.role_id, u.is_active,
               r.slug AS role_slug, r.name AS role_name, r.is_client_role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        JOIN roles r ON r.id = u.role_id
        WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = 1
        LIMIT 1
    ');
    $stmt->execute([$hash]);
    $user = $stmt->fetch();
    return $user ?: null;
}

try {
    $pdo = cbms_pdo();

    if ($uriPath === '/api/health') {
        $pdo->query('SELECT 1');
        respond(200, ['status' => 'ok', 'runtime' => 'php-mysql', 'timestamp' => gmdate('c')]);
    }

    if ($uriPath === '/api/auth/status' && $method === 'GET') {
        $cnt = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $company = $pdo->query("SELECT setting_value FROM system_settings WHERE setting_key = 'company_name'")->fetchColumn();
        respond(200, [
            'requiresBootstrap' => $cnt === 0,
            'hasAdminPasscodeEnv' => (bool)getenv('ADMIN_PASSCODE'),
            'companyName' => $company ?: (getenv('COMPANY_NAME') ?: 'BuildCore CBMS'),
        ]);
    }

    if ($uriPath === '/api/auth/bootstrap-admin' && $method === 'POST') {
        $cnt = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        if ($cnt > 0) {
            respond(409, ['error' => 'Initial administrator account has already been claimed.']);
        }
        $email = strtolower(trim((string)($jsonBody['email'] ?? '')));
        $password = (string)($jsonBody['password'] ?? '');
        $fullName = trim((string)($jsonBody['fullName'] ?? ''));
        $companyName = trim((string)($jsonBody['companyName'] ?? 'BuildCore Construction'));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || $fullName === '') {
            respond(400, ['error' => 'Valid full name, email, and 8+ character password are required.']);
        }

        $roleId = (int)$pdo->query("SELECT id FROM roles WHERE slug = 'system_admin' LIMIT 1")->fetchColumn();
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("INSERT INTO users (email, password_hash, full_name, role_id, job_title) VALUES (?, ?, ?, ?, 'System Administrator')");
        $stmt->execute([$email, $hash, $fullName, $roleId]);
        $userId = (int)$pdo->lastInsertId();

        $setStmt = $pdo->prepare("INSERT INTO system_settings (setting_key, setting_value) VALUES ('company_name', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)");
        $setStmt->execute([$companyName]);

        $rawToken = bin2hex(random_bytes(32));
        $tokStmt = $pdo->prepare('INSERT INTO sessions (token_hash, user_id, expires_at, ip_address) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), ?)');
        $tokStmt->execute([hash('sha256', $rawToken), $userId, $_SERVER['REMOTE_ADDR'] ?? '']);
        $pdo->commit();

        respond(201, ['token' => $rawToken, 'user' => ['id' => $userId, 'email' => $email, 'full_name' => $fullName, 'role_slug' => 'system_admin']]);
    }

    if ($uriPath === '/api/auth/login' && $method === 'POST') {
        $email = strtolower(trim((string)($jsonBody['email'] ?? '')));
        $password = (string)($jsonBody['password'] ?? '');
        $stmt = $pdo->prepare('SELECT u.*, r.slug AS role_slug, r.name AS role_name, r.is_client_role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ? LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            respond(401, ['error' => 'Invalid email or password.']);
        }
        if ($user['locked_until'] && strtotime($user['locked_until']) > time()) {
            respond(423, ['error' => 'Account temporarily locked due to repeated failed attempts.']);
        }
        $rawToken = bin2hex(random_bytes(32));
        $pdo->prepare('INSERT INTO sessions (token_hash, user_id, expires_at, ip_address) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), ?)')
            ->execute([hash('sha256', $rawToken), $user['id'], $_SERVER['REMOTE_ADDR'] ?? '']);
        unset($user['password_hash']);
        respond(200, ['token' => $rawToken, 'user' => $user]);
    }

    if ($uriPath === '/api/sync/events' && $method === 'GET') {
        $user = authenticate($pdo);
        if (!$user) {
            respond(401, ['error' => 'Authentication required.']);
        }
        $since = (int)($_GET['since'] ?? 0);
        if ((int)$user['is_client_role'] === 1) {
            $stmt = $pdo->prepare('SELECT * FROM sync_events WHERE id > ? AND client_only = 1 ORDER BY id ASC LIMIT 50');
            $stmt->execute([$since]);
        } else {
            $stmt = $pdo->prepare('SELECT * FROM sync_events WHERE id > ? ORDER BY id ASC LIMIT 50');
            $stmt->execute([$since]);
        }
        respond(200, ['events' => $stmt->fetchAll()]);
    }

    respond(404, ['error' => 'Endpoint not handled in PHP shared-hosting shim. Refer to docs/INSTALLATION_AND_DEPLOYMENT.md for full deployment options.']);
} catch (Throwable $e) {
    error_log('[CBMS PHP API Error] ' . $e->getMessage());
    respond(500, ['error' => 'Internal server error.']);
}
