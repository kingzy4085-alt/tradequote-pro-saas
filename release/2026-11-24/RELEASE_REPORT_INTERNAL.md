# Internal Release Report — Production Hardening Baseline

## Verdict

**GO** for the currently deployed Production baseline, subject to the follow-ups listed below.

## Validation completed

- Full automated regression: **2,438 / 2,438 tests passed** across **60 / 60 test files**.
- Production Next.js build: passed.
- TypeScript validation: passed.
- Core sellable workflow suite: **375 / 375 tests passed**.
- Auth/password recovery suite: **95 / 95 tests passed**.
- Stripe/billing suite: **159 / 159 tests passed**.
- Active transactional email/automation suite: **347 / 347 tests passed**.
- Production smoke: health, public routes, authentication redirects, API protection and recent runtime logs passed.

## Production database hardening

Production compatibility migrations were deployed and migration history was aligned through `20261124070500`.

Key hardening covered:

- Job Costing rollup compatibility.
- UUID estimate → proposal conversion.
- UUID proposal → project conversion.
- Estimate totals and approval helper chain.
- Document numbering.
- Portal compatibility for legacy/UUID schema differences.
- Portal company-shape compatibility.
- Restricted anonymous RPC execution on the repaired workflow.
- Hardened empty database function `search_path` retained.

Key commits recorded during hardening:

- `733d4f3` Restore production job cost rollup compatibility
- `f48611a` Repair production UUID workflow compatibility
- `386da02` Fix production portal company shape

## Production smoke results

- `/api/health` → healthy JSON.
- `/welcome` → 200.
- `/login` → 200.
- `/reset-password` → 200.
- `/pricing` → 200.
- `/job-costing` signed out → 307 redirect to login.
- `/api/job-costing` signed out → 401.
- No Production runtime `level:error` entries observed during the smoke window.
- Expected security headers were present.

## Environment

Required Production environment-variable names were present in Vercel for Supabase, Stripe, AI providers, cron, Resend, sender identity and business identity.

## Backup baseline

Fresh logical Production backups were created outside the repository:

- Schema dump: `production-schema.sql`
- Data dump: `production-data.sql`

PITR is not enabled. Supabase Storage objects need a separate backup/recovery strategy.

## Known non-blocking follow-ups

1. Confirm the configured `EMAIL_FROM` domain remains verified in Resend.
2. Establish backup/recovery coverage for Supabase Storage objects.
3. Evaluate enabling Supabase PITR.
4. Clean visible mojibake/encoding artefacts such as `Â·`, `â†` and `â€”` in a controlled pass.
5. Remove or replace the unused `/api/send-proposal` route, which is not part of the active proposal-sharing workflow.
6. Add ESLint as a dedicated CI/tooling improvement rather than changing the release toolchain now.
7. Upgrade the pinned Stripe API version only as a separately tested compatibility change.
8. Continue classifying remaining Production database-linter findings before modifying inactive legacy functions.

## Branding

**TradeQuote PRO is not the final launch name.** All new public-facing assets should use **[Final Product Name]** until the final brand is selected.
