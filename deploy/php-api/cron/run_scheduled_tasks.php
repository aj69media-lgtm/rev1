<?php
declare(strict_types=1);
/**
 * BuildCore CBMS - cPanel Scheduled Maintenance & Cron Script
 * Recommended cPanel Cron Schedule: */15 * * * * /usr/local/bin/php /home/<cpanel_user>/cbms/cron/run_scheduled_tasks.php >/dev/null 2>&1
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI execution only.');
}

require_once dirname(__DIR__) . '/config/config.php';

$pdo = cbms_pdo();

// 1. Mark overdue active tasks
$overdueCount = $pdo->exec("
    UPDATE tasks
    SET status = 'overdue', updated_at = NOW()
    WHERE deadline < CURDATE()
      AND status IN ('pending', 'acknowledged', 'in_progress', 'for_review')
");

// 2. Purge expired user sessions
$expiredSessions = $pdo->exec("DELETE FROM sessions WHERE expires_at < NOW()");

// 3. Purge old sync events (> 7 days)
$prunedEvents = $pdo->exec("DELETE FROM sync_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)");

echo sprintf(
    "[%s] CBMS Cron completed: overdue_tasks=%d, purged_sessions=%d, pruned_sync_events=%d\n",
    gmdate('c'),
    (int)$overdueCount,
    (int)$expiredSessions,
    (int)$prunedEvents
);
