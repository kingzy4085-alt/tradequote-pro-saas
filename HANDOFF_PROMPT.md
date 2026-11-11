# Prompt to give another AI coding tool

Paste everything below the line into the other tool, with this repo folder open.

---

You are continuing work on **TradeQuote PRO**, a Next.js 14 (App Router) + Supabase + Stripe SaaS for Canadian electrical contractors.

## Start here

1. Work in `C:\Users\kylei\OneDrive\Desktop\tradequote-pro-saas\vigorous-einstein-749064` on branch `claude/trade-quote-pro-saas2-status-b309fa`. It has everything. Do not use `master`, `feat/finish-port` or any other branch.
2. Read `STATUS.md` (what is built, verified and left), then `README.md` (setup), then `AGENTS.md`.
3. Run `npm ci`, then `npm test` and `npm run build`. Both must pass before you change anything. If they do not, stop and fix that first.
4. Do **not** apply branch `set-aside/outside-edits-2026-11-11`. It holds two broken edits (a hard-coded company id and a health check with a bad import).

## Rules (the test suite enforces them)

- Run `npm test` and `npm run build` before every commit. Never commit with a failing test, and never delete or weaken a test to get green.
- Nothing in the database may run for the public (anon) key. A public feature goes through a server route. Copy the pattern in `lib/portal-server.ts`.
- Only files on the allowlists in `tests/review.security.test.ts` and `tests/automation.test.ts` may use the service-role key.
- Every API route calls `requireApi(...)` (with `write: true` on writes) or `requireCron(...)`.
- Database changes are a **new** file in `supabase/migrations/`, named `YYYYMMDDHHMMSS_name.sql`, safe to run twice, LF line endings, with row level security and explicit grants on new tables. Copy `20261112000020_assemblies.sql`. Never edit an existing migration.
- After editing `lib/modules.ts` run `npm run db:generate`.
- Every company-scoped query runs as the signed-in user (`ctx.supabase`). Never take a company id from the client or hard-code one.
- Put logic in `lib/*.ts` with a test in `tests/`. Database rules get a test using `bootDb` from `tests/helpers/db.ts` (see `tests/assemblies.test.ts`).
- Buttons and links: `min-h-[48px] lg:min-h-0`. Dark slate and amber UI, plain English, no emoji.
- One feature per commit, with a message that says why.

## Tasks, in order

Do them one at a time. After each: tests, build, commit.

1. **[done] GST/HST number on printed documents.** `tax_number` is on the company profile (migration `20261112000030_company_tax_number.sql`) and prints on every letterhead. A company logo is still to do, and is not urgent.
2. **Tell the contractor when a client answers a proposal.** After `answerPortal` succeeds in `lib/portal-server.ts`, raise an alert for the company through the existing alerts system (`lib/alerts.ts`, `lib/automation.ts`, migration `20261104000210_automation.sql`), and email the owner with `sendEmail` from `lib/email.ts` when email is configured.
3. **Line items on the client portal.** Return sell prices only (markup folded in, never cost or markup) from `portal_view` in a new migration. Match `lineSellPrice` in `lib/estimate-math.ts` and the layout of `app/print/proposal/[id]/page.tsx`. Add a test proving cost and markup never appear in the payload.
4. **[done] Past-due banner.** `components/app-shell.tsx` shows a notice with a billing link while `subscription_status` is `past_due`.
5. **File attachments** on Drawings, Documents and Site Vault. Reuse the private storage bucket and signed-URL pattern from daily log photos (`lib/daily-log.ts`, migration `20261101000100_job_photos_storage.sql`). Drag and drop, 25 MB limit, type allowlist.
6. **Partial payments and an accounting export.** A payments table per invoice, "Record payment" on `app/(app)/invoices/[id]`, and a CSV export of invoices and payments.
7. **Account deletion and data export** for an owner, under `app/(app)/settings/account`.
8. **Error tracking and a support contact.** Add Sentry (or similar) behind an env variable, and a support email on the help page.
9. **Upgrade Next.js to the current patched major** and remove the `_next/image` block in `middleware.ts` once it is safe. Read the upgrade guide first. An unfinished attempt is in the worktree `C:\Users\kylei\tradequote-pro-saas\.claude\worktrees\ecstatic-carson-ca9eb4`.
10. **Wishlist, only after 1 to 9:** step-by-step quote wizard, AI estimate from a scope document, plan tiers, offline mode, light theme, deposit payment in the portal, the photo-and-measure site visit flow.

## Verifying

- `npm run e2e:local` runs 247 real checks against a local Supabase stack and the app on port 3200 (README, "Local end-to-end run"). Extend `scripts/e2e-local.mjs` for each new feature.
- Open every new page at phone width (375px) and check there is no sideways scroll.

## Not code: only the owner can do these

Listed in `STATUS.md` under "What is left: only the owner can do". The first is urgent: revoke the API key committed in `.continue/agents/new-config.yaml`.
