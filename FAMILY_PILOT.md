# HomeFlow Family Pilot

This guide is for running HomeFlow as a small family service on a single
computer that everyone in the household connects to from their own phone or
laptop. The phone does not run HomeFlow. It opens the page the computer is
already serving. Keys and the log stay on that computer. It implements the
v3.5 identity rule:

  The node mints a W3C `did:key` at first boot. No Google Auth, no KYC,
  no registrar. The browser wizard can mint that key after a session opens.
  Pasting a `did:key` opens a session. It does not prove the browser holds
  the key. Each subsequent action is signed by the user's local Ed25519 key
  and appended to their per user signed local log (PSLL). Lose the key
  without a backup and you start over.

## What you will set up

1. The HomeFlow service, listening on port 4001 and serving the UI
2. A Postgres + Redis pair only if you opt out of the file-backed store
3. Network access from the rest of the family's devices

There is no Google OAuth client. `/auth/google` returns 410.

## 1. Find your LAN IP

On macOS or Linux:

```
ip route get 1.1.1.1 | awk '{print $7; exit}'
```

On Windows PowerShell:

```
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress
```

Pick the address on the same Wi Fi as the rest of the family.

## 2. Configure environment variables

Copy `.env.example` to `.env` at the repo root and fill in:

```
PORT=4001
BASE_URL=http://<your-lan-ip>:4001
SESSION_SECRET=<long random string>
HOMEFLOW_DATA_DIR=./.data
# DATABASE_URL=postgresql://extropy:extropy_dev@localhost:5432/extropy_engine?schema=homeflow
```

`SESSION_SECRET` should be 32 plus random bytes. `openssl rand -hex 32` works.

Do not set a Google client id. `/auth/google` returns 410.

### Storage: file-backed by default, Postgres optional

By default, **`DATABASE_URL` is optional**. When it is unset or empty, HomeFlow
runs against a file-backed JSON store. The service writes a single JSON file
at `$HOMEFLOW_DATA_DIR/homeflow.json` (defaults to `/var/lib/homeflow` on the
VPS or `./.data` in dev). This is the right default for the family pilot
because the canonical truth lives on each user's device per spec section 3,
so the server only needs to remember registered DIDs, public keys, and PSLL
hash-chain anchors. A JSON file fits those needs without provisioning a DB.

To graduate to Postgres later, set `DATABASE_URL` to a real connection string
(or rerun `deploy-homeflow.sh` with `ENABLE_POSTGRES=1`). The Postgres code
path is intact behind the runtime branch in `src/index.ts`.

## 3. Start the service

In dev mode (file-backed store, no extra services needed):

```
pnpm install
pnpm --filter @extropy/contracts run build
pnpm --filter @extropy/identity run build
pnpm --filter @extropy/homeflow run dev
```

The service serves the frontend, the auth routes, and the API on the same
port (default 4001). You should see:

```
[homeflow] Listening on port 4001
[homeflow] Web: http://localhost:4001/
```

## 4. Family members open a session

Open `http://<your-lan-ip>:4001` on a phone or laptop. The first screen asks
for a `did:key`. Pasting one calls `POST /auth/session`. It opens a session.
It does not prove this browser holds the key. There is no Google sign-in.

If the DID has not been onboarded on this browser, the wizard:

1. Generates an Ed25519 keypair using WebCrypto
2. Stores the private key in IndexedDB on that device. The server never sees it
3. Derives a W3C `did:key` and registers the public key with the server
4. The server anchors a Genesis vertex
5. The user lands on the dashboard with a header chip showing their DID

Lose that key without a backup and you start over. There is no registrar.

From that point, key actions like creating a household are signed locally
with the user's private key and appended to their PSLL. The "My PSLL" tab in
the sidebar shows the current chain.

## 5. Optional: Tailscale or Cloudflare Tunnel

If your family is not all on the same LAN, two simple options:

- **Tailscale:** install the Tailscale client on Randall's machine and on
  every family member's device. They'll all share a private mesh. Use the
  Tailscale IP or Magic DNS name as `BASE_URL`.

