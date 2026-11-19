# TradeQuote PRO

Operations software for Canadian industrial and electrical contractors: estimating, proposals, project controls, field logs, safety, finance and resources in one app, plus an AI assistant for Canadian code and construction questions. Runs in the browser and installs on Windows, Android and iPhone.

Where things stand, how each part was checked and what is parked: [ROADMAP.md](ROADMAP.md).

## What it does

**The money loop.** Each step is an explicit button. Nothing is emailed to a client and no money moves by itself.

- **Estimates:** lines with quantity, material cost and labour hours. Markup, tax and totals are worked out from the company's defaults. Printable.
- **Proposals:** one button from an estimate. One price per line with the markup built in, your terms and signature lines. You print it and send it yourself.
- **Projects:** one button from an accepted proposal. The contract value carries over and job costing starts with a budget from the estimate. Each project is a hub for its records, with budget, actual cost, billed and paid.
- **Timecards:** a weekly board by worker and job. Foremen and up enter and approve crew time, nobody below project manager approves their own card, and approved cards lock with the hourly cost frozen. Payroll export downloads a spreadsheet and marks the cards Exported, so they can't be paid twice.
- **Change orders:** per-company numbers, priced from material and labour, signed on a phone or tablet or copied from a signed printout. Approval adds the price to the contract, and adds to the job's budget only if the change order carries cost.
- **Invoices and progress draws:** per-company numbers starting at 1001, holdback at the company's percentage with a release date you enter, and tax. A draw makes a draft invoice. Marking an invoice sent opens a receivable, and marking it paid collects it. Both can be undone.
- **Job costing:** budget, actual labour, actual material, committed purchase orders and margin per job. On Track, At Risk from 85% of budget, Over Budget from 100%. Project managers see totals, not individual pay.

**Safety sign-offs.** LOTO permits (lock on, verified, lock off), tailgate meetings (attendees, then supervisor) and safety inspections have structured fields, checklists and photos, with signatures in a fixed order. The final signature locks the record. A signed record can't be deleted, and only a project manager or above can reopen it. Safety Logs remain the incident tracker.

**Alerts.** A daily run flips date-driven statuses and raises overdue and expiring alerts for invoices, bills, insurance, WCB clearance, open safety items and more. They show by role on the Command Center and the Alerts page, and in a daily email digest. Overdue dates still highlight on screen if a run was missed.

**Everything else.**

- Command Center dashboard, filtered by role.
- Daily logs with phone photos and a sign-and-lock signature, plus field logs, crew schedule, inspections, punch list and tool crib.
- Clients, RFQs and bid opportunities.
- RFIs, submittals, drawings, documents, site vault, commissioning, cable testing, quality control, non-conformance, deficiencies, warranty and tasks.
- Payables, purchase orders, vendors, sub compliance, employees, hiring, equipment, rentals, fleet, maintenance and warehouse. These are record lists with search, status filters and links to a project.
- Print pages with your letterhead for estimates, proposals, change orders, invoices and safety records.
- AI Assistant with cited sources.
- 14-day trial, then one Stripe subscription. A lapsed company can sign in and read everything but can't change anything except the signed-in person's own profile.
- Public pricing and about pages, a lead form, trial onboarding emails with unsubscribe links.

**Not built, so don't sell these:** client portal, AI estimating and proposal writing, plan tiers and seat limits, material catalog and assemblies, general file attachments, CSV import, audit log. See [ROADMAP.md](ROADMAP.md).

## How it's built

