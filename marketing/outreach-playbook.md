# Outreach playbook: first 10 paying customers in 30 days

Goal: 10 companies paying after their trial, by Day 30. Price: {$299} CAD a month (**confirm before publishing**); founding 40% off for the first {25} if enabled.

**Honest framing.** Ten paying customers in 30 days is a stretch target, not a forecast. All numbers below marked "assumption" are planning guesses. Replace them with your real rates after week 2.

## 1. Who to target

**Primary (weeks 1 to 4):** electrical and industrial contractors with **3 to 30 staff** in **Western Canada** (BC, AB, SK, MB). Owners, operations managers and estimators.

Good signs (public info only): bids shutdowns, plant maintenance or commercial work; has a "Safety" or "COR" page; lists project work; posts jobs for estimators or project coordinators; is a member of an electrical contractor association.

Walk away (wish them well): residential service shops with a dispatch board and many trucks (ServiceTitan and Jobber fit them better), GCs who need owner and architect collaboration, firms needing live accounting sync or a construction ERP, and estimators who need PDF takeoff on screen. Do not claim features we lack.

**Secondary:** general trades (concrete, framing, drywall, roofing, flooring, insulation) via the calculators, using the free /tools pages. These are inbound, not outbound.

## 2. Where they are

| Place | How to use it | Consent notes |
|---|---|---|
| Provincial electrical contractor associations: ECA BC, ECAA, ECAO, MECA, CECA | Ask for a 20-minute member demo, an article, or a newsletter mention. Attend one event | Treat the association as the sender's partner; do not email members from a roster you don't own |
| Electrical supply house counters | Counter cards with a QR code to `/tools`; one conversation a week with a counter manager | Cards are in-person, not electronic |
| Trade shows and local events | Walk the floor, ask three questions, collect business cards with permission; follow up from cards only once the person gave you the card (implied consent through a business card, relevant to role) | Note the date and where you met |
| Facebook groups | Be useful first; share the free calculators only where rules allow (see `social-posts.md`) | |
| LinkedIn | Connect with a short note; post from the owner profile | Connection notes limit 300 characters |
| Local SEO | Google Business Profile, a city page per major city if you have a real reason, free calculator pages that rank on their own | |
| Directories (Capterra, G2, AlternativeTo) | Slow; do them in week 1 for the long game (`listings.md`) | |
| Your own network | Ask every contractor you know for two introductions | Strongest channel; costs nothing |

## 3. The free-calculator lead-magnet loop

```
Contractor finds a calculator (Google, a counter card, a group post, a QR code)
  -> uses it free at /tools, no account
  -> sees the line "Add this to an estimate" and a soft prompt: "Want the other calculators and a demo? Join the list."
  -> opt-in form with unticked consent box (wording in email-sequences.md)
  -> sequence (a): five emails over 14 days
  -> demo at /demo, then trial
  -> trial sequence (b)
  -> demo call (`demo-call-script.md`)
  -> paid
```

Rules: the calculator stays free and fully usable without an email. No gating. Capture only name, email and company; the consent box is not pre-ticked. Log source (which page, which date) in the lead record. Do not put calculator answers behind a form.

**Page-level tasks (for a developer; I did not touch code):** consent checkbox on the /tools opt-in; UTM tags on every shared link; one landing page per calculator that answers the query ("voltage drop calculator Canada") in plain language.

## 4. Referral offer

Offer to every paying customer after day 30 of paid use, and to every trial user who asks:

> Know another contractor who'd use TradeQuote PRO? When they subscribe, you both get {one month free / a credit equal to one month} (**decide and confirm before publishing; I have not checked Stripe supports the mechanism you choose**).

Rules: the new customer must be their own business; you can't refer yourself; no payment for reviews; do not email the referred person unless the referrer gave you their contact and **they** consent (a CASL point: the referrer should forward your message, or you should email only with the referred person's address given by them with context, which carries implied consent only where they gave you the address themselves). The simplest safe route: give the referrer a link or a short text to forward.

## 5. Daily and weekly routine

Time budget: about 2.5 hours a day. Counts are targets, not guarantees.

**Daily (Monday to Friday)**

| Activity | Count | Time |
|---|---|---|
| Hand-research and send cold emails (sequence c) to businesses that pass the four-point CASL check | 15 new contacts a day (cap at 30 per sender, per `sales/cold-email-sequence.md`) | 45 min |
| Follow-ups due (steps 2 to 4 of c) | all due | 20 min |
| Replies, demos and trial check-ins | all | 45 min |
| One social post (calendar in `social-posts.md`) and 10 helpful comments | 1 + 10 | 20 min |
| Partner touch (supply house, association, school) | 2 | 20 min |
| Log everything in the CRM | all | 10 min |

**Weekly**

| Day | Activity |
|---|---|
| Monday | Set the week's targets; research 75 contacts; clear the do-not-contact list |
| Tuesday | Visit two supply house counters in person (or call) |
| Wednesday | One 20-minute demo slot block; post a long LinkedIn piece |
| Thursday | Trial check-ins: for each trial in day 5 to 10, a personal message |
| Friday | Review metrics; update the objection log; thank every replier |

