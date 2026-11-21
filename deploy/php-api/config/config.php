<?php
declare(strict_types=1);
/**
 * BuildCore CBMS - PHP 8.3/8.4 Configuration & PDO MySQL Connection
 * Place `.env` outside `public_html` (e.g., `/home/<cpanel_user>/cbms/.env`).
 */

function cbms_load_env(string $envPath): void
{
    if (!is_file($envPath)) {
        return;
    }
    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!$lines) {
        return;
    }
    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }
        $pos = strpos($trimmed, '=');
        if ($pos === false) {
            continue;
        }
        $key = trim(substr($trimmed, 0, $pos));
        $val = trim(substr($trimmed, $pos + 1));
        if ((str_starts_with($val, '"') && str_ends_with($val, '"')) ||
            (str_starts_with($val, "'") && str_ends_with($val, "'"))) {
            $val = substr($val, 1, -1);
        }
        if (getenv($key) === false) {
            putenv("$key=$val");
            $_ENV[$key] = $val;
        }
    }
}

$baseDir = dirname(__DIR__);
cbms_load_env($baseDir . '/.env');

function cbms_pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '3306';
    $db   = getenv('DB_NAME') ?: (getenv('DB_DATABASE') ?: 'cbms_prod');
    $user = getenv('DB_USER') ?: (getenv('DB_USERNAME') ?: '');
    $pass = getenv('DB_PASSWORD') ?: '';

    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $db);
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function cbms_storage_dir(): string
{
    $custom = getenv('STORAGE_PATH') ?: getenv('STORAGE_DIR');
    if ($custom && is_dir($custom)) {
        return rtrim($custom, '/');
    }
    $dir = dirname(__DIR__) . '/storage/uploads';
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }
    return $dir;
}
