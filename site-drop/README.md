# Site drop

Randall uploads these files to the Hostinger account that already serves https://extropyengine.com. Nothing in this folder deploys itself.

These files sit next to the pages that are already there. Do not delete the existing site, and do not replace `public_html/.htaccess` with the badge snippet if that file already has rules. Merge the one rewrite rule into it.

GitHub Actions in this repo refresh `bet/` and the stats files and commit them. They do not upload to Hostinger. After an Action commit, upload the changed files again. That push needs Actions allowed to write to `main`. If branch protection blocks the bot, the feeds stay in the workflow log until that is opened up. Actions never post to X and they hold no X keys. A separate routine can read the JSON URLs below.

The dollar gates nothing. The public files say record / meter / till spark when they need a meter word.

## Public URLs

| File on the server | URL |
| --- | --- |
| `supporters.json` | https://extropyengine.com/supporters.json |
| `badge.php` via the rewrite | https://extropyengine.com/badge.svg |
| `pockets.json` | https://extropyengine.com/pockets.json |
| `record.json` | https://extropyengine.com/record.json |
| `stats.json` | https://extropyengine.com/stats.json |
| `stats/index.html` | https://extropyengine.com/stats/ |
| `bet/index.html` | https://extropyengine.com/bet/ |
| `bet/bet.json` | https://extropyengine.com/bet/bet.json |
| `stripe/webhook.php` | https://extropyengine.com/stripe/webhook.php |
| `r/<hash>/index.html` | https://extropyengine.com/r/<hash> |

Counts that are not known yet are `null` or the words "not counted yet". That is not zero. Zero appears only after a source was actually read and the number was zero.

## What to upload into the site root

The site root is the folder Hostinger already uses for extropyengine.com, usually `public_html`.

From `site-drop/public/`, upload these paths so they keep the same names:

- `supporters.json`
- `badge.php`
- `pockets.json`
- `record.json`
- `stats.json`
- `stats/index.html`
- `bet/index.html`
- `bet/bet.json`
- `stripe/webhook.php`
- `r/index.html`

Do not upload `badge.htaccess.snippet` as a replacement `.htaccess`. Open the existing `public_html/.htaccess` (create one if the site has none) and add:

```
RewriteEngine On
RewriteRule ^badge\.svg$ badge.php [L]
```

`badge.php` answers as `image/svg+xml` and sends `Cache-Control: public, max-age=600` (10 minutes). It links to https://extropyengine.com/dollar.

## What to upload outside the site root

In the home folder that contains `public_html`, create `extropy-private`. Upload:

- `site-drop/private/webhook.lib.php`
- `site-drop/private/config.example.php` (then copy it to `config.php` in that same folder)
- `site-drop/private/state.example.json` (then copy it to `state.json` in that same folder)

`config.php` and `state.json` stay out of git. The examples have no secret.

The webhook looks for `extropy-private` or `private` next to `public_html`. On this layout, `public_html/stripe/webhook.php` finds `/home/<account>/extropy-private/webhook.lib.php`.

You can set `EXTROPY_PRIVATE_DIR` to that folder instead if the account layout differs.

## Stripe

In the Stripe Dashboard:

1. Developers, Webhooks, Add endpoint.
2. Endpoint URL: `https://extropyengine.com/stripe/webhook.php`
3. Events to send: `customer.subscription.created` only. Do not add `invoice.paid`. A renewal is not a new person. The count is heads, in arrival order.
4. After you create the endpoint, open it and reveal the signing secret (`whsec_...`).

Put that secret in one of these places, never in the repo and never in `public_html`:

- hPanel environment variable `STRIPE_WEBHOOK_SECRET`, or
- `extropy-private/config.php` as `webhook_secret`.

The handler checks the signature, ignores every event except `customer.subscription.created`, and writes `supporters.json` as `{"count": N, "updated_at": "..."}`. No names. No customer ids. Retries of the same Stripe event id do not count twice.

## Seed the count before the webhook goes live

`state.json` ships with `"seeded": false` and `"count": null`. The webhook will not start from a guess. Until you seed it, a real signup gets HTTP 500 so Stripe retries later.

1. Open https://extropyengine.com/supporters and count the numbers on the wall yourself.
2. If you counted them, edit `extropy-private/state.json`. Set `seeded` to `true` and `count` to the integer you counted. Use an integer zero only when you looked and the wall was empty.
3. Leave `seeded` false and `count` null if you did not look. The webhook will not fill those in for you.

The public `supporters.json` updates on the next accepted signup. It is not a list of people.

## Receipt pages

`record.json` in this drop has no loops. `r/index.html` says that. Contested confirmations are not finished. A page under `/r/<hash>` is the happy-path class strip: class, entropy-reduction proxy, state, hashes. Envelope C is not on the page.

When a node has a real settled loop:

```bash
node packages/mesh/mesh.mjs record --out record.json
node scripts/feeds/render-receipts.mjs --record record.json --out site-drop/public/r
```

Upload `record.json` and each new `r/<hash>/` directory (`index.html`, `card.svg`, `card.png`). Do not upload a loop you did not actually settle. `ok_to_feature` defaults to false.

Ad-check loops (`class` `ad-check`) mint 0 for the poster. The verifier cannot be the poster or a party to the post. That rule is enforced in `packages/mesh`. The receipt page says contested confirmations are not finished, because they are not.

## Pockets

`pockets.json` starts with an empty `entries` list. A row is added only when an operator turns `ANNOUNCE_POCKET` on and types a town, then someone copies that entry into this file and re-uploads it. A GitHub fork is not a pocket. Forks are logged in the repo at `nodes/forks.json`, not here.

## After the Actions run

Re-upload whatever the Action changed:

- Bet board: `site-drop/public/bet/index.html` and `site-drop/public/bet/bet.json`
- Nightly stats: `site-drop/public/stats.json` and `site-drop/public/stats/index.html`

`stats-history.csv` stays in the git repo. It is the append-only ledger. It is not a Hostinger file.

The label workflow is also not a Hostinger file. It creates the `open-problem` label on GitHub. See `docs/OPEN_PROBLEM_LABEL.md`.
