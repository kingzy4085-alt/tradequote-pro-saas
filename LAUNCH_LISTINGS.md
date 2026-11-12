# Listing TradeQuote PRO where buyers look

Nobody but you can publish these: each one needs your own account and a live site. This file makes each listing a copy-and-paste job.

## What every platform needs first

Do these once. No store or directory will accept the app without them.

1. **A live site on your own domain.** The app is not deployed yet (see `STATUS.md`, "What is left: only the owner can do").
2. **A decided price, with Stripe live.** Listings ask for it, and `$299 CAD` in `lib/plan.ts` is still a placeholder.
3. **Finished Privacy Policy and Terms.** Every platform links to them, and today both are drafts.
4. **A support email address** that someone reads.
5. **Six to eight screenshots and a square logo.** Take the screenshots from the live site: Command Center, an estimate, the quote pipeline, a proposal as the client sees it, a daily log on a phone, job costing. Icons are in `public/`.
6. **The exposed API key revoked** (`STATUS.md`). Do not draw attention to a public repo that still has a working key in it.

## Free places to list

Fees and rules change, so confirm each on sign-up. As far as I know these were free at the time of writing.

| Platform | Why it suits this product | What it asks for |
| --- | --- | --- |
| Capterra, GetApp, Software Advice | Where contractors compare estimating and construction software. One submission covers all three. | Company details, description, category, pricing, screenshots. Paid clicks are optional. |
| G2 | The other big comparison site. A free profile lets customers leave reviews. | Description, category, screenshots, a work email. |
| Google Business Profile | Puts the business on Google Search and Maps. | Business name, address or service area, phone, website. |
| LinkedIn company page | Plant managers and owners check it before a call. | Logo, description, website. |
| AlternativeTo | People searching for an alternative to the tool they have. | Description, tags, the tools it replaces. |
| SaaSHub | Similar to AlternativeTo, with comparison pages. | Description, category, pricing. |
| Product Hunt | One day of attention from a technical audience. Good for early feedback, not for contractors. | Tagline, description, images, a launch date. |
| Microsoft Store | The app installs like a desktop program, so it can be listed as an app. Package the live site with PWABuilder. | A Partner Center developer account (check the current fee), the live URL, screenshots. |

**Not free, so not on this list:** Google Play (a one-time developer fee, plus packaging the site as an Android app) and the Apple App Store (a yearly fee, plus a native wrapper). Phone users can install the app today from the browser: "Install app" in Chrome, "Add to Home Screen" in Safari.

## What to expect

A listing makes the product findable. It does not send buyers by itself: on the comparison sites, products with recent reviews are the ones shown first. Ask your first three customers for a review on Capterra and G2 as soon as they are happy. That does more than any number of extra listings.

## Listing text, ready to paste

Check every line against the live app before you publish. Do not add a claim the app cannot back.

**Name:** TradeQuote PRO

**Tagline (under 60 characters):** Estimating and job control for electrical contractors

**Short description (under 160 characters):** Estimates, signed proposals, change orders, progress billing, job costing, timecards and safety records for Canadian industrial and electrical contractors.

**Long description:**

TradeQuote PRO is operations software built for Canadian industrial and electrical contractors. Price a shutdown or a service job with saved assemblies, add a non-productive time allowance for lockout and site orientation, and include the permit and inspection fee for your province. Send the proposal as a link: your client reads it and accepts with a signature, with no account to create.

Once the job is won, the same numbers follow it. Change orders are signed before the work starts, progress invoices handle holdback and show your GST/HST number, and job costing compares what you bid with what the job is costing, using approved timecards. In the field, crews fill in daily logs with photos, lockout/tagout permits, tailgate meetings and safety inspections from a phone, with sign-off.

Every company's data is separated in the database, and each role sees only what it should: an electrician sees their own timecards, not your margins.

**Category:** Construction estimating software. Second choice: construction management or field service management.

**Keywords:** electrical estimating, industrial electrical contractor, shutdown estimating, change orders, progress billing, holdback, job costing, lockout tagout, tailgate meeting, daily log, Canada

**Feature list:**

- Estimates with labour, material, markup and tax, built from saved assemblies
- Non-productive time allowance for lockout/tagout and orientation
- Permit and inspection fee line for your province
- Proposals a client accepts and signs from a link, with a printable signed copy
- Quote pipeline with follow-up reminders and win rate
- Change orders with client signature
- Progress invoices with holdback and GST/HST number
- Job costing against budget, from approved timecards
- Timecards with approval and payroll export
- Daily logs with job photos
- Lockout/tagout permits, tailgate meetings and safety inspections with sign-off
- Alerts for overdue invoices, expiring insurance and WCB clearances
- Five roles, from owner to electrician
- Works on a phone and installs like an app

**Pricing line:** fill in once the price is decided, for example "One plan, [price] CAD per month for the whole company. 14-day free trial, no card needed."

**Do not claim yet:** tiered plans (there is one plan), an AI assistant (built, but not yet run with a real key), offline use, accounting integration, file attachments on drawings.
