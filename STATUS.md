# TradeQuote PRO: build status and handoff

Last updated 2026-11-11. Written so that you, another developer, or another AI tool can pick the work up from here. `README.md` is the setup guide; this file is where things stand.

## Where the code is

- **Folder:** `C:\Users\kylei\OneDrive\Desktop\tradequote-pro-saas\vigorous-einstein-749064` (a git worktree of `C:\Users\kylei\tradequote-pro-saas`).
- **Branch with everything:** `claude/trade-quote-pro-saas2-status-b309fa`. It is **not pushed**. `master` and GitHub are behind it.
- **To make it the main line:** `git checkout master`, then `git merge --ff-only claude/trade-quote-pro-saas2-status-b309fa`, then `git push`.
- **Old branches, safe to ignore:**
  - `claude/app-build-automation-ed8856`: merged into this branch.
  - `feat/finish-port`: a second, separate build of change orders, invoices, job costing and timecards. Not merged. It also has a plan-tiers screen (`lib/plans.ts`) that this branch lacks; nobody has checked whether it is worth porting.
  - `claude/ecstatic-carson-ca9eb4`: older security work, with 23 uncommitted files in its worktree. Not checked against this branch.

## What has been verified

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` (unit tests, plus database security tests on embedded Postgres) | 1,893 pass, 0 fail |
| `npm run build` | passes |
| `npm run e2e:local` (real sign-ins, HTTP and database on a local Supabase) | 247 pass, 0 fail |
| New pages opened in a browser | see "Browser check" at the bottom |
| Real Stripe, Resend and Claude keys; a production deploy | **not done** |

## How to run it

```bash
npm ci
npm run dev          # needs .env.local, see .env.example and README
npm test             # run before every commit; nothing lands with a failing test
npm run build
npm run e2e:local    # needs a local Supabase stack and the app on port 3200 (README, "Local end-to-end run")
```

**Scripts (PowerShell 7, run from the project folder):**

| Script | What it does |
| --- | --- |
| `pwsh scripts/verify.ps1` | Typecheck, all tests, production build. Add `-E2E` for the end-to-end run. Changes nothing. |
| `pwsh scripts/continue-build.ps1` | Hands the next unfinished task in `HANDOFF_PROMPT.md` to the Claude command-line tool, then verifies it. `-Tasks 3` does three. Uses your Claude usage. Never pushes. |
| `pwsh scripts/ship-to-master.ps1` | Verifies, then publishes this branch to GitHub `master` as a plain fast-forward. Asks before pushing. |

The local Supabase stack on this computer is the Docker project `localdb`. Its config folder was in a temp directory that got deleted, so its API gateway container (`supabase_kong_localdb`) only starts while five small email template files exist at the old temp path. They were recreated on 2026-11-11. If the gateway refuses to start again, create a fresh stack as the README describes; the data lives in the Docker volume and survives.

## What is built

Stack: Next.js 14.2 (App Router), Supabase (Postgres with row level security, Auth), Stripe subscriptions, Resend email, Claude API. One registry, `lib/modules.ts`, defines all 45 modules.

**App-wide**

- Sign-up, sign-in, invites, five roles, company isolation enforced in the database.
- Stripe subscription (one plan), 14-day trial, read-only when lapsed, trial emails.
- Command Center dashboard, daily automation and alerts, AI assistant.
- Global search (Ctrl+K), floating create button, phone bottom navigation.
- Quote pipeline board (drag or menu to move), follow-up list, quote health labels, win rate.
- Schedule calendar (month, week, phone agenda).
- Saved assemblies with a starter library, inserted into estimates.
- Client portal: share a sent proposal by link; the client accepts with a signature or declines, no account.

**Modules with their own purpose-built pages (14 of 45):** estimates, proposals, projects, change orders, invoices, progress billing draws, job costing, timecards, daily logs, LOTO permits, tailgate meetings, safety inspections, clients (profile page), crew schedule (calendar).

**The other 31 modules** (RFIs, submittals, purchase orders, fleet and so on) work as a standard list and form.

## Where the newest features live

| Feature | Files |
| --- | --- |
| Search | `lib/search.ts`, `app/api/search/route.ts`, `components/command-palette.tsx` |
| Create button, bottom nav | `components/quick-add.tsx`, `components/app-shell.tsx`, `app/(app)/layout.tsx` |
| Pipeline, follow-ups | `lib/pipeline.ts`, `lib/followups.ts`, `app/(app)/pipeline/` |
| Calendar | `lib/calendar.ts`, `app/(app)/calendar/` |
| Client profile | `lib/client-profile.ts`, `app/(app)/crm/[id]/` |
| Assemblies | `lib/assemblies.ts`, `app/api/assemblies/`, `app/(app)/assemblies/`, `supabase/migrations/20261112000020_assemblies.sql` |
| Client portal | `lib/portal.ts`, `lib/portal-server.ts`, `app/portal/[token]/`, `app/api/portal/[token]/`, `app/api/proposals/[id]/share/`, `supabase/migrations/20261112000010_client_portal.sql` |

## Rules the tests enforce (follow these or the suite fails)

- **Nothing in the database runs for the public (anon) key.** Public features go through a server route.
- **Only listed files may use the service-role key.** The lists are in `tests/review.security.test.ts` and `tests/automation.test.ts`. Adding one is a deliberate decision.
- **Every API route says who may call it** (`requireApi`, `requireCron`, or it is on the short public list), and every write route passes `write: true` so a lapsed company is read-only.
- **Database changes are new migration files**, safe to run twice, with LF line endings. New tables need row level security and explicit grants. After editing `lib/modules.ts`, run `npm run db:generate`.
- **Buttons and links are at least 48px tall on phones** (`min-h-[48px] lg:min-h-0`).
- Database tests use `tests/helpers/db.ts` (`bootDb`), which runs every migration on embedded Postgres.

## What is left: code

Most valuable first.

1. **Upgrade Next.js.** Version 14 has open security advisories (README, "Known security advisories"). The image optimizer is blocked in `middleware.ts` as a stopgap.
2. **Tell the contractor when a client answers a proposal** (email or an alert). Today the answer shows on the proposal and the pipeline, but nothing is sent.
3. **Portal line items.** The client sees scope, terms and the total, not the line-by-line breakdown. It was left out so cost and markup cannot leak; it needs sell prices worked out in SQL.
4. **File and drawing attachments** (drag and drop, previews). Photos work on daily logs and safety records only.
5. **Plan tiers.** Checkout sells one plan. `feat/finish-port` has an unverified tiers screen.
6. **From the feature wishlist, not started:** quote builder as a step-by-step wizard, AI estimate from a scope document, offline mode, the photo-and-measure site visit flow, a light theme (the app is dark only), swipe actions, deposit payment and file upload in the client portal, accounting export.
7. **Account deletion and data export** for customers. Neither exists, and the draft Terms promise both.
8. **No company logo on printed documents.** The GST/HST registration number is done: it is on the company profile and prints on every letterhead.
9. **Accounting export and partial payments.** "Mark paid" is all or nothing, and a bookkeeper has to re-key invoices.
10. **Error tracking and a support contact.** Nothing reports a customer's failure to you today.
11. **Stripe retry settings.** The app now shows a banner while a card is failing, but access only stops when Stripe cancels: set Stripe's retry settings to cancel after the last retry.
12. Subscribing mid-trial charges at once and forfeits the rest of the trial. Decide whether billing should start when the trial ends.
13. `ROADMAP.md` is stale. This file replaces it.

**Notes for whoever does the Next.js upgrade:** the worktree at `C:\Users\kylei\tradequote-pro-saas\.claude\worktrees\ecstatic-carson-ca9eb4` has 23 uncommitted files that are an unfinished attempt at it.

**Set aside, not applied:** branch `set-aside/outside-edits-2026-11-11` holds two edits made to this folder by another tool on 2026-11-11. One pinned the company profile route to a fixed company id; the other rewrote the health check with an import that does not exist, which broke the build. Do not apply them. To inspect: `git diff HEAD set-aside/outside-edits-2026-11-11`.

## What is left: only the owner can do

The full list is in `README.md` under "Before you sell it". In short:

- **URGENT: revoke the API key in `.continue/agents/new-config.yaml`.** Confirmed on 2026-11-11: the GitHub repo is **public**, and that file holds what looks like a provider API key (the value was not read). It has been on GitHub since commit `ae88835`, so treat the key as exposed and revoke it at the provider. The file is no longer tracked from this branch on and the folder is ignored, but that does not remove it from the history already on GitHub.
- Decide whether the GitHub repo should be public at all. Today anyone can read the source.
- Fix the GitHub billing lock so the CI checks run.
- **Decide the price.** `$299 CAD` in `lib/plan.ts` is a placeholder and must match the Stripe Price. The pricing page advertises a 40% founding offer whose Stripe coupon does not exist yet: create it or take the offer down.
- Back up the untracked `sales/` and `ds/` folders in `C:\Users\kylei\tradequote-pro-saas`. They hold prospect lists, so keep them out of a public repo.
- Run one real paid journey on the deployed site (sign up, pay with a Stripe test card, cancel in the portal), and try the app by hand on a phone: install, camera, signature.
- Supabase production project: run every file in `supabase/migrations/` in name order, set the auth URLs and email templates from the README table, set up custom SMTP, turn on backups.
- Stripe: product and monthly CAD price, webhook to `/api/stripe/webhook`, customer portal, tax.
- Resend account with a verified domain. Claude API key.
- Vercel project, the domain, and these variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_AUTOMATIC_TAX`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `BUSINESS_NAME`, `BUSINESS_MAILING_ADDRESS`, `OPERATOR_EMAIL`.
- Privacy Policy and Terms finished with a Canadian lawyer (both are draft templates today).
- Business entity, GST/HST registration, an independent security review.

## Browser check

Done on 2026-11-11 against the local build, signed in as a test owner.

- **Desktop:** Command Center and the pipeline board render correctly, with the search box, the new menu links and the create button.
- **Phone width (375px):** Command Center, calendar and the client portal render with no sideways scroll; the bottom bar and create button sit clear of the content; portal buttons are 48px or taller.
- **Search:** typing a proposal's name found it, and Enter opened it with the client-link panel showing.
- **Found and fixed:** the Assemblies page scrolled sideways on a phone, and the "Back to" link on every page was 39px tall.
- **Not looked at in a browser:** the client profile page and the Assemblies page after the fix (both are covered by the end-to-end run, which checks content, not layout), the estimate editor's assembly picker, and drag and drop on the pipeline board.
