# HomeFlow Family Pilot

This guide is for running HomeFlow as a small family service on a single
computer that everyone in the household connects to from their own phone or
laptop. It implements the canonical v3.1 identity flow from spec section 8.2:

  Google OAuth, real `did:extropy` keypair generated in the browser, a
  Verifiable Credential, and a Genesis vertex anchored on the DAG. Each
  subsequent action is signed by the user's local Ed25519 key and appended
  to their per user signed local log (PSLL).

## What you will set up

1. A Google OAuth client so each family member can sign in with their Gmail
2. A Postgres + Redis pair (already provided by the repo's `docker compose`)
3. The HomeFlow service, listening on port 4001 and serving the cyberpunk UI
4. Network access from the rest of the family's devices

## 1. Create a Google OAuth client

Go to https://console.cloud.google.com, create a project, then OAuth consent
screen, then Credentials, then Create Credentials, OAuth client ID, type
"Web application".

Authorized JavaScript origins:

```
http://localhost:4001
http://<your-lan-ip>:4001
```

If you also expose this through Tailscale or Cloudflare Tunnel, add those
host names too. The Tailscale Magic DNS host name works as well.

Authorized redirect URIs:

```
http://localhost:4001/auth/google/callback
http://<your-lan-ip>:4001/auth/google/callback
```

Copy the Client ID and Client Secret into the env file in step 3.

## 2. Find your LAN IP

On macOS or Linux:

```
ip route get 1.1.1.1 | awk '{print $7; exit}'
```

On Windows PowerShell:

```
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }).IPAddress
```

Pick the address on the same Wi Fi as the rest of the family.

## 3. Configure environment variables

Copy `.env.example` to `.env` at the repo root and fill in:

```
PORT=4001
BASE_URL=http://<your-lan-ip>:4001
SESSION_SECRET=<long random string>
DATABASE_URL=postgresql://extropy:extropy_dev@localhost:5432/extropy_engine?schema=homeflow
REDIS_URL=redis://localhost:6379
DAG_SUBSTRATE_URL=http://localhost:4011
GOOGLE_CLIENT_ID=<from step 1>
GOOGLE_CLIENT_SECRET=<from step 1>
```

`SESSION_SECRET` should be 32 plus random bytes. `openssl rand -hex 32` works.

Without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` the `/auth/google` route
returns 503 with a hint, the rest of the API still runs so you can poke at it.

## 4. Start the service

In one terminal, bring up Postgres and Redis:

```
docker compose up postgres redis
```

In another, start HomeFlow in dev mode:

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

## 5. Family members sign in

Open `http://<your-lan-ip>:4001` on a phone or laptop. The first screen is
"Sign in with Google". After consent, the onboarding wizard:

1. Generates an Ed25519 keypair using WebCrypto
2. Stores the private key in IndexedDB on that device, the server never sees it
3. Posts the public key plus the canonical `did:extropy:<hex>` to the server
4. The server issues a self issued Onboarding VC and anchors a Genesis vertex
5. The user lands on the dashboard with a header chip showing their DID

From that point, key actions like creating a household are signed locally
with the user's private key and appended to their PSLL. The "My PSLL" tab in
the sidebar shows the current chain.

## 6. Optional: Tailscale or Cloudflare Tunnel

If your family is not all on the same LAN, two simple options:

- **Tailscale:** install the Tailscale client on Randall's machine and on
  every family member's device. They'll all share a private mesh. Use the
  Tailscale IP or Magic DNS name as `BASE_URL` and add it to the OAuth
  authorized origins and redirect URIs.

- **Cloudflare Tunnel:** `cloudflared tunnel --url http://localhost:4001`
  prints a public hostname. Add that hostname to the OAuth authorized
  origins and redirect URIs, then update `BASE_URL`. Note: the free tier
  rotates the hostname on every restart, prefer Tailscale for a stable
  setup.

## 7. Reset / development tips

- To wipe a family member's local keys, in their browser open DevTools,
  Application, IndexedDB, delete the `homeflow-identity` database. They will
  be prompted to onboard again on next visit, which generates a fresh DID.
- To wipe server state, drop the Postgres `extropy_engine` database or just
  truncate `hf_users` and `hf_psll_entries`. The schemas re-create on boot.
- The logout button is in the user chip in the top right of the dashboard.

## What is NOT in this pilot

By design the family pilot stops short of:

- On device KYC (we trust Google as a proof of personhood proxy)
- ZK nullifier proofs at the API gateway (the primitives exist in the
  identity package, wiring them up is a follow up PR)
- Multi node DAG sync (single server sandbox per spec section 2)
- Production hardening: rate limiting, CSRF tokens, secret rotation

Those are tracked as follow up work once the family has used the pilot for
a while and we know which rough edges actually matter.
