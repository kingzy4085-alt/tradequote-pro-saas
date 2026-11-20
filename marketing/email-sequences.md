# Email sequences

Four sequences. Contractor-to-contractor tone: plain, short, no hype. Every subject is under 50 characters. Prices are **confirm before publishing**. Nothing here is legal advice.

## CASL rules this kit follows

Checked 2026-11-18 against the CRTC FAQ and implied-consent guidance (crtc.gc.ca) and ISED's "Getting consent to send email".

1. **Consent first.** A commercial electronic message (CEM) needs express or implied consent.
   - **Express:** the person actively opted in (a signup form, an unticked checkbox they tick). The request must name your business, say what you will send, and an email asking for consent is itself a CEM, so you cannot "confirm by email" to someone with no consent. No time limit until they withdraw.
   - **Implied, conspicuous publication:** the address is conspicuously published (directly available to the public, usually found by a search engine, not only via a database query), there is no statement that the person does not want unsolicited messages, and **your message is relevant to their business role, functions or duties**.
   - **Implied, existing business relationship or inquiry:** time limited. ISED says up to 2 years after a purchase or similar and 6 months after an inquiry or application.
2. **Identify yourself in every message:** your business name (and who you send for), a current mailing address, and a phone number, email address or web address. Keep this valid for at least 60 days after sending.
3. **Working unsubscribe in every message,** free, by the same means or another practicable electronic means, valid 60 days. Action requests within **10 business days**; best practice is immediately. One clear mechanism only (the Compufinder decision criticized two competing links).
4. **No false or misleading content,** including subject lines and sender names.
5. **Keep proof:** where and when each address was found (a link and a date) or when each opt-in happened, and the exact wording they agreed to.
6. **Don't harvest addresses with software.** Collect addresses by hand from pages you can see. PIPEDA prohibits collecting email addresses with computer programs without consent (confirm with a lawyer).
7. **Limits of implied consent:** it does not cover personal emails, consumers, or addresses that came from a purchased or scraped list. The CASL rules cover SMS and social DMs too; do not text anyone.

**Sender block (use at the bottom of every message):**

```
{owner_name}, {business_name}
{mailing_address} · {support_email} · {site_url}
Don't want these emails? {unsubscribe_link}
```

**Merge fields:** `{first_name}` (use "there" for generic inboxes, but generic inboxes still need a role-relevant message), `{company}`, `{city}`, `{trial_link}`.

**Sending practice:** send from a real person at your own domain (not a free mailbox); verify SPF, DKIM and DMARC; start with a low daily volume (30 new contacts per sender a day is the figure in `sales/cold-email-sequence.md`); stop a sequence when anyone replies or unsubscribes; keep a permanent do-not-contact list.

---

## (a) Lead nurture: free tools and founding offer (express consent)

**Who gets it:** people who used a form on `/tools`, `/pricing#join` or `/demo` and **ticked the consent box**. No tick, no email.

**Form wording (checkbox unticked by default):**

> Yes, email me about TradeQuote PRO: tips for estimating and job control, product news and the founding offer, from {business_name}, {mailing_address}. I can unsubscribe at any time.

**Timing:** day 0, 2, 5, 9, 14. Plain text. Same sender block.

### a1. Day 0. Subject: `Your calculators and what's next` (31)

> Hi {first_name},
>
> Thanks for trying the free calculators. They're always at {site_url}/tools, no account needed.
>
> If you price jobs, the part I think you'll care about is that the same calculators drop priced lines straight into an estimate, using regional material prices and provincial labour rates with burden. Your own price book overrides the reference prices.
>
> The live demo walks through a whole job without signing up: {site_url}/demo
>
> {owner_name}
> {sender block}

### a2. Day 2. Subject: `One calculator tip: long runs` (29)

> Hi {first_name},
>
> One thing worth checking on any long feeder: voltage drop at your real run length, before you order cable. The conductor that carries the current isn't always the one you can use.
>
> Try yours: {site_url}/tools
>
> {Optional, true: one line about a time this mattered on a job you saw.}
>
> {owner_name}
> {sender block}

### a3. Day 5. Subject: `Proposals clients sign from a link` (34)

> Hi {first_name},
>
> Here's what happens after the estimate: the client gets a link, sees the line items at sell price, and accepts with an e-signature. No account. You see when they open it and the quote moves through a pipeline with follow-ups and a win rate.
>
> It's all in the demo: {site_url}/demo
>
> {owner_name}
> {sender block}

### a4. Day 9. Subject: `Founding spots: 40% off for life` (32)

Only if `FOUNDING_OFFER.enabled`. If not, send "What happens after you win the job" with change orders, holdback invoices and job costing.

> Hi {first_name},
>
> We're keeping {25} founding spots: {40}% off for as long as you stay subscribed, in exchange for honest feedback. That's about {$179.40} a month instead of {$299} (**confirm before publishing**).
>
> Start with the 14-day trial, no card: {trial_link}. If you want the founding price, reply and I'll send the code for checkout.
>
> {owner_name}
> {sender block}

