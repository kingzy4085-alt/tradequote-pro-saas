# TradeQuote PRO roadmap

Last updated 2026-11-06. All of this work is on branch `claude/app-build-automation-ed8856` and has not been committed, pushed or deployed. Nothing below has run against a real hosted service.

The scope decision was the core money loop first: estimate, proposal, job, timecards and change orders, invoice, job cost, plus safety sign-offs and alerts. Everything else is parked below.

## How things were verified

| Check | What it is | Latest result |
| --- | --- | --- |
| **Tests** | `npm test`. Unit, route and rule tests. Database rules run the real migrations on embedded Postgres (PGlite), with Stripe, email and Anthropic mocked | 1803 passed, 1 skipped (the leftover scratch file), on 2026-11-06 |
| **Clean copy run** | The CI steps (`npm ci`, migration check, typecheck, tests, placeholder build) on a fresh copy of the tree with no `.env.local`. This stands in for GitHub Actions, which hasn't run yet | All passed on 2026-11-06, on Windows. **Not run on Linux:** Docker wasn't responding, so the first GitHub run is the first Linux run. `npm audit` still reports advisories, as expected |
| **Local end to end** | `npm run e2e:local`. Real sign-ins, HTTP routes, PostgREST, storage and mail catcher on a local Supabase in Docker, with a fresh database | 193 checks passed, 0 failed, on 2026-11-04. Not rerun since, because Docker wasn't responding on 2026-11-06. The only app file changed after that run is the wording of the Help page |
| **Migrations, new and upgraded** | All 13 migrations applied to throwaway `supabase/postgres:17.11` containers as the non-superuser `postgres` role: once from empty, once from the old baseline at commit `9441e49`. Then every re-runnable file applied a second time | No failures. Schemas of the two databases identical, ignoring column order. Second run changed nothing, on 2026-11-04. The old baseline had no customer rows in this run. Backfill of old rows is covered by PGlite tests |
| **Build** | `next build` and `tsc --noEmit` | Pass |

"Tested locally" below means the tests and the local end-to-end walk.

## Done

| Area | What's there | Verified how |
| --- | --- | --- |
| Auth | Sign up, login, password reset, invites by email, sessions, links that work across devices | Tested locally. Invite email followed from the local mail catcher to first sign-in. Hosted email templates not tried |
| Multi-tenant and roles | Company isolation in row level security. Owner, Admin, Project Manager, Foreman, Electrician. Read-only when a trial or subscription lapses, including delete | Tests with another company and a lapsed one. End to end per role |
| Estimating | Lines, one labour rate per estimate from the company default, one markup, tax, print | Tested locally |
| Proposals | Created from an estimate, print, status, accepted creates a project | Tested locally |
| Project hub | Records by project, contract, approved changes, budget, actual, billed, paid | Tested locally |
| Timecards | Weekly board, approval rules, locks, frozen cost, overtime, payroll export | Tested locally |
| Change orders | Per-company numbers, signature, approval updates the contract and budget | Tested locally. Signature was a posted image, not a finger on a screen |
| Invoices and draws | Per-company numbers, holdback, tax, draft from a draw or project, receivable on sent, collected on paid | Tested locally |
| Job costing | Rollup, status thresholds, committed POs, totals by rank, nightly recompute | Tested locally. Final figures in the walk came out as expected |
| Safety records | LOTO, tailgate, inspections. Ordered sign-offs, photos on storage, lock, reopen, print | Tested locally on real local storage |
| Alerts and automation | Daily status flips and alerts, role filters, snooze and dismiss, digest, status route, safe to re-run | Routes run locally by hand with the cron secret. Vercel's scheduler never fired them. Digest and safety email sending covered with mocks only |
| Trial emails | Five steps, unsubscribe scopes, anti-spam details | Tests with mocks. No real email sent |
| Billing | One plan, checkout, portal, webhook | Tests with mocks. No real Stripe call |
| AI Assistant | Claude with web search and a records tool, daily cap | Tests with mocks. No real Anthropic call in this work |
| RFIs, submittals and the other record modules | Registry-driven lists with search, status, project link and role rules | Shared module tests, and the page-load check per role |
| CI and tooling | Workflow, Dependabot, migration version check, production settings check | Script checks by tests and the clean copy run. The workflow and gitleaks have never run on GitHub |

## Not verified at all

- Anything against real Supabase hosting, Stripe, Resend, Anthropic or Vercel cron.
- The pages by hand on an actual phone: installing the app, the camera, drawing a signature. The end-to-end page check loads pages over HTTP, and doesn't drive a browser.
- Upgrading a database with real customer data. Try it on a copy first.
- Gitleaks, on this repo's history or on our test fixtures. It may need allowlist entries for false positives.

## Parked

Deliberately not built. Don't sell these. The product decisions already made are kept here so they don't have to be made twice. Any of them that gets built takes a new migration number after the last one.

- **Client portal.** Token links, not a client login: 32 random bytes, only the SHA-256 stored, expiring in 30 days by default, revocable. A public page served through an explicit column list that never shows cost, labour or markup. Accept or decline records name, signature, time and IP. Drawings by signed URL, only those flagged shared.
- **AI estimating, proposal writing and cost prediction.** Draft-only: nothing saved until a person accepts it, and costs labelled as estimates. Cost prediction says "not enough history" below 5 closed jobs and never invents a figure. Counts against the daily AI cap.
- **Plan tiers and seat limits.** Field, Crew and Contractor, monthly and annual, set only by the Stripe webhook. A trial unlocks everything, and an active subscription with no plan keeps full access. Seat caps at invite and accept. Today one plan is sold.
- **Material catalog and assemblies.** Supplier price lists, labour rates by classification, assemblies that explode into estimate lines.
- **General file attachments.** Today only daily logs and safety records take photos.
- **CSV import.**
- **Audit log.** Append-only, written by database trigger, admin-only viewer.

Also not built, and not parked by any decision:

- A pipeline that applies migrations before deploying. Today they are run by hand. It would need GitHub secrets and a Vercel deploy hook from the owner.
- Self-serve account deletion and data export.
- Error tracking such as Sentry. Today it is logs, plus the operator email from the automation.
- A strict Content Security Policy. Today's header covers framing, base URI, forms and objects, but not scripts.
- Linting. `eslint.config.mjs` exists, but ESLint isn't installed.

## Owner decisions pending

1. **Possible key in `.continue/`.** Check `.continue/agents/new-config.yaml`, which earlier audits disagree about. Revoke any key in it, and decide whether to rewrite git history. Do this first.
2. **Next.js upgrade.** The plan was to stop at 14.2.35, and that leaves critical advisories open, including remote code execution on Windows-hosted servers. npm's only fix is a major upgrade to 16. Decide when, and whether the desktop launcher stays in use until then. Upgrading `vitest` clears the development-only advisories.
3. **Price.** `PLAN_PRICE_MONTHLY_CAD` in `lib/plan.ts` is not final, and needs a matching Stripe Price.
4. **Founding offer.** Create the Stripe coupon and promotion code, or turn the offer off in `lib/plan.ts`.
5. **Holdback and WCB periods.** They are company settings today, with holdback defaulting to 10%. Decide whether to supply provincial guidance or leave them as settings.
6. **How migrations get to production.** By hand, or the pipeline above.
7. **Which parked item comes first,** after the first paying customers.
8. **Legal, accounts and hosting.** See "Before you sell it" in the [README](README.md).
