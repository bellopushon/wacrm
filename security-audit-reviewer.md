## Review
- Verdict: proceed-with-caution

- Correct:
  - No project-owned install/lifecycle hooks in the root manifest; `scripts` only contain normal app/dev tasks (`package.json:30-39`).
  - Webhook POSTs are fail-closed and HMAC-verified with `META_APP_SECRET` before processing (`src/lib/whatsapp/webhook-signature.ts:21-46`, `src/app/api/whatsapp/webhook/route.ts:165-176`).
  - Sensitive WhatsApp tokens are encrypted server-side with AES-256-GCM, not stored plaintext (`src/lib/whatsapp/encryption.ts:29-48`).
  - Service-role usage appears server-only; it is instantiated in API/server helpers, not client code (`src/app/api/whatsapp/config/route.ts:34-48`, `src/app/api/whatsapp/webhook/route.ts:15-25`).
  - Supabase schema enables RLS and account/member-scoped policies broadly (`supabase/migrations/001_initial_schema.sql:25-31`, `supabase/migrations/017_account_sharing.sql:336-374`).
  - Invitation peek RPC revokes `PUBLIC` and grants only `anon, authenticated`, with limited returned fields (`supabase/migrations/019_invitation_rpcs.sql:43-89`).
  - Static grep found no uses of `child_process`, `exec*`, `spawn*`, `eval`, `new Function`, or dynamic remote `import()` in tracked source.

- Blocker:
  - No obvious malware, secret-harvesting, destructive filesystem logic, or remote-code-loading pattern was found in the repository itself.

- Note:
  - Dependency install scripts do exist in the lockfile, so `npm ci`/`npm install` will execute third-party install-time code unless scripts are disabled. Examples: `fsevents` (`package-lock.json:6315-6324`), `msw` (`package-lock.json:8146-8153`), `sharp` (`package-lock.json:9761-9768`), `unrs-resolver` via `napi-postinstall` (`package-lock.json:10731-10739`). I did not find non-registry package sources in `package-lock.json`, but install-time scripts still warrant sandboxing.
  - The automation engine intentionally supports arbitrary outbound webhooks: validation only restricts scheme to `http/https` (`src/lib/automations/validate.ts:118-133`), and runtime posts directly to the configured URL with optional custom headers (`src/lib/automations/engine.ts:493-503`). This is product behavior, not malware, but it is an SSRF/exfiltration surface if untrusted users can configure automations or if the app can reach sensitive internal hosts.
  - The WhatsApp media proxy performs outbound fetches to Meta-hosted URLs returned by the API and streams bytes back to the caller (`src/app/api/whatsapp/media/[mediaId]/route.ts:67-81`, `src/lib/whatsapp/meta-api.ts:913-950`). This looks expected and scoped to Meta responses, not arbitrary user URLs.
  - CSP is present but only report-only, and it allows `'unsafe-inline'` and `'unsafe-eval'` (`next.config.ts:32-39`). That is a runtime hardening caution, not a local-run blocker.
  - Invite-link generation is safest when pinned with `NEXT_PUBLIC_SITE_URL`; otherwise request headers influence the published origin, with `ALLOWED_INVITE_HOSTS` as defense-in-depth (`src/app/api/account/invitations/route.ts:94-135`, `.env.local.example:30-37`, `.env.local.example:43-66`).
  - The two cron endpoints are inconsistent: flows uses constant-time secret comparison (`src/app/api/flows/cron/route.ts:34-45`), while automations uses plain string equality (`src/app/api/automations/cron/route.ts:22-24`). Minor issue, but worth noting.
  - For local/dev safety, the repo already supports dry-run template submission via `WHATSAPP_TEMPLATES_DRY_RUN=true` (`src/app/api/whatsapp/templates/submit/route.ts:142-151`, `.env.local.example:81-85`).

- Recommended sandbox / env before running:
  - First install/run in a disposable VM/container or otherwise sandboxed user account.
  - Prefer an initial dependency install with scripts disabled for inspection (`npm ci --ignore-scripts`), then a normal install only if acceptable.
  - Use a throwaway Supabase project; never reuse a production `SUPABASE_SERVICE_ROLE_KEY` locally (`.env.local.example:9-24`).
  - Set `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to avoid request-header-derived invite origins (`.env.local.example:30-37`).
  - Set a fresh random `ENCRYPTION_KEY`; use test/dummy values for `META_APP_SECRET`; leave `AUTOMATION_CRON_SECRET` unset unless you are explicitly testing cron (`.env.local.example:14-24`, `.env.local.example:68-73`).
  - Set `WHATSAPP_TEMPLATES_DRY_RUN=true` for local UI testing without real Meta side effects (`.env.local.example:81-85`).
  - Do not configure live WhatsApp/Meta credentials until you are ready for real outbound API traffic (`src/lib/whatsapp/meta-api.ts:12-13`).
  - If you test automations, avoid or egress-filter the `send_webhook` step unless you trust the target URL.

Conclusion: the repository looks reasonably safe to inspect/install locally, but not “blindly safe.” The main reasons for caution are normal supply-chain install scripts in dependencies and intentional outbound integrations/webhook features that should be run with test credentials and network sandboxing first.
