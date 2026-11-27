<?php
declare(strict_types=1);

/**
 * Stripe webhook helpers. Count only. No names, no customer ids, no emails.
 * The public file is {count, updated_at}. Null is unknown, not zero.
 */

function extropy_verify_stripe(string $payload, string $header, string $secret, int $now, int $tolerance = 300): bool
{
    if ($secret === '' || $header === '' || $payload === '') {
        return false;
    }
    $parts = [];
    foreach (explode(',', $header) as $item) {
        $bits = explode('=', trim($item), 2);
        if (count($bits) === 2) {
            $parts[$bits[0]][] = $bits[1];
        }
    }
    if (!isset($parts['t'][0]) || !ctype_digit($parts['t'][0])) {
        return false;
    }
    $timestamp = (int) $parts['t'][0];
    if (abs($now - $timestamp) > $tolerance) {
        return false;
    }
    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($parts['v1'] ?? [] as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}

/**
 * @param array{seeded?:bool,count?:int|null,seen_event_ids?:array<int,string>} $state
 * @return array{status:int,public:?array{count:int,updated_at:string},state:array}
 */
function extropy_handle_webhook(string $payload, string $header, string $secret, int $now, array $state, string $updatedAt): array
{
    $state = extropy_normalize_state($state);
    if (!extropy_verify_stripe($payload, $header, $secret, $now)) {
        return ['status' => 400, 'public' => null, 'state' => $state];
    }
    $event = json_decode($payload, true);
    if (!is_array($event) || !isset($event['type']) || !is_string($event['type'])) {
        return ['status' => 400, 'public' => null, 'state' => $state];
    }
    if ($event['type'] !== 'customer.subscription.created') {
        return ['status' => 200, 'public' => null, 'state' => $state];
    }
    $eventId = isset($event['id']) && is_string($event['id']) ? $event['id'] : '';
    if ($eventId === '') {
        return ['status' => 400, 'public' => null, 'state' => $state];
    }
    if (in_array($eventId, $state['seen_event_ids'], true)) {
        return ['status' => 200, 'public' => null, 'state' => $state];
    }
    if ($state['seeded'] !== true || !is_int($state['count'])) {
        return ['status' => 500, 'public' => null, 'state' => $state];
    }
    $state['count'] += 1;
    $state['seen_event_ids'][] = $eventId;
    if (count($state['seen_event_ids']) > 5000) {
        $state['seen_event_ids'] = array_slice($state['seen_event_ids'], -5000);
    }
    return [
        'status' => 200,
        'public' => ['count' => $state['count'], 'updated_at' => $updatedAt],
        'state' => $state,
    ];
}

/** @param array<string,mixed> $state */
function extropy_normalize_state(array $state): array
{
    $count = $state['count'] ?? null;
    $seen = $state['seen_event_ids'] ?? [];
    if (!is_array($seen)) {
        $seen = [];
    }
    $ids = [];
    foreach ($seen as $id) {
        if (is_string($id) && $id !== '') {
            $ids[] = $id;
        }
    }
    return [
        'seeded' => ($state['seeded'] ?? false) === true,
        'count' => is_int($count) ? $count : null,
        'seen_event_ids' => $ids,
    ];
}

function extropy_find_private_dir(string $webhookDir): ?string
{
    $candidates = [];
    $fromEnv = getenv('EXTROPY_PRIVATE_DIR');
    if (is_string($fromEnv) && $fromEnv !== '') {
        $candidates[] = $fromEnv;
    }
    $home = dirname($webhookDir, 2);
    $candidates[] = $home . '/extropy-private';
    $candidates[] = $home . '/private';
    foreach ($candidates as $dir) {
        if (is_dir($dir)) {
            return $dir;
        }
    }
    return null;
}
