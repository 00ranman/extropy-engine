<?php
declare(strict_types=1);

require_once __DIR__ . '/webhook.lib.php';
require_once dirname(__DIR__) . '/public/badge.php';

$failed = 0;

function check(bool $ok, string $message): void
{
    global $failed;
    if ($ok) {
        echo "ok  {$message}\n";
        return;
    }
    $failed++;
    echo "FAIL {$message}\n";
}

function signed(string $payload, string $secret, int $t): string
{
    $sig = hash_hmac('sha256', $t . '.' . $payload, $secret);
    return "t={$t},v1={$sig}";
}

$syntaxFiles = [
    __DIR__ . '/webhook.lib.php',
    dirname(__DIR__) . '/public/badge.php',
    dirname(__DIR__) . '/public/stripe/webhook.php',
    __DIR__ . '/config.example.php',
];
foreach ($syntaxFiles as $file) {
    $out = [];
    $code = 0;
    exec('php -l ' . escapeshellarg($file), $out, $code);
    check($code === 0, 'syntax ' . basename($file));
}

$secret = 'whsec_test_secret';
$now = 1700000000;
$payload = json_encode([
    'id' => 'evt_1',
    'type' => 'customer.subscription.created',
    'data' => ['object' => ['id' => 'sub_1', 'customer' => 'cus_do_not_publish']],
], JSON_UNESCAPED_SLASHES);
if (!is_string($payload)) {
    fwrite(STDERR, "payload encode failed\n");
    exit(1);
}

$blank = ['seeded' => false, 'count' => null, 'seen_event_ids' => []];
$bad = extropy_handle_webhook($payload, 't=1,v1=nope', $secret, $now, $blank, '2026-11-27T00:00:00+00:00');
check($bad['status'] === 400 && $bad['public'] === null, 'bad signature is rejected');
check($bad['state']['count'] === null, 'bad signature does not invent a count');

$old = extropy_handle_webhook($payload, signed($payload, $secret, $now - 1000), $secret, $now, $blank, '2026-11-27T00:00:00+00:00');
check($old['status'] === 400, 'stale timestamp is rejected');

$unseeded = extropy_handle_webhook($payload, signed($payload, $secret, $now), $secret, $now, $blank, '2026-11-27T00:00:00+00:00');
check($unseeded['status'] === 500, 'unseeded count is not incremented');
check($unseeded['state']['seen_event_ids'] === [], 'unseeded event is not consumed');
check($unseeded['public'] === null, 'unseeded webhook writes no public count');

$seeded = ['seeded' => true, 'count' => 4, 'seen_event_ids' => []];
$applied = extropy_handle_webhook($payload, signed($payload, $secret, $now), $secret, $now, $seeded, '2026-11-27T00:00:00+00:00');
check($applied['status'] === 200, 'seeded subscription increments');
check($applied['public'] === ['count' => 5, 'updated_at' => '2026-11-27T00:00:00+00:00'], 'public file is count and time only');
$publicBlob = json_encode($applied['public']);
check(is_string($publicBlob) && !str_contains($publicBlob, 'cus_do_not_publish') && !str_contains($publicBlob, 'sub_1'), 'public file has no customer id');
check($applied['state']['count'] === 5, 'private count is 5');

$again = extropy_handle_webhook($payload, signed($payload, $secret, $now), $secret, $now, $applied['state'], '2026-11-27T00:00:01+00:00');
check($again['status'] === 200 && $again['public'] === null && $again['state']['count'] === 5, 'duplicate event does not count twice');

$invoice = json_encode(['id' => 'evt_2', 'type' => 'invoice.paid', 'data' => ['object' => ['customer_name' => 'Ada']]]);
if (!is_string($invoice)) {
    exit(1);
}
$ignored = extropy_handle_webhook($invoice, signed($invoice, $secret, $now), $secret, $now, $applied['state'], '2026-11-27T00:00:02+00:00');
check($ignored['status'] === 200 && $ignored['state']['count'] === 5 && $ignored['public'] === null, 'invoice.paid does not change the count');

$missingSecret = extropy_handle_webhook($payload, signed($payload, $secret, $now), '', $now, $seeded, '2026-11-27T00:00:00+00:00');
check($missingSecret['status'] === 400 && $missingSecret['state']['count'] === 4, 'missing secret does not increment');

check(extropy_badge_text(null) === 'Runs the Extropy Engine · supporters not counted yet of 10,000 · start your own pocket', 'null count is not zero on the badge');
check(extropy_badge_text(0) === 'Runs the Extropy Engine · supporters 0 of 10,000 · start your own pocket', 'a real zero is shown as zero');
check(str_contains(extropy_badge_svg(12), 'supporters 12 of 10,000'), 'badge shows a real count');
check(str_contains(extropy_badge_svg(12), 'https://extropyengine.com/dollar'), 'badge links to the dollar page');
check(!str_contains(extropy_badge_svg(null), "\u{2014}"), 'badge has no em dash');

$dir = sys_get_temp_dir() . '/extropy-badge-' . getmypid();
mkdir($dir);
file_put_contents($dir . '/supporters.json', json_encode(['count' => null, 'updated_at' => null]));
check(extropy_badge_count($dir . '/supporters.json') === null, 'json null count stays null');
file_put_contents($dir . '/supporters.json', json_encode(['count' => '4']));
check(extropy_badge_count($dir . '/supporters.json') === null, 'string count is not coerced');
file_put_contents($dir . '/supporters.json', json_encode(['count' => 4, 'name' => 'nope']));
check(extropy_badge_count($dir . '/supporters.json') === 4, 'integer count is read');
unlink($dir . '/supporters.json');
rmdir($dir);

exit($failed === 0 ? 0 : 1);
