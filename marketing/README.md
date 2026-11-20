# TradeQuote PRO launch and outreach kit

Written 2026-11-18 for the week the regional cost engine, trade calculators, free /tools pages, AI estimator, AI assistant and /demo go live. Content only. Everything here is a draft for the owner to check and send.

## Before you publish anything

1. **Price.** `lib/plan.ts` says $299 CAD per month, a placeholder. Every price in this kit is marked "confirm before publishing". The founding offer (40% off for as long as they stay, first 25 companies, about $179.40 a month) is on only if `FOUNDING_OFFER.enabled` is true and the Stripe coupon exists. If you turn it off, delete the offer lines (search this folder for "founding").
2. **Claims.** Only claim what the product does today. The old sales files in `sales/` and parts of `README.md` list features as "not built" or show three plan tiers ($99/$299/$699). Those are out of date for this launch and for `lib/plan.ts` (one plan). This kit follows the launch brief and `lib/plan.ts`.
3. **Proof.** There are no testimonials, customer counts, ratings, awards or savings numbers in this kit. Where proof would go it says `[PROOF NEEDED: ...]`. Leave it blank until a real customer gives written permission.
4. **Legal.** Privacy Policy and Terms are drafts (README). The data-location answer is a placeholder. Get a Canadian lawyer to look at the email sequences and claims. This kit is not legal advice.
5. **Placeholders** used throughout: `{site_url}`, `{owner_name}`, `{owner_title}`, `{business_name}`, `{mailing_address}`, `{support_email}`, `{unsubscribe_link}`, `{first_name}`, `{company}`, `{trial_link}`, `{city}`.

## Order of use

| Step | When | File | What you do |
|---|---|---|---|
| 1 | Day -3 to 0 | `outreach-playbook.md` (compliance box, setup section) | Set up lead capture, sender domain, mailing address, unsubscribe handling |
| 2 | Day 0 | `listings.md` | Free listings first (Google Business Profile, LinkedIn, AlternativeTo, SaaSHub) |
| 3 | Day 0 | `press-release.md`, `social-posts.md` (day 1 to 3) | Publish the release, start the 30-day calendar |
| 4 | Day 1 | `video-script.md` | Record the 30-second promo, post the vertical cut |
| 5 | Day 1 | `email-sequences.md` (a) | Switch on free-tools lead nurture for people who opt in |
| 6 | Day 1 to 7 | `outreach-playbook.md` | Daily routine, first outreach to published business addresses (sequence c) and partners (sequence d) |
| 7 | From first trial | `email-sequences.md` (b), `demo-call-script.md`, `objection-handling.md` | Convert trials. Offer the 20-minute demo |
| 8 | Week 2 | `listings.md` (Capterra, G2, Product Hunt) | Only once the trial and demo are working |
| 9 | Week 3 to 4 | `listings.md` (Microsoft Store, Google Play; Apple only after checks) | Store packages |
| 10 | Always | `faq.md`, `one-pager.md` | Send when someone asks |

## Files

- `listings.md`: paste-ready copy and fields for 11 platforms, with limits checked 2026-11-18.
- `social-posts.md`: 30-day calendar, LinkedIn, Facebook, short video, X, Reddit rules.
- `email-sequences.md`: four sequences, CASL-compliant (checked against CRTC and ISED guidance).
- `outreach-playbook.md`: first 10 paying customers in 30 days.
- `video-script.md`: 30-second promo, shot list, 15-second vertical cut, 3 hooks.
- `one-pager.md`, `press-release.md`, `faq.md`, `demo-call-script.md`, `objection-handling.md`.

## What I could not verify

- Numeric field limits on Capterra, G2, SaaSHub, Microsoft Partner Center.
- Current subreddit and Facebook group rules (they change; read each group's rules on the day).
- Apple guideline 4.2 text and Apple's rules on external payment links for Canada.
- Google Play testing requirements for new accounts.
- Competitor prices (use `sales/market-and-positioning.md`, dated 2026-11-07, and re-check before quoting any).
- Whether each NEW feature behaves as described in production. Click through each one before posting.
