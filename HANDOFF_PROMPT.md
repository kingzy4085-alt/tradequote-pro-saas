# One prompt to finish the build

Paste everything below the line into an AI coding tool (Claude Code, Cursor, Copilot agent) with this folder open. Or run `pwsh scripts/continue-build.ps1 -Tasks 10`, which feeds it the tasks one at a time and checks each.

---

You are finishing **TradeQuote PRO**, a Next.js 14 + Supabase + Stripe SaaS for Canadian industrial and electrical contractors. Work through every task below, in order, without stopping to ask, until all are done or one is truly blocked.

## Ground rules

1. **Folder and branch:** `C:\Users\kylei\OneDrive\Desktop\tradequote-pro-saas\vigorous-einstein-749064`, branch `claude/trade-quote-pro-saas2-status-b309fa`. Never work in `C:\Users\kylei\tradequote-pro-saas` (an old branch with none of this work). Never apply branch `set-aside/outside-edits-2026-11-11`.
2. **Read first:** `STATUS.md`, then `README.md`, then `AGENTS.md`.
3. **Prove the starting point:** `pwsh scripts/verify.ps1`. It must end with "All checks passed." If it doesn't, fixing that is task zero.
4. **The loop, for every task:**
   - Read the files the task names, plus one similar existing feature, and copy its patterns.
   - Build it with tests: logic in `lib/*.ts` with a test in `tests/`; database rules tested with `bootDb` from `tests/helpers/db.ts` (see `tests/assemblies.test.ts`, `tests/portal.test.ts`).
   - Run `pwsh scripts/verify.ps1` and fix until it passes. Never delete or weaken a test to get green.
   - Commit that one feature with a message that says why. Mark the task `[done]` in this file and update `STATUS.md` in the same commit.
   - Go to the next task.
5. **If a task is blocked** (it needs an owner decision, an account or a key): write why under a "Blocked" heading at the top of `STATUS.md`, skip it, and continue with the next one.
6. **Never** push, deploy, force anything, switch branches, or touch real Stripe, Resend or Supabase production. Publishing is `pwsh scripts/ship-to-master.ps1`, run by the owner.

## Rules the test suite enforces

- Nothing in the database runs for the public (anon) key. Public features go through a server route; copy `lib/portal-server.ts`.
- Only allowlisted files use the service-role key (lists in `tests/review.security.test.ts` and `tests/automation.test.ts`). Adding a file is deliberate, with a test pinning what it may do.
- Every API route calls `requireApi(...)` (with `write: true` on writes) or `requireCron(...)`.
- Database changes are a NEW file `supabase/migrations/YYYYMMDDHHMMSS_name.sql`: safe to run twice, LF line endings, row level security and explicit grants on new tables, new columns on `companies` granted one by one. Never edit an existing migration. After editing `lib/modules.ts`, run `npm run db:generate`.
- Company-scoped queries run as the signed-in user (`ctx.supabase`). Never take a company id from the client or hard-code one.
- Server-rendered text that tests or emails match should be one string: `{`Label ${value}`}`, not `Label {value}` (React inserts `<!-- -->` between them).
- Buttons and links are `min-h-[48px] lg:min-h-0`. Dark slate and amber UI, plain English, no emoji.

## State on 2026-11-12, read this first

- Tasks 1 to 12 are built, merged into this branch and passing every check. Local `master` matches this branch; GitHub `master` does not have the newest work yet (publishing needs the owner's go-ahead: `pwsh scripts/ship-to-master.ps1`).
- **Desktop app:** `pwsh scripts/install-desktop-app.ps1` installs or updates the one-click desktop copy in `C:\Users\kylei\TradeQuotePRO\app` from local `master`, with the local database settings in `C:\Users\kylei\TradeQuotePRO\database`. After committing, move local `master` forward with `git fetch . HEAD:master` and run the installer again.
- **Never apply** branches named `set-aside/*` or files in `C:\Users\kylei\TradeQuotePRO\set-aside`. They hold broken work from other tools, including a `portal_view` that would expose every company's proposals. `tests/review.security.test.ts` now fails if the public key can reach any table or view.
- The `feat/*` branches are merged and can be deleted.
## Tasks

1. **[done]** GST/HST number on the company profile and every printed letterhead.
2. **[done]** Email the contractor when a client answers a shared proposal (`lib/portal-notify.ts`).
3. **[done]** Past-due banner while a card payment is failing.
4. **[done]** Industrial estimating: NPT allowance, provincial permit line, 9/12-lead motor and Teck90 assemblies (`lib/industrial.ts`).
5. **[done]** Client signature on the printed proposal, and a save-as-PDF button on the client's page.
6. **[done]** In-app alert when a client answers a proposal (rule `proposals.answered`, migration `20261112000050`, test `tests/proposal-answered-alert.test.ts`).
7. **[done]** Line items on the client portal, at sell price only (migration `20261113000120_portal_lines.sql`).
8. **[done]** Company logo on printed documents (migration `20261113000140_company_logo_and_closure.sql`).
9. **[done]** File attachments on Drawings, Documents and Site Vault (migration `20261113000130_attachments.sql`).
10. **[done]** Partial payments on invoices and the CSV bookkeeping export on the Exports page (migration `20261113000110_invoice_payments.sql`).
11. **[done]** Owner data export (one JSON file) and closing the account, which cancels Stripe first.
12. **[done]** Support contact (`SUPPORT_EMAIL`) and signed-in error reporting.
13. **In-app alert test, phone check, end-to-end.** Extend `scripts/e2e-local.mjs` to cover tasks 6 to 11, and run `pwsh scripts/verify.ps1 -E2E`.
14. **Next.js upgrade** to the current patched major, removing the `_next/image` block in `middleware.ts` once safe. Read `node_modules/next/dist/docs/` for the upgrade guide first. Do this last, on its own, with every check green before and after.
15. **Blocked until the owner decides: plan tiers.** Needs tier names, prices and what each includes. Then: one Stripe Price per tier, tier stored on `companies` by the webhook, module access checked against it in `lib/modules.ts` and row level security.

When every task is done or blocked, finish with a short report: what you built, the final `verify.ps1` result, and what is blocked and why.

## Owner-only (not code)

In `STATUS.md` under "What is left: only the owner can do". First and urgent: revoke the API key that was committed in `.continue/agents/new-config.yaml` (the GitHub repo is public).