- **Next.js 14** (App Router) with **Supabase** (Postgres, Auth, Storage) and **Stripe** subscriptions.
- **One module registry:** [`lib/modules.ts`](lib/modules.ts) defines every module: fields, statuses and which roles can read, write and delete. The API, the shared module page and the generated migrations all follow it.
- **Security in the database.** Every table has row level security: a user only ever reaches rows of their own company, within their role's rights, and only while the trial or subscription is active. Money rules and locks live in triggers and database functions, not only in the screens. The API runs every query *as the signed-in user*. The service-role key is used only for Stripe webhooks, billing customers, invite emails, the public lead form, email unsubscribe links and the scheduled jobs.
- **Roles:** Owner, Admin, Project Manager, Foreman, Electrician. Electricians only see their own timecards. Foremen and up see crew time and approve it. Project managers and up see job costs as totals. Receivables and holdback are for admins and owners.
- **One plan.** Checkout sells a single `STRIPE_PRICE_ID`. The price on the pricing and billing pages is one constant, `PLAN_PRICE_MONTHLY_CAD` in [`lib/plan.ts`](lib/plan.ts), and it has to match that Stripe Price.
- **AI Assistant** ([`app/api/assistant`](app/api/assistant/route.ts)) uses Claude with web search for current code editions and a tool that searches the company's own records under the same security rules. Fair-use cap per company per day (40 on trial, 400 on a subscription).

## Set up

Needs Node 22.18 or newer on the 22 line (see [`.nvmrc`](.nvmrc)).

### 1. Supabase

Create a new project, then run **all** of these (29 files; `npm run db:check` counts them) in the SQL editor, in this order. Or use `supabase link` and `supabase db push`, which runs them in the same order. Don't mix the two without `supabase migration repair`, because the CLI doesn't know what you ran by hand.

| # | File in `supabase/migrations/` | What it adds |
| --- | --- | --- |
| 1 | `20261101000000_saas_core.sql` | Baseline schema, generated from the registry. New projects only |
| 2 | `20261101000100_job_photos_storage.sql` | Private photo storage. Once only |
| 3 | `20261101000200_trial_emails.sql` | Trial email tracking and unsubscribes |
| 4 | `20261104000000_registry_sync.sql` | Registry schema again, safe on any version, generated |
| 5 | `20261104000050_hardening.sql` | Security fixes. The Stripe webhook needs `stripe_events.processed_at` from here |
| 6 | `20261104000100_timecards.sql` | Timecard approval and locks |
| 7 | `20261104000110_billing.sql` | Invoices, draws, holdback, receivables, change order numbers |
| 8 | `20261104000120_safety_records.sql` | LOTO, tailgate and inspection sign-offs |
| 9 | `20261104000200_job_costing.sql` | Job cost rollup |
| 10 | `20261104000210_automation.sql` | Daily alerts, status flips, digests |
| 11 | `20261104000300_cleanups.sql` | Small fixes |
| 12 | `20261104000310_contract_rules.sql` | Who can read contract money, what a stale draft can bill |
| 13 | `20261104000320_review_fixes.sql` | Fixes from review of money, security and first use |
| 14 | `20261112000010_client_portal.sql` | Client portal links and decisions |
| 15 | `20261112000020_assemblies.sql` | Assemblies library |
| 16 | `20261112000030_company_tax_number.sql` | Company tax number |
| 17 | `20261112000040_portal_notice.sql` | Portal notice |
| 18 | `20261112000050_proposal_answered_alert.sql` | Alert when a client answers a proposal |
| 19 | `20261113000000_add_deposits_and_pricebook.sql` | Deposits and price book |
| 20 | `20261113000105_restore_company_can_write.sql` | Restores `company_can_write()` |
| 21 | `20261113000110_invoice_payments.sql` | Invoice payments |
| 22 | `20261113000115_restore_client_portal.sql` | Restores the client portal objects |
| 23 | `20261113000120_portal_lines.sql` | Proposal lines shown in the portal |
| 24 | `20261113000122_restore_core_helpers.sql` | Restores the core auth helpers |
| 25 | `20261113000125_restore_site_vault.sql` | Restores the site vault |
| 26 | `20261113000130_attachments.sql` | Attachments |
| 27 | `20261113000140_company_logo_and_closure.sql` | Company logo and account closure |
| 28 | `20261117000000_ai_rate_limit.sql` | Hourly AI request allowance |
| 29 | `20261118000100_harden_auth_helper_search_path.sql` | Empty `search_path` on the auth helper functions |

