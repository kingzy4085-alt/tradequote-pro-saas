# TradeQuote PRO

Operations software for Canadian industrial and electrical contractors: estimating, proposals, project controls, field logs, safety, finance and resources in one app, plus an AI assistant for Canadian code and construction questions. Runs in the browser and installs on Windows, Android and iPhone.

## How it's built

- **Next.js 14** (App Router) with **Supabase** (Postgres, Auth) and **Stripe** subscriptions.
- **One module registry** — [`lib/modules.ts`](lib/modules.ts) defines all 44 modules: fields, statuses and which roles can read, write and delete. The API, the shared module page and the database migration all follow it.
- **Security in the database.** Every table has row level security: a user only ever reaches rows of their own company, within their role's rights, and only while the trial or subscription is active. The API runs every query *as the signed-in user*; the service-role key is used only for Stripe webhooks, billing customers and invite emails.
- **Roles:** Owner, Admin, Project Manager, Foreman, Electrician. Electricians only see their own timecards.
- **AI Assistant** ([`app/api/assistant`](app/api/assistant/route.ts)) uses Claude with web search for current code editions and a tool that searches the company's own records under the same security rules. Fair-use cap per company per day (40 on trial, 400 on a subscription).

## Set up

1. **Supabase** — create a new project. In the SQL editor, run [`supabase/migrations/20261101000000_saas_core.sql`](supabase/migrations/20261101000000_saas_core.sql). It is the baseline schema for a **fresh** project (the old scripts in `database/legacy/` are kept for reference only — don't run them). Then run [`supabase/migrations/20261101000100_job_photos_storage.sql`](supabase/migrations/20261101000100_job_photos_storage.sql) for the private job-photo storage.
   - Auth → URL configuration: set the Site URL to your app URL and add `https://YOUR-DOMAIN/auth/callback` to the redirect URLs.
   - Auth → Email: keep "Confirm email" on, and set up custom SMTP before launch (Supabase's built-in sender is rate limited).
   - Auth → Email Templates: replace the link in each template below, or invites and links opened on another device won't work. `token_hash` links work on any device; invited people and password resets are sent to choose a password first.

     | Template | Link |
     | --- | --- |
     | Confirm signup | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email` |
     | Invite user | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/onboarding` |
     | Magic Link | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink` |
     | Change Email Address | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email_change` |
     | Reset Password | `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery` |
   - Run every other file in `supabase/migrations/` in filename order. `20261104000050_hardening.sql` must be in place before this version of the code goes live: the Stripe webhook needs `stripe_events.processed_at`.
2. **Stripe** — create a Product with a recurring monthly **CAD** Price and copy its `price_...` id. Add a webhook endpoint at `https://YOUR-DOMAIN/api/stripe/webhook` for `checkout.session.completed` and `customer.subscription.created/updated/deleted`. Turn on the customer portal. Turn on Stripe Tax if you want GST/HST/PST calculated, then set `STRIPE_AUTOMATIC_TAX=true`.
3. **Claude API** — create a key at console.anthropic.com.
   - **Trial emails** — run [`supabase/migrations/20261101000200_trial_emails.sql`](supabase/migrations/20261101000200_trial_emails.sql) after the baseline. Create a [Resend](https://resend.com) account, verify your domain and add an API key. Set `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `BUSINESS_NAME` and `BUSINESS_MAILING_ADDRESS`. On Vercel, [`vercel.json`](vercel.json) runs `/api/cron/trial-emails` daily. Elsewhere, call it once a day with `Authorization: Bearer $CRON_SECRET`. Owners get five emails over the trial (days 0, 2, 5, 10 and 13), and each email has an unsubscribe link.
4. Copy `.env.example` to `.env.local` and fill it in.
5. Install and run:

```bash
npm ci
npm run dev
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build (type-checked) and server |
| `npm test` | Unit tests, plus row-level-security tests that run the real migration on embedded Postgres |
| `npm run typecheck` | TypeScript only |
| `npm run db:generate` | Regenerate the migration after editing `lib/modules.ts` (tests fail if you forget) |

## Adding or changing a module

Edit `lib/modules.ts`, run `npm run db:generate`, then `npm test`. The generator rewrites two files: the baseline for a new database, and `20261104000000_registry_sync.sql`, the same tables, columns, policies and links written so they can run on a database that already has them. Never re-run the baseline on a live database.

A migration tool runs each filename once, so a database that has already recorded the sync won't pick up a later change to it. For that database, paste the regenerated sync into the SQL editor, then re-run every hand-written migration after it, because the sync puts back the generated policies and triggers on module tables.

## Install as an app

- **Windows:** create `.env.local`, then run `install-desktop-shortcut.ps1` once; the "TradeQuote PRO" shortcut starts the server on this computer only (`127.0.0.1:3001`) and opens the app window. Add `http://localhost:3001/auth/callback` to Supabase's redirect URLs. Scheduled jobs don't run from the desktop app; they run on the deployed host, and the desktop app shares that host's Supabase project.
- **Android / iPhone:** once deployed on HTTPS, open the site and choose *Install app* (Chrome) or *Share → Add to Home Screen* (Safari).

## Before you sell it

These need you, not code:

- Finish the **Privacy Policy** and **Terms** in `app/legal/` with a Canadian lawyer (PIPEDA, liability, data location).
- Business entity, Stripe account verification, GST/HST registration.
- Production hosting (e.g. Vercel) and a paid Supabase plan with backups (point-in-time recovery).
- An independent security review / penetration test.
- A licence from CSA if the assistant should quote Canadian Electrical Code text (today it summarizes and cites, never reproduces).
- Supplier price feeds: most Western Canada distributors only share pricing per account — arrange price-file exports with your reps.
