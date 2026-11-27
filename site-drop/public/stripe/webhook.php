<?php
declare(strict_types=1);

/**
 * Public Stripe endpoint. Secrets stay in the private directory, never here.
 * Upload this file to public_html/stripe/webhook.php.
 */

function extropy_locate_lib(string $webhookDir): string
{
    $candidates = [];
    $fromEnv = getenv('EXTROPY_PRIVATE_DIR');
    if (is_string($fromEnv) && $fromEnv !== '') {
        $candidates[] = rtrim($fromEnv, '/') . '/webhook.lib.php';
    }
    $home = dirname($webhookDir, 2);
    $candidates[] = $home . '/extropy-private/webhook.lib.php';
    $candidates[] = $home . '/private/webhook.lib.php';
    foreach ($candidates as $path) {
        if (is_file($path)) {
            return $path;
        }
    }
    return '';
}

$extropyLib = extropy_locate_lib(__DIR__);
if ($extropyLib === '') {
    if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'private directory is not set up']);
    }
    return;
}
require_once $extropyLib;

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    extropy_webhook_main(__DIR__);
}

function extropy_webhook_main(string $webhookDir): void
{
    $private = extropy_find_private_dir($webhookDir);
    if ($private === null) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'private directory is not set up']);
        return;
    }
    $configPath = $private . '/config.php';
    if (!is_file($configPath)) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'config.php missing']);
        return;
    }
    /** @var array<string,mixed> $config */
    $config = require $configPath;
    $secret = '';
    $envSecret = getenv('STRIPE_WEBHOOK_SECRET');
    if (is_string($envSecret) && $envSecret !== '') {
        $secret = $envSecret;
    } elseif (isset($config['webhook_secret']) && is_string($config['webhook_secret'])) {
        $secret = $config['webhook_secret'];
    }
    $publicRoot = dirname($webhookDir);
    $supportersPath = isset($config['supporters_path']) && is_string($config['supporters_path']) && $config['supporters_path'] !== ''
        ? $config['supporters_path']
        : $publicRoot . '/supporters.json';
    $statePath = isset($config['state_path']) && is_string($config['state_path']) && $config['state_path'] !== ''
        ? $config['state_path']
        : $private . '/state.json';

    $payload = file_get_contents('php://input');
    if ($payload === false) {
        $payload = '';
    }
    $header = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
    $state = ['seeded' => false, 'count' => null, 'seen_event_ids' => []];
    if (is_file($statePath)) {
        $decoded = json_decode((string) file_get_contents($statePath), true);
        if (is_array($decoded)) {
            $state = $decoded;
        }
    }
    $result = extropy_handle_webhook($payload, $header, $secret, time(), $state, gmdate('c'));
    if ($result['public'] !== null) {
        $encoded = json_encode($result['public'], JSON_UNESCAPED_SLASHES);
        if ($encoded === false) {
            http_response_code(500);
            return;
        }
        file_put_contents($statePath, json_encode($result['state'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n", LOCK_EX);
        file_put_contents($supportersPath, $encoded . "\n", LOCK_EX);
    }
    http_response_code($result['status']);
    header('Content-Type: application/json');
    echo json_encode(['ok' => $result['status'] === 200]);
}
