# HomeFlow migration

## Auth: Google OAuth removed (2026-09-21)

Google Auth / `passport-google-oauth20` / `GOOGLE_CLIENT_*` are **removed**.
Protocol identity is the **DID minted by your own node**.

- Use `POST /auth/session` with `{ "did": "did:..." }`.
- `GET /auth/google` returns **410**.
- Drop env vars `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Lose the DID without a backup → start over.