- **Cloudflare Tunnel:** `cloudflared tunnel --url http://localhost:4001`
  prints a public hostname. Set `BASE_URL` to that hostname. Note: the free tier
  rotates the hostname on every restart, prefer Tailscale for a stable
  setup.

## 6. Reset / development tips

- To wipe a family member's local keys, in their browser open DevTools,
  Application, IndexedDB, delete the `homeflow-identity` database. They will
  be prompted to onboard again on next visit, which generates a fresh DID.
- To wipe server state, drop the Postgres `extropy_engine` database or just
  truncate `hf_users` and `hf_psll_entries`. The schemas re-create on boot.
- The logout button is in the user chip in the top right of the dashboard.

## Installing as a home screen app

HomeFlow ships as a Progressive Web App. After signing in once, each family
member can pin it to their home screen and launch it fullscreen, no browser
chrome.

- **iOS Safari (iPhone):** open the HomeFlow URL in Safari, tap the Share
  button, scroll to "Add to Home Screen", confirm. The icon shows up on the
  home screen and opens HomeFlow fullscreen.
- **iPadOS Safari:** same flow as iOS, Share then "Add to Home Screen".
- **Android Chrome:** open the URL, tap the three-dot menu, pick "Install
  app" if it appears, otherwise "Add to Home screen".
- **Desktop Chrome / Edge:** click the install icon in the address bar
  (looks like a small monitor with a down arrow), or use the three-dot menu,
  "Install HomeFlow".

The icon is a teal "HF" on the cyberpunk dark background. Treat it as a
placeholder, the design can be swapped later without touching the install
flow.

## PWA limitations on plain LAN

The full PWA experience, offline shell caching plus the install prompt on
Android and desktop Chrome, requires HTTPS. Browsers will only register a
service worker on `https://...` or `http://localhost`. Plain LAN URLs like
`http://192.168.x.x:4001` skip service worker registration silently.

What that means in practice:

- From the host machine itself, opening `http://localhost:4001` gives the
  full PWA, install prompts, and offline cache.
- From other devices on the LAN over plain HTTP, "Add to Home Screen" still
  works on iOS Safari and creates a fullscreen icon, but it falls back to a
  bookmarked web view, no offline cache.

**Recommended fix: Tailscale.** Install Tailscale on the host plus each
family device. Tailscale gives every machine a stable `*.ts.net` hostname
with a real HTTPS certificate, no manual cert wrangling. Set `BASE_URL` to
the Tailscale hostname as `BASE_URL`, and every family device gets the full PWA experience with
offline caching and proper install prompts.

Self signed certs on the LAN are not recommended, that path leads to a
maze of trust prompts that family members will not accept. Tailscale or
Cloudflare Tunnel are the two clean options.

## Season events from the temporal service

A second systemd unit named `temporal` runs alongside `homeflow` on the
VPS. It implements the Universal Times spec
(see `docs/universaltimes-reference.html`) and posts callbacks to
HomeFlow's `/temporal/event` endpoint whenever a unit transition occurs.
HomeFlow registers for the Season unit at startup. Once both services
are running, season events fire automatically without manual wiring.

If the temporal service is offline at HomeFlow boot, HomeFlow logs a
clear warning and retries every 60s. HomeFlow never crashes because of
a missing temporal service.

To verify after a redeploy:

```bash
systemctl status temporal
curl -s http://127.0.0.1:4002/now | head -20
```

## What is NOT in this pilot

By design the family pilot stops short of:

- KYC of any kind. Identity is the node-minted `did:key`. Standing costs work
- ZK nullifier proofs at the API gateway (the primitives exist in the
  identity package, wiring them up is a follow up PR)
- Multi node DAG sync (single server sandbox per spec section 2)
- Production hardening: rate limiting, CSRF tokens, secret rotation

Those are tracked as follow up work once the family has used the pilot for
a while and we know which rough edges actually matter.
