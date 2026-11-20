# TradeQuote PRO: where the build stands and what is left

Written 2026-11-18 at the end of a cloud build session (branch `claude/keen-bell-v8lz3z`). Read this first; paste the prompt at the bottom into the next AI session to carry on.

## 1. Save the work first (it is not on GitHub yet)

- **Nothing from today is pushed.** This session could read the repo but not write to it: GitHub refused the push (the Claude GitHub App is not installed for `kingzy4085-alt/tradequote-pro-saas`).
- **Committed locally (before the no-commit rule):** 3 commits on top of `release/v1` (`8e6cdf6`): `68fd73a` security fix, `2aed7eb` engine contracts, `a0556de` ignore agent worktrees.
- **Everything else is uncommitted** in the cloud container's working tree (51 changed or new paths), on purpose, per the owner's rule: no staging or commits unless asked.
- The cloud container is temporary. To keep the work, either:
  1. install the Claude GitHub App (https://github.com/apps/claude/installations/select_target), then tell the session "commit everything listed in BUILD_HANDOFF.md and push"; or
  2. download the archive the session sent (`tradequote-build-2026-11-18.tar.gz`), and on your computer, **on a fresh clone or new branch** (it would overwrite files in a dirty tree): `git checkout -b build-2026-11-18 origin/release/v1`, `git am commits/*.patch`, then extract the archive over the tree.
- Your local copy differs from this one: it has 24 migrations and `migration-quarantine/`. This copy also has 24; its 24th is the new `20261120000100_company_price_book.sql` (renamed from `20261118000100` because `release/v1` now has `20261118000100_harden_auth_helper_search_path.sql`). Check versions stay unique when you combine them, and keep `20261101000050_auth_helpers.sql` and `20261111000000_user_company_id.sql` quarantined.

## 2. Verified in this copy

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 56 files, 2,345 tests, all pass (was 46 files / 2,097 on `release/v1`) |
| `npm run db:check` | 24 migrations, every version unique |
| `npx next build` (dummy Supabase vars) | passed in the landing copy; **not re-run on the final combined tree** |
| Browser check | landing, /demo, /tools, /about at 1440 and 375 px: no console errors, no sideways scroll; /demo autoplay finishes in ~26 s |
| Real Claude call, real database, signed-in click-through | **not done** (no Anthropic key or database in this session) |

## 3. What was built today

**Security (committed, `68fd73a`).** Four routes on `release/v1` let any signed-in user act unchecked (`requireApi` called with `minRank: 20` and its result ignored). These were removed: `api/send-proposal` (an open email relay from your domain), `api/proposals/[id]/sms` (texted any number on your Twilio account), `api/ai/extract-scope` (uncapped AI calls) and `api/stripe/deposit-checkout` (a stub), plus the `twilio`, `resend` and `@google/generative-ai` packages. `tests/review.security.test.ts` now fails any route that ignores what `requireApi` returns.

**Cost engine** (`lib/costbook/`, uncommitted)
- 336 reference items across electrical, plumbing, HVAC, framing, drywall, insulation, concrete, roofing, paint, flooring and site rentals. Retail prices are sourced and dated 2026-11: 22 are low-confidence and flagged.
- 35 pricing regions: 13 provinces and territories plus 22 metros, each with a material factor. Ready-mix uses researched city prices; Toronto is $266/m³ against $190 in Edmonton.
- Provincial wages by trade from Job Bank, plus union rates from the IBEW agreements. Burden covers 2026 CPP/CPP2/EI (with annual caps), Quebec QPP/QPIP, vacation, statutory holidays, WCB and union packages.
- `billingRate()` suggests a charge-out: open shop is calibrated to researched ranges (about $99–122/h for an electrician); union uses its own defaults (about $128/h for AB IBEW 424).
- Sales tax is trade-aware:
  - BC, and Manitoba general trades: GST to the client; the contractor's PST is added to material cost.
  - Saskatchewan: 6% PST on the whole contract (11% total).
  - Manitoba electrical, plumbing and HVAC: 7% RST on the contract (12% total).
  - Quebec: 14.975%. HST provinces: HST.
- Company price book: `supabase/migrations/20261120000100_company_price_book.sql` repairs `material_price_book`, which had no policies, so nobody could read it. It adds unique codes, labour hours, RLS at project-manager rank and read-only for lapsed companies, and a trigger that skips the old sample insert on replays. Also added `app/api/price-book/` (GET/PUT/DELETE plus a `reference` search) and an `app/(app)/price-book` page with CSV import and export, linked in the menu.

**Calculators** (`lib/calc/`, uncommitted)
- 21 calculators:
  - Electrical: voltage drop, conductor size, conduit fill, box fill, motor circuit (CEC Tables 44/45/29, NEMA sizes), dwelling load (CEC 8-200), residential wiring takeoff, EV charger circuit, transformer sizing, lighting layout.
  - Building: concrete slab, footing/wall and piles, drywall, paint, wall framing, roofing, flooring, insulation.
  - Mechanical: heat loss (NBC design temperatures by city), water heater sizing.
- Each returns a takeoff that the cost engine prices into estimate lines.
- Spot-checked against hand calculations. A double-billed main breaker in dwelling-load was fixed, with a test.

**AI** (uncommitted)
- The assistant (`lib/assistant.ts`, `app/api/assistant`) has three new tools: `lookup_costs` (regional and company prices), `labour_rates` (burdened cost and charge-out) and `run_calculator`. Prices and wages are shown only to project managers and up.
- New "Draft with AI" (`lib/ai-estimate.ts`, `app/api/ai/estimate`, `components/estimates/ai-estimate-panel.tsx`): scope text plus up to 3 PDFs or photos become draft lines, priced by the cost engine, with assumptions, exclusions and client questions.
  - Uploads: file bytes are checked against the type, and the daily cap is spent only after the upload validates.
  - Answers: structured output, a sanitized error on failure.
  - Units: feet and metres are reconciled before a catalog price is used.

**Estimate editor** (`app/(app)/estimates/[id]/estimate-editor.tsx`, `components/estimates/`, uncommitted): adds the AI draft panel, a price-book picker, a calculator panel, a region selector, a labour-rate helper and a provincial tax helper (defaults to Electrical).

**Public site** (uncommitted): signed-out `/` shows the new landing page (middleware rewrite to `/welcome`), and the marketing pages render without Supabase settings.
- The landing page has a live quote builder with job templates.
- `/demo`: guided walkthrough; `?autoplay=1` runs about 26 s for recording.
- `/tools` and `/tools/[id]`: every calculator as a free public page with SEO metadata.
- Restyled `/about`, plus an Open Graph image, sitemap and robots.

**Go-to-market** (`marketing/`, uncommitted, 11 files): listing copy for 11 platforms, a 30-day social calendar, CASL-compliant email sequences, a first-10-customers playbook, the 30-second video script, one-pager, press release, FAQ, demo-call script and objection handling. No invented testimonials or numbers.

**Video tooling:** `scripts/record-demo-video.cjs` records `/demo?autoplay=1` at 1920x1080 and 1080x1920 and encodes MP4 with ffmpeg. Not run yet.

## 4. What is left, most valuable first

**Owner decisions and accounts (only you can do these)**
1. **Save the work**: section 1.
2. **Revoke the API key** exposed in `.continue/agents/new-config.yaml` (still in public git history). Decide whether the repo should be private. `sales/prospect-research.csv` and `sales/prospects-western-canada.csv` (contact lists) are public.
3. **Pick the production database.**
   - `TradeQuote-Pro` (us-east-1): 5 users, 37 companies, 66 estimates. It is missing migrations `20261113000110`–`140` and the new `20261120000100`. **Its history shows the two quarantined migrations (`auth_helpers`, `user_company_id`) were applied there**: review what they changed.
   - `TradeQuote-Pro-Secure` (ca-central-1): only the first 7 migrations.
4. **Fix Vercel production.** Every build fails on `NEXT_PUBLIC_SUPABASE_ANON_KEY` (missing) and `NEXT_PUBLIC_SUPABASE_URL` (not a valid https address). Remove the system variables that were uploaded as settings (`VERCEL`, `VERCEL_ENV`, `VERCEL_TARGET_ENV`, `VERCEL_OIDC_TOKEN`, `TURBO_*`, `NX_DAEMON`). Production is also behind Vercel login (SSO): add a custom domain or open production to the public.
5. **Configure the AI assistant.** Production has an `ANTHROPIC_API_KEY` variable; confirm it is a valid key. Optionally set `ANTHROPIC_MODEL` (default `claude-opus-5-5`). Add the key to Preview too if you test there. Then ask one question in the assistant and run one "Draft with AI" to confirm.
6. Price (`lib/plan.ts` $299 placeholder), the Stripe Price and founding coupon, finished Privacy/Terms, a support email.

**Code (an AI session can do these)**
1. **Final build check**: `npx next build` on the combined tree, then fix anything it finds.
2. **Landing job templates**: `components/marketing/job-templates.ts` guessed calculator field keys (`run_length`, `area`, `fixtures`). Map them to the real fields in `lib/calc/calculators/*`; until then those templates fall back to fixed lines.
3. **One price-book reader**: `lib/price-book.ts` (cost engine) and `lib/company-prices.ts` (AI) both read `material_price_book`. Merge them, and read `labour_hours` in the AI path.
4. **Record the video**: run the app (`npx next build && npx next start -p 3300` with dummy Supabase vars), then `node scripts/record-demo-video.cjs http://localhost:3300 <outdir>`. Review it, and cut the 30 s landscape and 15 s vertical versions from `marketing/video-script.md`.
5. **Screenshots** for the listings, from the live site once deployed.
6. **Company AI settings page** (not built): trade, union or open shop, pricing city, default markup and labour rate, custom instructions and a daily limit, fed into the assistant's context and tool defaults.
7. Add a 30 A 3-pole 600 V disconnect to the core catalog, so small motors don't take the 100 A switch. Also review the 22 low-confidence catalog items, the union 1.42 uplift for trades without a researched agreement, and Manitoba's union rows (ICI minimum schedule).
8. Restyle `/pricing`. `tests/support-contact.test.ts` requires its output to end in `</footer></main>`, so the wrapper must respect that. Set `metadataBase` in `app/layout.tsx`, and fill the empty space in vertical autoplay.
9. A rate-limit bucket for `/api/ai/estimate` (needs a migration; today only the daily cap applies).
10. Update `STATUS.md`, `README.md`, `HANDOFF_PROMPT.md`, `LAUNCH_LISTINGS.md` (Microsoft Store registration is now free) and `sales/*` (they still say AI estimating isn't built and show three tiers).
11. Still open from the old handoff:
    - extend `scripts/e2e-local.mjs` to the new features
    - Next.js upgrade (security advisories; `_next/image` is blocked in middleware)
    - plan tiers (owner decision)
    - client deposits (they need Stripe Connect; the old stub was removed)
12. Outreach: Gmail drafts only with your approval (CASL). No messages have been sent.

## 5. Prompt for the next session

```text
You are continuing TradeQuote PRO (Next.js 14.2 + Supabase + Stripe SaaS for Canadian contractors). Read BUILD_HANDOFF.md, then STATUS.md "Rules the test suite enforces", then AGENTS.md.

Owner rules (strict):
- Never run git add, commit, reset, clean, restore, checkout --, stash or any command that stages, discards or overwrites working-tree changes, unless the owner asks for that exact operation.
- Never move, copy, create or restore 20261101000050_auth_helpers.sql or 20261111000000_user_company_id.sql in supabase/migrations; they are quarantined in migration-quarantine/.
- Never weaken RLS, auth, permissions or tests; never edit a test just to hide a failure.
- Do not change production (Vercel settings, Supabase databases, Stripe, email) without the owner's explicit go-ahead.
- Inspect git status first and preserve unrelated changes; change only the files a task needs.

Work through BUILD_HANDOFF.md section 4 "Code" in order. After each item run `npx tsc --noEmit`, `npx vitest run` and `npm run db:check`; report results honestly. Finish with a short report of what was done, the final check results, and what is still blocked on the owner.
```