### a5. Day 14. Subject: `Should I stop emailing you?` (27)

> Hi {first_name},
>
> That's my last scheduled note. If estimating or job costing is on your list this quarter, the trial is {trial_link}. If not, no reply needed and you can unsubscribe below.
>
> Either way, tell me one thing: what's the most annoying part of pricing a job right now? I read every reply.
>
> {owner_name}
> {sender block}

---

## (b) Trial conversion (aligned with `lib/trial-emails.ts`)

**Who gets it:** owners who started the 14-day trial. The app already sends five emails on days 0, 2, 5, 10 and 13 with these subjects: "Your TradeQuote PRO trial is on", "Bid once, print the proposal from the same record", "Get your crew logging from the truck", "What's about to expire?", "Your trial ends tomorrow". The versions below keep the same days, the same call-to-action targets and the same order, and add the launch features. **To use them, a developer must change `lib/trial-emails.ts`; I did not touch it.**

The app's emails have an unsubscribe link and a footer with the business address, as required. Trial emails are likely transactional or sent with implied consent through the signup. Ask your lawyer to confirm; keep the unsubscribe link either way.

### b1. Day 0. Subject: `Your TradeQuote PRO trial is on` (31)

> Hi {name},
>
> {company} has 14 days of full access, with no card on file. Three things take about ten minutes and show you most of what the app does:
>
> 1. Add one client in Clients.
> 2. Build an estimate for a job you bid recently. Use a calculator to add a priced line, and compare the total with the one you sent.
> 3. Invite your foreman from Settings, then Team, so they can try the daily log on a phone.
>
> Want to see it first? The live demo is at {site_url}/demo.
> Install it on your phone too: Chrome (Android) Install app, Safari (iPhone) Add to Home Screen.
>
> CTA: Open TradeQuote PRO

### b2. Day 2. Subject: `Price it, then send it from the same record` (42)

> Hi {name},
>
> Most shops build the bid in a spreadsheet and retype it into a proposal. Here the estimate holds the client, the markup and the total, so the proposal comes from the same record.
>
> Two things to try today: set your regional rates and price book overrides in settings, then open a calculator (voltage drop or conductor sizing) and drop the priced line into an estimate. Then send the proposal to yourself and accept it from the link, to see what your client sees.
>
> CTA: Start an estimate

### b3. Day 5. Subject: `Get your crew logging from the truck` (36)

> Hi {name},
>
> The app is only as good as what the field puts in. Daily logs, timecards, tailgate meetings and LOTO permits all work on a phone with big buttons.
>
> If you haven't yet, invite one foreman or electrician from Settings, then Team. Electricians only see their own timecards. They can't reach estimates or finance.
>
> CTA: Invite your crew

### b4. Day 10. Subject: `What's about to expire?` (23)

> Hi {name},
>
> The Attention panel on the Command Center flags subcontractor insurance and WCB clearances as they come up for renewal, and alerts show overdue invoices. It checks every day.
>
> Stuck on a code question? Ask the AI assistant. It answers Canadian code and construction questions and shows its sources so you can check them. It summarizes and does not replace the code or your judgement.
>
> Also worth a try: the AI estimator turns a scope or drawing into draft priced lines. Review every line before anything goes to a client.
>
> CTA: Open the Command Center

### b5. Day 13. Subject: `Your trial ends tomorrow` (24)

> Hi {name},
>
> {company}'s free trial ends tomorrow. Nothing is deleted. After that you can still sign in and read everything, but editing stops until you subscribe.
>
> Subscribing takes a minute on the Billing page: {$299} CAD a month for the whole company (**confirm before publishing**), cancel any time. If you joined the founding list, enter your code at checkout.
>
> If something got in the way, reply to this email and tell me. I'll read it.
>
> CTA: Subscribe

**Optional extra, day 16 (only if they have not unsubscribed; one email, then stop):** Subject `Still thinking it over?` (23). One paragraph, one question: "What stopped you?" Then stop.

---

## (c) Cold outreach (implied consent only)

**Use only when all four are true for that recipient:**

1. The business address is **conspicuously published** by the business itself (its own website contact page, or a directory listing they control), directly findable, not behind a database query.
2. **No statement** next to it refusing unsolicited messages ("no solicitation", "no sales emails"). If in doubt, skip.
3. The message is **relevant to their role** (an estimator, owner or operations manager at an electrical or industrial contractor).
4. You recorded the source URL and date.

If a page lists only a contact form, do not email; use the form only if it's for general inquiries and keep it relevant (best to skip). If the address is a personal email (Gmail, Outlook for a sole proprietor), treat it with extra care; CASL's business-role test is about role, but a clearly personal address is a risk. When unsure, don't send. Never send to a consumer or a residential-service customer list.

