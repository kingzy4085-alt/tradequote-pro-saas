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

- **Five feature branches may be waiting to merge.** Agents were building tasks 7 to 12 in parallel, each on its own branch in its own worktree under `C:\Users\kylei\tradequote-pro-saas\.claude\worktrees\` (folders named `wf_7c1554f4-b9e-1` to `-5`): `feat/payments` (task 10), `feat/portal-lines` (task 7), `feat/attachments` (task 9), `feat/owner-tools` (tasks 8 and 11), `feat/support-errors` (task 12). Run `git branch --list "feat/*"` and `git log --oneline master..feat/<name>` for each. For a branch with a finished commit: merge it into this branch with `git merge --no-ff feat/<name>`, resolve conflicts (most likely in `tests/review.security.test.ts`, where lists of allowed functions and files are pinned), run `pwsh scripts/verify.ps1`, and mark its task done. For a branch with no commit, or one that fails its checks and can't be fixed quickly, build that task yourself from the task list below.
- **Menu links still needed after merging:** `/exports` (payments branch) in `app/(app)/layout.tsx`, for roles that can read invoices.
- **Desktop app:** `pwsh scripts/install-desktop-app.ps1` installs or updates the one-click desktop copy in `C:\Users\kylei\TradeQuotePRO\app` from local `master`, with the local database settings in `C:\Users\kylei\TradeQuotePRO\database`. After merging, move local `master` forward with `git fetch . HEAD:master` and run the installer again. Never push without the owner's go-ahead.
- **Never apply** branches named `set-aside/*`. They hold broken work from other tools, including a `portal_view` that would expose every company's proposals.

## Tasks

1. **[done]** GST/HST number on the company profile and every printed letterhead.
2. **[done]** Email the contractor when a client answers a shared proposal (`lib/portal-notify.ts`).
3. **[done]** Past-due banner while a card payment is failing.
4. **[done]** Industrial estimating: NPT allowance, provincial permit line, 9/12-lead motor and Teck90 assemblies (`lib/industrial.ts`).
5. **[done]** Client signature on the printed proposal, and a save-as-PDF button on the client's page.
6. **[done]** In-app alert when a client answers a proposal (rule `proposals.answered`, migration `20261112000050`, test `tests/proposal-answered-alert.test.ts`).
7. **Line items on the client portal.** Extend `portal_view` (new migration, `create or replace`) to return the estimate's lines at sell price only (markup folded in, as `lineSellPrice` in `lib/estimate-math.ts` does) plus subtotal, tax and total. Never cost, hours, labour rate or markup. Render them like `app/print/proposal/[id]/page.tsx`. Test that cost and markup never appear in the payload.
8. **Company logo on printed documents.** Upload to a private storage bucket (copy `20261101000100_job_photos_storage.sql` and `lib/daily-log.ts`), PNG or JPEG, 1 MB limit, owner and admin only, shown in `Letterhead` in `lib/print.tsx` through a short-lived signed URL.
9. **File attachments** on Drawings, Documents and Site Vault: same storage pattern, 25 MB limit, a type allowlist, drag and drop with previews, deletion with the record.
10. **Partial payments and accounting export.** A `invoice_payments` table (amount, date, method, note), "Record payment" on `app/(app)/invoices/[id]`, the invoice becomes Paid when payments reach the total, and a CSV export of invoices and payments a bookkeeper can import.
11. **Account deletion and data export** for an owner under `app/(app)/settings/account`: export every company record as a ZIP of CSVs; deletion cancels the Stripe subscription first, then removes the company. Typed confirmation for both.
12. **Support contact and error reporting.** No new dependencies: `SUPPORT_EMAIL` (falling back to `EMAIL_REPLY_TO`) shown on the help page, error screens and pricing footer; in-app error boundaries post a short report to a signed-in-only `app/api/client-errors` route that logs one structured line.
13. **In-app alert test, phone check, end-to-end.** Extend `scripts/e2e-local.mjs` to cover tasks 6 to 11, and run `pwsh scripts/verify.ps1 -E2E`.
14. **Next.js upgrade** to the current patched major, removing the `_next/image` block in `middleware.ts` once safe. Read `node_modules/next/dist/docs/` for the upgrade guide first. Do this last, on its own, with every check green before and after.
15. **Blocked until the owner decides: plan tiers.** Needs tier names, prices and what each includes. Then: one Stripe Price per tier, tier stored on `companies` by the webhook, module access checked against it in `lib/modules.ts` and row level security.

When every task is done or blocked, finish with a short report: what you built, the final `verify.ps1` result, and what is blocked and why.

## Owner-only (not code)

In `STATUS.md` under "What is left: only the owner can do". First and urgent: revoke the API key that was committed in `.continue/agents/new-config.yaml` (the GitHub repo is public).
