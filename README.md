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
2. **Stripe** — create a Product with a recurring monthly **CAD** Price and copy its `price_...` id. Add a webhook endpoint at `https://YOUR-DOMAIN/api/stripe/webhook` for `checkout.session.completed` and `customer.subscription.created/updated/deleted`. Turn on the customer portal. Turn on Stripe Tax if you want GST/HST/PST calculated, then set `STRIPE_AUTOMATIC_TAX=true`.
3. **Claude API** — create a key at console.anthropic.com.
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

Edit `lib/modules.ts`, run `npm run db:generate`, then `npm test`. For a database that's already live, write a follow-up migration with the `alter table` changes rather than re-running the baseline.

## Install as an app

- **Windows:** run `install-desktop-shortcut.ps1` once; the "TradeQuote PRO" shortcut starts the server and opens the app window.
- **Android / iPhone:** once deployed on HTTPS, open the site and choose *Install app* (Chrome) or *Share → Add to Home Screen* (Safari).

## Before you sell it

These need you, not code:

- Finish the **Privacy Policy** and **Terms** in `app/legal/` with a Canadian lawyer (PIPEDA, liability, data location).
- Business entity, Stripe account verification, GST/HST registration.
- Production hosting (e.g. Vercel) and a paid Supabase plan with backups (point-in-time recovery).
- An independent security review / penetration test.
- A licence from CSA if the assistant should quote Canadian Electrical Code text (today it summarizes and cites, never reproduces).
- Supplier price feeds: most Western Canada distributors only share pricing per account — arrange price-file exports with your reps.