Four short emails, days 0, 4, 9 and 16. Plain text. Stop on any reply or unsubscribe.

**Do not copy prospect names, emails or phone numbers from any file into this kit. Merge them at send time from your own private list, not from `sales/*.csv`.**

### c1. Day 0. Subject: `Pricing jobs at {company}` (under 50)

> Hi {first_name},
>
> I'm {owner_name}. I build estimating software for Canadian contractors, and I'm writing because {company} is listed as an electrical contractor in {city}.
>
> We added trade calculators that drop priced lines into an estimate, using provincial labour rates. The calculators are free to try without signing up: {site_url}/tools
>
> If you price jobs, would a 20-second look be worth it? {site_url}/demo
>
> {owner_name}
> {sender block}

### c2. Day 4. Subject: `Do you retype proposals?` (24)

> Hi {first_name},
>
> Quick follow-up. Most shops build the estimate in a spreadsheet and retype it into a proposal. In TradeQuote PRO the client gets a link and accepts with an e-signature, no account.
>
> If that's a problem for {company}, the 14-day trial has no card: {trial_link}
>
> {owner_name}
> {sender block}

### c3. Day 9. Subject: `Whose WCB clearance expires next?` (32)

> Hi {first_name},
>
> One more angle for your role: sub insurance and WCB clearances lapse quietly. Alerts flag them before they expire, along with overdue invoices.
>
> If useful, I'll set up your company and rebuild one of your recent bids so you can compare our total with yours. Reply "yes" and I'll do it.
>
> {owner_name}
> {sender block}

### c4. Day 16. Subject: `Closing the loop` (16)

> Hi {first_name},
>
> I won't keep writing. If now isn't the time, no reply needed and you won't hear from me again. If it is: {trial_link}
>
> {owner_name}
> {sender block}

**Handling replies:** "Remove me": unsubscribe at once and send nothing. "How much": link to pricing and say the plan is {$299} CAD a month (**confirm before publishing**). Anyone who replies positively is now an existing inquiry (implied consent for 6 months for that inquiry).

---

## (d) Partner outreach

Three partner types. Treat these as CEMs too if they promote your product to a business: use the same consent check (published business address, role-relevant, no refusal) and the same sender block. Many associations have a "partner" or "sponsor" page that lists a contact; use that address.

### d1. Electrical supply houses (counter manager or branch manager)

Subject: `Free calculators for your counter` (32)

> Hi {first_name},
>
> I'm {owner_name}. I build estimating software for Canadian contractors. We made free calculators (voltage drop, conductor sizing, conduit fill and more) that contractors can use without signing up: {site_url}/tools
>
> Would you be open to putting a small card or QR code at the counter? I'll print it, and there's nothing to install on your side. I'm not asking you to endorse anything.
>
> Can I drop off 50 cards on my next trip to {city}?
>
> {owner_name}
> {sender block}

Follow-up (day 7), Subject `Counter cards, {city}` (20): "Quick follow-up. I can mail the cards if easier. Reply with the branch address."

### d2. Provincial electrical contractor associations (ECA BC, ECAA, ECAO, MECA, CECA and others)

Subject: `Free estimating tools for members` (33)

> Hi {first_name},
>
> I'm {owner_name} of {business_name}. We make TradeQuote PRO, estimating and job-control software for Canadian electrical contractors, with a free set of trade calculators at {site_url}/tools.
>
> Two ideas, either or both:
> 1. A short talk or live demo for your members (20 minutes, no pitch deck).
> 2. A member offer: the 14-day trial, plus {the founding price, if you want to offer it to members} (**confirm before publishing**).
>
> I'd also welcome your feedback on what members need. Is there a member-services contact I should speak with?
>
> {owner_name}
> {sender block}

### d3. Trade schools and apprenticeship programs (instructors, program coordinators)

Subject: `Free calculators for apprentices` (32)

> Hi {first_name},
>
> I'm {owner_name}. I build estimating software for Canadian contractors. Our trade calculators (voltage drop, conductor sizing, conduit and box fill, motor circuits and others) are free to use without an account at {site_url}/tools, and I'd be glad for your instructors to try them in class.
>
> They show the working so students can check the answer. I can answer instructor questions or fix anything that doesn't match your course material. Is there a good time to send a short demo link?
>
> {owner_name}
> {sender block}

**Rules for partners:** no kickbacks to a counter staff member without telling their employer; don't imply endorsement; send the calculators as free first, product second; say plainly what you want.

---

## Subject-line check

All subjects above are under 50 characters (the longest, `Price it, then send it from the same record`, is 42). Re-count if you edit.

## Sources

CRTC "Frequently Asked Questions about Canada's Anti-Spam Legislation" and "Guidance on Implied Consent" (crtc.gc.ca); ISED "Getting consent to send email" (ised-isde.canada.ca); Gowling WLG "Doing Business in Canada: CASL" (2024-10-04); American Bar Association summary (2016). Read 2026-11-18.