## 6. What to automate and what stays manual

| Step | Automate? | Concrete tool choice |
|---|---|---|
| Lead capture (calculator opt-in, founding list, demo requests) | Yes | The app's existing lead form writes to the `leads` table and emails `OPERATOR_EMAIL` (README). Add a consent checkbox and a source field |
| Welcome and nurture emails (sequence a) | Yes | Resend (already in the stack) or a mailing tool such as MailerLite or Mailchimp; the tool must hold the unsubscribe list. Verify pricing yourself |
| Trial emails (sequence b) | Already automated | `/api/cron/trial-emails` (days 0, 2, 5, 10, 13); update copy in `lib/trial-emails.ts` |
| Follow-up reminders | Yes | A CRM task: HubSpot free CRM or Google Sheets plus Google Calendar reminders. Create a task "follow up" 4 days after each send, 9 days, 16 days |
| Meeting booking | Yes | Google Calendar appointment schedule or Cal.com (free tier; verify) |
| Unsubscribe handling | Yes, strictly | One list across all tools; a single "do not contact" sheet; act within 10 business days, ideally the same day |
| Cold email sending | Semi | Send from a normal mailbox with a mail-merge add-on, throttled; never a bulk blaster |
| Reply handling, demos, discovery | **Manual** | Personal. Speed matters most |
| Choosing who to contact | **Manual** | Check each address against the four-point test |
| Social posting | Optional | Schedule posts, but reply manually |
| Reddit and Facebook groups | **Manual** | Never automate |
| Review requests | **Manual** | Only to real users, one request each |

## 7. Metrics and targets (assumptions)

Funnel math, with an assumption you must replace:

- 10 paying customers
- If 40% of trials convert (assumption; replace it after the first 10 trials), you need 25 trials.
- If 1 in 8 outreach contacts opts into a demo or trial (assumption), you need about 200 contacts.

Track weekly in a sheet:

| Metric | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| Calculator sessions (analytics) | | | | |
| Opt-ins | | | | |
| Cold emails sent | | | | |
| Replies (positive / negative) | | | | |
| Demos held | | | | |
| Trials started | | | | |
| Trials active at day 7 | | | | |
| Paying | | | | |
| Unsubscribe / spam complaints | | | | |

**Leading targets (assumptions):** week 1: 75 contacts, 5 replies, 2 demos; week 2: 150 contacts, 6 trials; week 3: 15 trials running, first 3 paying; week 4: 25 trials started, 10 paying.

**Health checks:** unsubscribe rate under 2% and spam complaints near zero (if not, stop and fix targeting); positive replies over 3% of sends (assumption); time-to-first-reply under one business day.

**Learning loop:** after 20 conversations, write down the top three reasons for "no" and the top three for "yes". Update `objection-handling.md` and the first line of the cold email.

## 8. The first 30 days

| Days | Focus |
|---|---|
| 1 to 3 | Launch listings, press release, calendar posts, video. Set up the opt-in and CRM |
| 4 to 10 | First 100 hand-researched contacts, supply house visits, one association conversation |
| 11 to 20 | Demos; first trials; personal check-ins at day 5 and day 10 of each trial |
| 21 to 30 | Convert: day-13 email, a personal call, the founding offer. Ask happy trials for a short quote **in writing, with permission to publish**, and for a Capterra or G2 review |

## 9. Compliance box

**CASL (anti-spam).** Details in `email-sequences.md`. In short: consent (express or implied), full sender identification and mailing address, a working unsubscribe, action within 10 business days, keep proof, do not harvest addresses with software, relevance to the recipient's role for implied consent through publication. Applies to email, SMS and social DMs. Penalties can be large; ask a lawyer to review before volume sending.

**Competition Act (claims).** Do not make false or misleading claims in any representation, including price, performance and comparisons. Performance claims need adequate and proper testing before you make them. This kit therefore contains no claims about savings, accuracy or speed. Do not show reviews you did not earn. Show the total price clearly. Do not call the AI accurate or code-compliant. When comparing to a competitor, use only checked, dated facts.

**Privacy (PIPEDA and provincial law).** Have a finished Privacy Policy before collecting emails. Collect only what you need; state why. Keep consent records. Answer access and deletion requests (the app has no self-serve deletion today; ask your lawyer). Store leads safely and delete old ones. State where data is stored once confirmed.

**Telephone calls.** Calling businesses by phone follows different rules (CRTC unsolicited telecommunications rules). I did not verify current requirements; check them before cold calling. Cards at a counter and in-person visits are fine.

**Other.** Reddit and Facebook have their own rules; read them. Do not use someone else's logo or name without permission.

*Not legal advice. Have a Canadian lawyer review before you send at volume.*

## 10. Public repo warning

`sales/prospect-research.csv` and `sales/prospects-western-canada.csv` hold business contact lists and sit in a public GitHub repository. Do not rely on them for sending without checking the consent test for each address, and consider removing them from the public repo (a history rewrite is needed to remove them fully).
