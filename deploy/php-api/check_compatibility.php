<?php
declare(strict_types=1);
/**
 * BuildCore CBMS - Shared Hosting (GoDaddy cPanel) Compatibility Checker
 * Run via CLI (`php check_compatibility.php`) or upload temporarily outside production.
 */

header('Content-Type: application/json; charset=utf-8');

$requiredExtensions = ['pdo', 'pdo_mysql', 'json', 'mbstring', 'openssl', 'fileinfo', 'zip'];
$optionalExtensions = ['gd', 'imagick', 'intl'];

$checks = [
    'php_version' => [
        'current' => PHP_VERSION,
        'minimum' => '8.2.0',
        'ok' => version_compare(PHP_VERSION, '8.2.0', '>='),
    ],
    'extensions' => [],
    'optional_extensions' => [],
    'storage_writable' => is_writable(dirname(__DIR__) . '/storage') || @mkdir(dirname(__DIR__) . '/storage/uploads', 0750, true),
];

foreach ($requiredExtensions as $ext) {
    $checks['extensions'][$ext] = extension_loaded($ext);
}
foreach ($optionalExtensions as $ext) {
    $checks['optional_extensions'][$ext] = extension_loaded($ext);
}

$allOk = $checks['php_version']['ok']
    && !in_array(false, $checks['extensions'], true)
    && $checks['storage_writable'];

echo json_encode([
    'compatible' => $allOk,
    'checks' => $checks,
    'timestamp' => gmdate('c'),
], JSON_PRETTY_PRINT);
