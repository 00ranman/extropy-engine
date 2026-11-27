<?php
declare(strict_types=1);

/**
 * Copy to config.php in the private directory (not public_html).
 * Prefer the STRIPE_WEBHOOK_SECRET environment variable in hPanel.
 * If you paste the secret here instead, this file must stay outside the web root
 * and must never be committed.
 */
return [
    'webhook_secret' => getenv('STRIPE_WEBHOOK_SECRET') ?: '',
    // Absolute path of the public count file. Empty uses public_html/supporters.json.
    'supporters_path' => getenv('EXTROPY_SUPPORTERS_PATH') ?: '',
    // Absolute path of the private state file. Empty uses this directory's state.json.
    'state_path' => getenv('EXTROPY_STATE_PATH') ?: '',
];