The old scripts in `database/legacy/` are for reference only. Don't run them.

**Auth → URL configuration:** set the Site URL to your app URL and add `https://YOUR-DOMAIN/auth/callback` to the redirect URLs.

**Auth → Email:** keep "Confirm email" on, and set up custom SMTP before launch, because Supabase's built-in sender is rate limited.

**Auth → Email Templates:** replace the link in each template below, or invites and links opened on another device won't work. `token_hash` links work on any device. Invited people and password resets are sent to choose a password first.

| Template | Link |
| --- | --- |
| Confirm signup | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email` |
| Invite user | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/onboarding` |
| Magic Link | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink` |
| Change Email Address | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email_change` |
| Reset Password | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery` |

**Password reset flow (scanner-safe).** Mail security scanners open every link in an email, which would spend a one-time token before the person clicks. So a reset link never signs anyone in on a plain GET:

1. The Reset Password email links to `/auth/callback?token_hash=…&type=recovery` (the template above).
2. `GET /auth/callback` does **not** verify a `recovery` token. It redirects (303) to `/auth/confirm`, carrying `token_hash`, `type` and a safe `next`.
3. `/auth/confirm` shows a **Continue** button. Scanners don't press buttons, so the token is still unused.
4. Continue sends `POST /auth/callback`, which checks the request came from this site, verifies the token once, signs that browser in and redirects (303).
5. The person lands on `/update-password` to choose a new password.

Other template types (signup, invite, magic link, email change) are still verified on the GET. **The Reset Password template in Supabase must use the `token_hash` link in the table above** (the `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery` placeholder link). Supabase's default `{{ .ConfirmationURL }}` link is not scanner-safe and opens in the browser that asked only. This repository can't change that setting: edit it under Supabase → Auth → Email Templates.

### 2. Stripe

Create a Product with a recurring monthly **CAD** Price at the figure in `lib/plan.ts` and copy its `price_...` id. Add a webhook endpoint at `https://YOUR-DOMAIN/api/stripe/webhook` for `checkout.session.completed` and `customer.subscription.created/updated/deleted`. Turn on the customer portal. Turn on Stripe Tax if you want GST/HST/PST calculated, then set `STRIPE_AUTOMATIC_TAX=true`.

### 3. Claude API

Create a key at console.anthropic.com and set `ANTHROPIC_API_KEY`. Without it the assistant says it isn't configured and everything else works.

Voice-to-estimate and scope extraction use Google Gemini (`gemini-2.5-flash`): set `GEMINI_API_KEY` from aistudio.google.com. Without it those two features answer that they aren't set up. A **Vercel production build fails if it is missing**.

Texting a proposal link to a client uses Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_PHONE_NUMBER` (international format, like `+13065550123`). All three go together. Setting only some fails the production build, and setting none only prints a warning.

**Build checks.** `scripts/check-env.ts` runs in `npm run build`. A Vercel *production* build needs every required setting in `.env.example`. A Vercel *preview* build only needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, so a preview can't look healthy while sign-in is broken, and no production-only integration is demanded. Local and CI builds skip the check.

### 4. Email

Create a [Resend](https://resend.com) account, verify your sending domain and add an API key. Owners get five trial emails (days 0, 2, 5, 10 and 13). Foremen and up get the daily alert digest. Each email has an unsubscribe link. Unsubscribing from trial emails doesn't stop safety alerts, which have their own scope.

| Setting | What it's for |
| --- | --- |
| `RESEND_API_KEY` | Sends email. Without it, alerts still show in the app, and emails are skipped and logged |
| `EMAIL_FROM` | Sender, on your verified domain |
| `EMAIL_REPLY_TO` | Optional reply address |
| `BUSINESS_NAME`, `BUSINESS_MAILING_ADDRESS` | Required in commercial email under Canada's anti-spam law. A PO box is fine |
| `UNSUBSCRIBE_SECRET` | Signs unsubscribe links. Keep it separate from `CRON_SECRET`, and don't change it later: old links would stop working |
| `OPERATOR_EMAIL` | Who hears when the automation fails or stops running, and about new leads. Defaults to `EMAIL_REPLY_TO` |
| `SUPPORT_EMAIL` | Optional. The address customers write to, shown on the help page, every error screen and the pricing page. Defaults to `EMAIL_REPLY_TO`. With neither, error screens say to contact the company that set up the account. Pages built ahead, like pricing, take it at build time, so redeploy after changing it |

### 5. Scheduled jobs

**Automation only runs on a deployed host. It does not run from the desktop launcher, or from `npm run dev`.** Without it the Attention panel stays empty and shows "Not checked yet".

On Vercel, [`vercel.json`](vercel.json) schedules these and Vercel sends `CRON_SECRET` with each call. Set `CRON_SECRET` to a random string of 32 or more characters, and confirm your Vercel plan allows this many cron jobs. Times are UTC.

| Route | When | What it does |
| --- | --- | --- |
| `/api/cron/job-costs` | 09:00 | Recomputes every job as a safety net behind the triggers |
| `/api/cron/automation` | 10:00 and 11:00 | Status flips and alerts for every active company, then waiting safety emails. A second run the same date changes nothing |
| `/api/cron/trial-emails` | 15:00 | Trial onboarding emails |
| `/api/cron/digest` | 15:00 | Daily alert digest per person, and a check that the automation is healthy |
| `/api/cron/status` | 16:00 | Says whether the automation is running. Returns 503 if not, so an uptime monitor can watch it too |

On another host, call each route on the same schedule with `Authorization: Bearer $CRON_SECRET`.

### 6. Run it

Copy `.env.example` to `.env.local` and fill it in, then:

```bash
npm ci
npm run dev
```

### 7. Deploy

Deploy on Vercel with the settings above. On a Vercel production build, `npm run build` first runs [`scripts/check-env.ts`](scripts/check-env.ts), which fails the deploy and lists any setting that is missing or wrong, by name only. It requires an `https` site address and a live Stripe key, so a production deploy can't go out in test mode or without email. Preview builds skip it. To try it yourself: `node --env-file=.env.local scripts/check-env.ts --force`.

When a signed-in person sees an error screen, it reports the failure to `/api/client-errors`, which writes one line of JSON to the server log: `"event":"client_error"` with the company, user, role, page, error reference and message (never the stack, anything typed or cookies). Search the Vercel logs for `client_error` to see what customers hit. Each server counts reports in memory and takes up to 10 per person every 10 minutes. The reference matches the one on their error screen and in the subject of their email to `SUPPORT_EMAIL`.

## Upgrading a live database

For a database that already holds customer data on the old baseline.

1. **Back it up,** and try this on a copy first. Take a Supabase backup or a `pg_dump`.
2. **Don't run `20261101000000_saas_core.sql`.** It is for new projects and fails on a live one.
3. **Run `20261101000100_job_photos_storage.sql` only if it never ran.** It can't run twice.
4. **Run every other file in filename order,** from `20261101000200_trial_emails.sql` to the last one. They are all safe to run more than once.
5. **Deploy the new code straight after, in the same sitting.** The two don't work across versions: the new code needs the new columns, and old code that reads project contract columns directly is refused after `20261104000310_contract_rules.sql`.
6. **Check it.** `/api/health` answers, `/api/cron/status` reports healthy after the first daily run, and a signed-in owner can open a project, an invoice and a timecard.

What changes for existing records:

- Records are linked to projects and clients by **exact name match**. A name that doesn't match stays unlinked, and its old text stays visible, so someone has to link those by hand.
- Existing company settings get the new defaults: overtime multiplier 1.5 and holdback 10%. Check them on the Company Profile page.
- Holdback, lien and WCB periods are company settings. Nothing provincial is hard-coded.

If you edit `lib/modules.ts` later, follow "Adding or changing a module" below.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build (type-checked, and settings-checked on Vercel production) and server |
| `npm test` | Unit tests, plus row-level-security and trigger tests that run the real migrations on embedded Postgres |
| `npm run e2e:local` | Full walk of the app against a local Supabase. See below |
| `npm run typecheck` | TypeScript only |
| `npm run db:generate` | Regenerate the two generated migrations after editing `lib/modules.ts` (tests fail if you forget) |
| `npm run db:check` | Fail if two migrations share a version number |

## Testing end to end

[`scripts/e2e-local.mjs`](scripts/e2e-local.mjs) uses real sign-ins, real HTTP routes, real PostgREST, real storage and a real mail catcher, with no mocks. It walks the company and team, estimate, proposal, project, timecards, change order, invoice, job cost rollup, LOTO with photos, daily logs, the daily automation, alerts per role, a second company, a lapsed company, the invite email and every page per role. It makes throwaway companies and logins and removes them afterwards (`--keep` leaves them there). It refuses any address that isn't on this computer and never prints a key.

It needs Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli). The repo has no `supabase/config.toml`, so keep the local stack in its own folder outside the repo:

1. In that folder, run `supabase init` and copy this repo's `supabase/migrations/*.sql` into its `supabase/migrations/`.
2. In its `supabase/config.toml`, set `site_url = "http://localhost:3200"`, add `http://localhost:3200/auth/callback` to `additional_redirect_urls`, and point `[auth.email.template.*]` at files that use the links in the table above.
3. Run `supabase start`, then `supabase status -o env` to see the local keys.
4. Set the local values in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL=http://localhost:3200` and any `CRON_SECRET`. Keep a copy of your real `.env.local` first.
5. Build and start the app, then in a second terminal run the walk:

```bash
npm run build && npm run start -- -p 3200
npm run e2e:local
```

It reads settings from the environment, then `.env.local`. `E2E_APP_URL` and `E2E_MAIL_URL` override the defaults (`http://127.0.0.1:3200`, `http://127.0.0.1:54324`). The walk doesn't reach Stripe, Resend or Anthropic.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request: Node from `.nvmrc`, `npm ci`, the migration version check, typecheck, tests, a build with placeholder settings, `npm audit` and gitleaks. Dependabot opens weekly npm update PRs.

- **`npm audit` reports but doesn't fail the run yet.** See the next section. Remove `continue-on-error` from the workflow once it can pass.
- **Gitleaks checks the commits in each push or pull request.** A green check doesn't prove older history is clean. See the `.continue` item under cleanup. On a GitHub organization account the gitleaks action also needs a `GITLEAKS_LICENSE` secret.

## Known security advisories

`npm audit` still reports advisories, on Next 14.2.35 (the latest 14.x) and on the test tools. On 2026-11-06 it counted 7 packages: 3 critical, 1 high and 3 moderate.

- **`next` (critical, production):** npm offers a fix only as a major upgrade to 16. The list includes remote code execution on Windows-hosted servers and through the image optimizer, cache poisoning, middleware bypasses and denial of service. Run `npm audit` for the current list. What limits the exposure today: `next.config.js` turns the image optimizer off and middleware closes its endpoint, the desktop launcher listens only on `127.0.0.1`, pages and API routes re-check the session, and row level security applies to every query. That limits the risk but doesn't remove it. Deciding on the upgrade is on the owner list below.
- **`vitest` 2 and its `vite`, `esbuild`, `tinypool` chain (critical, development only):** these aren't in the deployed app, but they run on developer machines and in CI.

## Adding or changing a module

Edit `lib/modules.ts`, run `npm run db:generate`, then `npm test`. The generator rewrites both the baseline and `20261104000000_registry_sync.sql`. Generated SQL is never edited by hand. A live database catches up by running the sync file again, never the baseline. It only adds what is missing and links old rows by exact name. After that, run the hand-written migrations that come later in filename order again too, because the sync resets module policies to what the registry says.

## Install as an app

- **Windows:** create `.env.local`, then run `install-desktop-shortcut.ps1` once. The "TradeQuote PRO" shortcut starts the server on this computer only (`127.0.0.1:3001`) and opens the app window. Add `http://localhost:3001/auth/callback` to Supabase's redirect URLs. Scheduled jobs don't run from the desktop app. They run on the deployed host, and the desktop app has to share that host's Supabase project to get its alerts.
- **Android / iPhone:** once deployed on HTTPS, open the site and choose *Install app* (Chrome) or *Share → Add to Home Screen* (Safari).

## Before you sell it

These need you, not code. Decisions still open are also in [ROADMAP.md](ROADMAP.md).

**Do first**

- **Check `.continue/agents/new-config.yaml` for an API key.** See cleanup below.
- **Decide on the Next.js upgrade.** See "Known security advisories".

**Accounts and hosting**

- Vercel project for production, with its cron limits confirmed.
- A paid Supabase production project with backups (point-in-time recovery), the migrations run, and the redirect URLs, email templates and custom SMTP set.
- Resend account with a verified sending domain.
- Generate `CRON_SECRET` and a separate `UNSUBSCRIBE_SECRET`, and set `OPERATOR_EMAIL`.
- Supply `BUSINESS_NAME` and `BUSINESS_MAILING_ADDRESS` for the anti-spam law.
- An uptime monitor on `/api/health` and `/api/cron/status`.
- Confirm the domain before launch: `Strict-Transport-Security` in `next.config.js` is set with `includeSubDomains; preload`, which binds every subdomain.

**Business and legal**

- Business entity, Stripe account verification, GST/HST registration.
- Finish the **Privacy Policy** and **Terms** in `app/legal/` with a Canadian lawyer (PIPEDA, liability, data location). Both are marked draft templates on the page and still have bracketed details. The retention periods in `lib/automation.ts` are stated in the privacy page, so change them together.
- Ask the lawyer about account deletion and data export. There is no self-serve way to do either today.
- A licence from CSA if the assistant should quote Canadian Electrical Code text. Today it summarizes and cites, never reproduces.
- An independent security review or penetration test.

**Pricing and first checks**

- Decide the price: set `PLAN_PRICE_MONTHLY_CAD` in `lib/plan.ts` (today's figure isn't final) and create the matching Stripe Price.
- The founding offer on the pricing page needs a Stripe coupon (40% off, duration forever, 25 redemptions) with a promotion code, which you email to people on the list in the `leads` table. Nothing emails them or you automatically except the new-lead notice to `OPERATOR_EMAIL`. If you won't run the offer, set `FOUNDING_OFFER.enabled` to `false` in `lib/plan.ts`.
- Run one real test on the deployed site: sign up, pay with Stripe, get an invite and a digest email, see the daily cron fire, open it on a phone. None of this has been tried against the real services yet.

## Cleanup for the owner

Left in place on purpose. None of it is used by the app.

| Path | What to do |
| --- | --- |
| `.continue/` | **Check it first. It may hold an API key.** `.continue/agents/new-config.yaml` is tracked in git and on `origin`, since commit `ae88835`. The two earlier audits disagree: one reported a plaintext provider key in it, the other saw no secret, and it was not opened for this write-up. Only you can settle it. If there is a key, revoke it at the provider, since deleting the file doesn't remove it from history, and consider rewriting history. Either way, untrack the folder and add it to `.gitignore` |
| `.lucky/` | Tracked tool leftovers. Delete |
| `database/legacy/` | Old SQL kept for reference. Never run it. Delete when you no longer want it |
| `tests/_tmp/` | One leftover scratch file that tests nothing. Delete |
| `eslint.config.mjs` | References packages that aren't installed, so linting doesn't run. Install ESLint and add a CI step, or delete the file |
