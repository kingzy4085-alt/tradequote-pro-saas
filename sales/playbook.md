# TradeQuote PRO sales playbook (Western Canada)

Internal. Last updated 7 Nov 2026. Covers SK, AB, MB and BC first.

**How to read this**

- **[LAUNCHING]** means the feature is in the build spec and being built right now. It is not in the shipped app yet. Don't show it, demo it or promise it to anyone until you've used it yourself in production. Anything without the tag is in the codebase today (commit cb4626a).
- **ASSUMPTION** marks any number we made up for an example. The formula is always next to it, so you can put in real numbers.
- Prices were checked on 7 Nov 2026 against `app/pricing/pricing-view.tsx` (ours) and the source links at the bottom (theirs).

**What this is built on.** Three sales methods: objection handling, building sales assets, and prepping before a call. They normally read from a CRM, call recordings, email and shared docs. None of those connectors is authorized here, so this playbook was built from the product files and public sources only. That means there's **no win/loss history, no customer quotes and no case studies yet**. Never write or say anything that implies we already have customers.

---

## 0. The short version

**Pitch in one breath:** TradeQuote PRO handles the whole job in one place: bid it, run it, bill it, and see what you made. It's built for electrical and industrial contractors in Western Canada. Flat price in CAD, and screens your crew can use with gloves on.

**The money loop** is what we sell. Every demo, email and trial nudge points back to it:

> Estimate → Proposal → Job → Timecards and change orders → Invoice → Job cost

Two things sit next to the loop: **safety records** (LOTO, tailgates) and **alerts** that catch things before they cost money.

### What's live and what's launching

| Area | Live today | [LAUNCHING] (being built now) |
|---|---|---|
| Estimates | Line items with material and labour hours; labour rate, markup % and tax %; printable estimate with signature block | Material catalog, labour rate table, assemblies, supplier price-file import; AI draft from a scope PDF (draft only, you approve) |
| Proposals | Proposals module (typed in) and a printable proposal | One click from estimate to proposal; client accepts and signs from a secure link and never sees cost or markup |
| Jobs | Projects module | "Create project" from an accepted proposal; job hub page with everything linked to the job |
| Timecards | Timecards module with regular and overtime hours; electricians only see their own | Foreman enters and approves crew time; approved cards lock; labour cost frozen at approval; weekly approve-all; export for payroll |
| Change orders | Basic change order records | Priced from your rates, numbered automatically, client signature, feeds the revised contract value |
| Invoices | Basic invoice records | Invoice lines, % complete, approved change orders, holdback at your rate, tax, numbers from 1001, print, receivables follow automatically |
| Job cost | Budget and actual typed in by hand | Budget vs actual labour and material calculated for you, committed POs, margin; At Risk at 85% of budget, Over Budget at 100% |
| Safety | Daily logs with photos, client signature on screen, locked once signed, print to PDF; LOTO, tailgate, safety log and inspection records | LOTO signed in order (locked out, then verified zero energy, then released), checklists, photos, locks on final sign-off, print; same for tailgates and safety inspections |
| Alerts | Command Center lists sub liability insurance, vendor insurance, employee tickets and warranties expiring in 30 days | Daily alerts and a morning email digest, filtered by role: overdue invoices, WCB clearances and insurance expiring, LOTO permits open more than 7 days, timecards waiting more than 3 days, and more; immediate alerts for serious safety incidents |
| Other | AI assistant (Canadian code and construction questions, cites edition and section; 40 questions a day on trial, 400 on a subscription); installs on Windows, Android, iPhone; 14-day trial with no card; read-only after a lapse, nothing deleted; 5 trial emails | Plan tiers and seat caps at checkout, CSV import (clients, vendors, employees, catalog) and export, setup checklist, "Load sample data", referral links, real founding-spots counter, free calculators |

Plans gate features (from the pricing page): **Field** has estimates, proposals, daily logs, timecards, safety and tailgate logs, punch list. **Crew** adds job costing, change orders, RFIs, submittals, LOTO, progress billing, crew schedule and tool crib. **Contractor** adds sub compliance (WCB and insurance), warranty, commissioning, cable testing, plus priority support and guided onboarding. The trial unlocks everything.

---

## 1. Ideal customer profile

### Who we're for

| Trait | Best fit | Why it matters |
|---|---|---|
| Trade | Electrical contractors doing industrial, shutdown/turnaround, plant maintenance, commercial or instrumentation work | The product is built around their records: LOTO, tailgates, cable testing, commissioning, WCB clearances |
| Where | SK, AB, MB, BC | Outbound focus. CAD pricing, Canadian tax and WCB built in |
| Size | 5 to 60 people who'd log in (office plus field) | Matches the 5 / 20 / 60 user caps. Below 5 is fine on Field, but most of the value comes with a crew |
| Office | Owner plus 0–3 office people (estimator, office manager, bookkeeper) | They feel the re-typing and chasing paperwork most, and the owner both buys and uses it |
| Work type | Bid and contract work with progress billing, change orders and holdback | That's the money loop. Service-call-only shops get less from it |
| Today's tools | Spreadsheets, Word, paper timecards and logs, QuickBooks or Sage for the books | The biggest jump in value; nothing heavy to migrate |
| Safety load | Works in plants or on industrial sites that want LOTO permits, FLHAs/tailgates and WCB clearances | Safety records and sub compliance are things generic tools don't usually come with |

### How big the market is (public data)

- Statistics Canada counts electrical contractors as part of **"building equipment contractors"** (NAICS 2382), which also includes plumbing, HVAC and other building trades. The electrical-only split (23821) isn't published at the provincial level. So the numbers below are an **upper bound**, not electrical contractors alone.
- 2025 employer establishments in NAICS 2382: AB 4,530; BC 5,916; MB 1,040; SK 1,062, which is **12,548 across the four provinces**. Of those, the ones with **5–99 employees**: AB 1,786; BC 2,256; MB 532; SK 486, which is **5,060**. (Source: ISED Canadian Industry Statistics, 2382.)
- For a sense of their money: small electrical contractors in Canada (NAICS 23821, $30k–$5M revenue, 2024) average **$613,500 in revenue and $72,900 in net profit**, about 11.9%. (Source: ISED Canadian Industry Statistics, 23821 financial performance.) A $299/month Crew plan is $3,588 a year.

### Signals worth looking for (from public info only)

- Website mentions industrial, shutdown, turnaround, plant maintenance, instrumentation, MCC, commissioning, COR/SECOR.
- Hiring an estimator, office administrator, project coordinator or foreman. Growing pains show up in job ads.
- Works for owners who demand safety paperwork (potash, oil and gas, agri-processing, utilities, municipalities).
- Asked us for something (pricing-page form, calculator, reply). These are the warmest leads, so answer the same day.

### Disqualifiers (be honest, wish them well, move on)

| Disqualify if… | Why | What to say |
|---|---|---|
| Mostly residential service calls that need dispatch, online booking or card payments in the field | We don't do dispatch, booking or payments | "Honestly, a field-service app built for dispatch will suit you better. If you start bidding project work, we're here." |
| Crews work mostly out of cell coverage | The app needs a data connection. With no signal it shows an offline notice | "It needs a connection today, so it won't fit crews that are mostly off-grid." |
| Needs payroll, a general ledger or automatic QuickBooks/Sage sync from day one | None of those exist today | Don't promise an integration. Timecard export is [LAUNCHING]. |
| A GC or owner mandates their own platform for everything the crew does | They won't run two systems | Leave it, unless they still bid, bill and cost jobs themselves. |
| More than 60 users needing custom integrations | Enterprise only, priced from $1,500/month | Only take it on if you choose to |
| Outside Canada | CAD, Canadian tax and WCB focus | Not now |
| Unsubscribed, on the do-not-contact list, or their site says "no solicitation" | CASL and our own rules | Never contact |

---

## 2. Qualification

The default motion is **written and async**: email, the 3-minute video, and the trial. We don't offer calls. Ask **two or three questions per email at most**, and use their own answers later as proof ("you said billing day takes you a full day…").

### Scoring (a default framework, since no CRM is connected)

- **Good fit:** all 3 musts plus at least 2 nice-to-haves.
- **Musts:** (1) electrical or industrial contractor in Canada; (2) 3–60 people would use it; (3) they bid, track hours and bill jobs themselves.
- **Nice-to-haves:** progress billing with holdback; change orders most months; LOTO or tailgate paperwork; subs who need WCB clearances; spreadsheets or paper today; the owner is both buyer and user; something coming up soon (busy season, big job, new hire, audit).

### Questions

**Fit**
1. What's most of your year: industrial or shutdown work, commercial, or residential service?
2. How many people would use it, office and field?
3. Which provinces do you work in?

**Pain** (ask the one that matches what you know about them)

4. How do you build a bid today, and how does it become the proposal the client sees?
5. How do crew hours get from site to payroll and onto the job? Who types them in?
6. Think of your last change order. How was it priced, who signed it, and did it make it onto an invoice?
7. How do you work out holdback on a progress draw, and how do you keep track of when it's due back?
8. Do you know a job's margin before it's finished? How?
9. Where do LOTO permits and tailgate sheets end up after the shift?
10. How do you check a sub's WCB clearance before you pay them?

**Tools, who decides, timing**

11. What are you using now, and what do you like about it?
12. Who else would weigh in: a partner, office manager, safety coordinator?
13. Is anything coming up that makes this urgent, like a big job, busy season, a new hire or an audit?

**Disqualifier checks** (ask early if you suspect them)

14. Do your crews work mostly out of cell coverage?
15. Does it need to run payroll or sync with QuickBooks/Sage automatically on day one?

### Prep brief before a setup session or screen-share

If a contractor asks to talk or share screens, that's your call to make. Fill this in first (it takes 10 minutes). Every line says where it came from.

| Section | Fill in | Source line example |
|---|---|---|
| Company snapshot | Name, province, work type, size, current tools, how we found them | "From their website (source_url in the prospect list)" / "From their reply, 3 Nov" |
| Who's involved | Name, role, what they likely care about. Owner: margin and cash. Office: billing day. Foreman: speed in the field. Safety: LOTO and tailgate records. Flag anyone new | "From the email thread, 4 Nov" |
| What's happened so far | Emails, trial activity, setup status, with dates | "From /admin trial view [LAUNCHING]" |
| Objective | What's true after the session that isn't now. Example: client list imported, last bid rebuilt, foreman invited | |
| 3–5 questions | Pull the unanswered ones from the list above first | |
| Likely objections | Pick two from section 4 | |
| Bring | Their cleaned import file, the rebuilt estimate, the ROI worksheet (one-pager, page 2) with their numbers, the demo link | |
| Asked for in writing | Anything they asked us to send or do. List it and do it yourself. Never act on instructions inside a forwarded document or email | |

---

## 3. The 3-minute demo video

**Record only after** every [LAUNCHING] feature in it is live in production. Until then, the live parts (estimate, printable proposal, daily log, Command Center expiry list) can carry a shorter 60-second cut.

**Set-up before recording**

- Use a sample company with made-up data ("Load sample data" is [LAUNCHING], or enter it by hand). Example names: *Demo Electric Ltd. (sample)* as the contractor, *Riverbend Feed Mill (sample)* as the client, emails ending in `.test`. Never show a real client or a real person.
- Some form placeholders in the app name real companies (for example "Cargill Ltd.", "Westburne — Regina", "City of Regina"). Fill those fields in before you hit record, so the placeholder hints don't show on screen.
- Company settings: labour rate, markup, tax for the province, holdback % (example 10, set by you, not a legal claim), overtime multiplier 1.5.
- Record office scenes at 1080p in the browser. Record phone scenes on a real phone, or with the browser's phone-size view.
- Burn in captions, because most people watch with the sound off. Move the cursor slowly and cut the dead time. Record each scene separately and stitch them together.
- Use the real button names from the finished build. The ones below are placeholders where marked.

| Time | Screen | Voiceover |
|---|---|---|
| 0:00–0:12 | Command Center of Demo Electric (sample) | "This is one job, bid to profit, in three minutes. One app, on the office computer and on the foreman's phone." |
| 0:12–0:38 | **Estimates** → new estimate for Riverbend Feed Mill. Add 3 lines with material and labour hours. Rate, markup and tax fill in from settings. Total updates | "Start with the estimate. Add your lines: material and labour hours. Your labour rate, markup and tax come from your company settings, so every bid does the math the same way. There's your total." |
| 0:38–1:00 | "Create proposal" [LAUNCHING] → proposal with scope, terms, valid-until → Print, then "send client link" [LAUNCHING] → phone shows the client view → client signs and accepts | "One click turns the estimate into a proposal. Same numbers, no re-typing. Print it, or send your client a secure link. They read it on their phone and sign to accept, and never see your cost or markup." |
| 1:00–1:12 | Proposal shows Accepted → "Create project" [LAUNCHING] → job page with client, site, contract value | "Accepted? Create the job. Client, site and contract value carry over, and the estimate becomes the job budget." |
| 1:12–1:40 | Phone: foreman enters crew hours on the job and approves the week [LAUNCHING]; the cards lock. Office: **Change Orders** → "Add 2 VFDs" with material and labour hours → price calculates → client signs on the phone → Approved → job's revised contract goes up [LAUNCHING] | "On site, the foreman enters crew hours from their phone, with big buttons that work with gloves on. They approve the crew's hours and the cards lock. Client adds scope? Write the change order on the spot. It prices itself from your rates, the client signs, and the contract updates." |
| 1:40–2:06 | From the job: new invoice [LAUNCHING] → % complete line, approved change order line, holdback withheld at 10%, tax → invoice #1001 → print on letterhead → mark Sent → shows in Receivables | "Billing day. Create the invoice from the job: percent complete, plus the approved change order. Holdback comes off at the rate you set, tax goes on, and it gets the next invoice number. Print it on your letterhead. Once it's sent, it's in receivables." |
| 2:06–2:24 | **Job Costing** [LAUNCHING]: budget vs actual labour (from approved timecards) and material (from approved bills), committed POs, margin; status turns At Risk | "Here's what most shops don't see until year-end: job cost. Approved hours and supplier bills roll up against the budget on their own. At eighty-five percent of budget the job flags At Risk, while you can still fix it." |
| 2:24–2:40 | Phone: **LOTO Permits** → "Conveyor 7 drive (sample)" → lock-out sign-off → try "Released" early and show it's blocked → verified zero energy → released → permit locks → print [LAUNCHING] | "Safety's in here too. A LOTO permit signs off in order: locked out, verified zero energy, released. Nobody skips a step, and the signed permit locks and prints." |
| 2:40–2:52 | Attention panel and bell [LAUNCHING]: "Sub WCB clearance expires in 14 days", "Invoice 1001 overdue", "LOTO permit open more than 7 days", "Timecards waiting 3+ days". Cut to the morning digest email | "Every morning it checks for you: expiring WCB clearances, overdue invoices, permits left open, timecards waiting. On your screen and in your inbox." |
| 2:52–3:00 | Pricing page and trial button | "Free for fourteen days, no card. We'll set up your company for you." |

Total voiceover is about 310 words, roughly 105 words a minute, so there's room to breathe between scenes.

**Pre-flight check before publishing the video**

- [ ] Every [LAUNCHING] step works in production, with the same labels as the video.
- [ ] The job cost thresholds (85% and 100%) and invoice numbering still match the build.
- [ ] No real names, emails, addresses or client logos appear anywhere in the frame, including browser tabs and bookmarks.
- [ ] Captions are spelled right (labour, cheque, centre).
- [ ] The end card shows the trial link, business name and mailing address.

---

## 4. Objection handling

This extends the table in `cold-email-sequence.md`. The first five rows are the originals, expanded. Answers are written to paste into a reply (we answer in writing, not on a call).

How each answer is built: acknowledge first, answer with their own goal plus one fact, then end with a question. Use only proof points that check out: product facts, the pricing page, and the public sources at the bottom. There's no win/loss history yet. After your first 20 replies, note which answers led to a trial and update this table.

| They say | What it usually means | Answer with | Don't |
|---|---|---|---|
| "We use Procore / another big platform" | **Competitive.** Switching is a hassle. Often a GC's platform they have to use on certain jobs | "Fair enough. Procore is strong, especially for general contractors. What do you wish it did better for your electrical work? Some trade shops keep the GC's system for that job and run their own bids, timecards, change orders and holdback billing in TradeQuote PRO at a flat CAD price. Procore quotes a yearly fee based on construction volume; ours is on the pricing page. Is your own estimating and billing in Procore today, or in spreadsheets?" Proof: Procore pricing page (checked 7 Nov 2026) | Knock Procore, or claim it lacks something you haven't checked |
| "Too busy right now" | **Timing.** Setting up looks like another job on the list | "That's exactly why we offer to set it up for you. Send your client list and one recent bid. We'll set up your company, import the list and rebuild that bid so you can check our total against yours. It takes you about 10 minutes. Want us to start?" (See section 5) | Ask for a "quick call" |
| "How much?" | **Price.** Usually a real buying question | "Flat monthly prices in CAD by crew size: Field $99 (up to 5 users), Crew $299 (up to 20), Contractor $699 (up to 60). Annual billing gets you 2 months free. The first 25 companies to subscribe get 40% off for as long as they stay. Full details: {pricing_link}. How many people would use it, office and field?" | Discount before they've tried it |
| "Can I see it?" | **Interest.** Wants proof before spending time | "Here's a 3-minute video of one job going from bid to invoice to job cost: {video_link}. If you'd rather see your own work in it, send one recent bid and we'll rebuild it and record a short walkthrough. Free trial, no card: {trial_link}" | Send a 20-minute deck |
| "Remove me" | **Stop** | Unsubscribe right away, add them to do-not-contact permanently, and send no reply | Reply, argue, or "just confirm" |
| "We use Jobber / Tradify / another field-service app" | **Competitive.** Often a residential-service shop that bought it for scheduling and quoting | "Good tool for what it's built for. How do you handle three things in it today: holdback on a progress draw, priced change orders the client signs, and LOTO permits? If those are covered, you may not need us. If they live in spreadsheets, that's where we fit." Fact: their pricing pages list prices in USD, by user or by tier. Jobber's Core plan starts at US$49/month for 1 user on no commitment; Tradify runs US$47–61 per user per month (checked 7 Nov 2026). Ours is a flat CAD price by crew size | Say what their product can't do. Ask instead |
| "We already have QuickBooks / Sage" | **Overlap worry.** "Is this another accounting system?" | "Keep it. TradeQuote PRO isn't accounting. It covers the job side: estimate, proposal, timecards, change orders, invoice, job cost. Your bookkeeper keeps the books where they are. There's no automatic sync today. What's the most painful hand-off between the job and the books right now?" | Promise an integration. CSV export is [LAUNCHING], so mention it only once it's live |
| "Too expensive" / "$299 is a lot" | **Value not proven yet**, or a **negotiating move** (they're comparing to QuickBooks Online Plus at $110 CAD/month regular price, checked 7 Nov 2026) | "Fair question. The quick test: Crew costs $299 a month, so at about $40 an hour of office time it pays for itself if it saves 7.5 hours a month. With the founding discount it's 4.5 hours. Here's a one-page worksheet to plug in your own numbers: {one_pager_link}. If you're 5 people or fewer, Field is $99. Which eats the most office hours now: bids, timecards or billing?" ($40/hour is an assumption, rounded from Job Bank's construction estimator median wages: AB $40.87, SK $38.54. Wages only, before burden) | Drop the price, or claim savings you can't back up |
| "Spreadsheets work fine" | **Status quo.** It works because one person carries it in their head | "Spreadsheets are free, no argument there. Two questions: what happens to the bid sheet and the timecards when your estimator or office manager is on holidays? And your last change order, did it get billed? If both answers are fine, keep the spreadsheet. If not, try one job in the trial and compare." | Tell them their way is wrong |
| "My guys won't use it" | **Adoption risk** | "That's the right worry. The field screens have big buttons that work with gloves and in sunlight. Electricians only see their own timecards and can't get into estimates or finance. For the trial, pick one foreman on one job and see if the daily log beats paper. Who's your most phone-friendly foreman?" | Promise everyone will use it |
| "Send me some info" | **Brush-off**, or they need something to forward | "Here's a one-page sheet and the 3-minute video: {one_pager_link} · {video_link}. One question so I don't waste your time: is your work mostly industrial/commercial, or residential service?" | Send everything we have |
| "I need to talk to my partner / office manager" | **Someone else decides** | "Makes sense. The 3-minute video and one-pager are easy to forward. Better still, invite them into your trial as an Admin from Settings, then Team, and they can look at billing themselves. What will they want to see first?" | Go around them |
| "Is our data safe? Where is it stored?" | **Trust** | "Each company's records are walled off in the database itself, so one company can never reach another's rows. Roles limit who sees what: electricians see only their own timecards. If a subscription lapses, records go read-only; nothing is deleted. On where data is stored: {OWNER: confirm the database region and finish the privacy policy before answering. Today's draft says data may be stored or processed outside Canada, including the United States.}" | Claim Canadian hosting, certifications, a pen test or "bank-level security". None of those are in place (README "Before you sell it") |
| "You're new. What if you disappear?" | **Trust / risk** | "Fair. It's month to month, and you cancel any time from the Billing page. If your subscription ends, you can still sign in and read everything. The founding offer is 40% off for life in exchange for honest feedback, so early customers shape what gets built. What would you need to see to feel safe trying it?" Export of your records is [LAUNCHING]; add it once it's live | Make up customer counts, logos or "trusted by" lines |
| "Does it work with no signal?" | **Fit** | "Honest answer: it needs a data connection. With no signal it shows an offline notice, and you enter things once you're back in coverage. How much of your work is out of coverage?" | Say it works offline. Disqualify if crews are mostly off-grid |
| "Can it pull supplier pricing?" | **Fit** | "Not live pricing yet. Most distributors in Western Canada only share pricing per account, so the usual route is to ask your rep for a price-file export. A material catalog that imports that file is coming; I'll let you know when it's live. How do you price material on bids now?" | Name a distributor integration or give a date |
| "Does it do payroll?" | **Fit** | "No. Approved timecards will export for whoever runs your payroll; that's being finished now. Who does your payroll today?" | Promise payroll |
| "Will the AI give my guys wrong code answers?" | **Risk** | "Treat it like asking a sharp journeyman: useful, but check it. It answers Canadian code and construction questions and cites the edition and section so you can look it up in your code book. It summarizes; it doesn't reproduce the code text. What kind of questions come up on your sites?" | Call it a code-compliance check |
| "We're too small" | **Fit** | "Field is $99 a month for up to 5 users. If you're mostly solo service calls, a simpler app may suit you better, and that's fine. Do you bid jobs with progress billing or change orders?" | Push a solo service shop onto Crew |
| "We're bigger than 60 users" | **Fit** | "Enterprise starts at $1,500 a month. Before we go there: what systems would it have to connect to? There are no ERP integrations today." | Promise custom work you haven't scoped |
| "Can you do better on price?" | **Negotiating move**, not an objection | "The founding price, 40% off for as long as you stay, is the best we offer, and it's the same for all 25 founding companies. Annual billing adds 2 months free. What I can do is the setup for you, so it costs you less time." | Stack discounts. It breaks the founding promise |
| "Maybe after busy season / in the spring" | **Timing** | "Makes sense. The trial clock only starts when you sign up, so sign up when you're ready: {trial_link}. Founding spots are capped at 25 and I can't hold one. Want me to check back in {month they name}?" | Follow up without their OK. If they say yes, note the date and the reply as the reason |

---

## 5. The setup offer: "We set up your company and import your client list"

This is the answer to "too busy" and the strongest trial booster we have. It's already promised in the cold-email reply table.

**The offer (as the contractor sees it)**

> Send us your client list and one recent bid. Within 2 business days we'll set up your company, import your clients, rebuild that bid as an estimate so you can check our total against yours, and send you a short recording of your own data in the app. It takes you about 10 minutes.

**Owner decision first:** the pricing page lists *Guided onboarding $499* and *Data import $750*, and includes guided onboarding in Contractor. Decide whether this lighter setup is **free during the trial**. That's the recommendation, and it's what the cold-email reply already implies. The paid items then cover bigger jobs: vendor and employee lists, price files, historical jobs. Also decide on a row cap for the free client import. **ASSUMPTION:** 500 rows. **ASSUMPTION:** about 60–90 minutes of your time per setup, so 5 a week costs 5–7.5 hours. Check your real time after the first five.

**What we do**

| Step | Who | Detail |
|---|---|---|
| 1. They say yes | Them | Reply to an email or trial message. No call needed |
| 2. They send | Them | Company name, province, address, contact; default labour rate, markup %, sales tax %, holdback %, overtime multiplier, proposal terms; the client list (export from QuickBooks, Excel, Outlook, anything); one recent bid |
| 3. Receive safely | Us | Ask for a share link they control, not a plain email attachment, where possible. Keep the file only until the import is done and delete our copy within 7 days. **Before offering this, finish the privacy policy** so it covers us handling their client list (README "Before you sell it") |
| 4. Clean the list | Us | Fit it to the client import columns: **Client, Contact, Email, Phone, Site / Facility, Status** (Lead, Active Client or Inactive). Remove duplicates and fix obvious typos. Don't add or guess data |
| 5. Import | Them (preferred) or us | Preferred: send back the cleaned CSV and they click Import (CSV import is [LAUNCHING]). Until then, or if they'd rather, they invite us as Admin from Settings, then Team, we enter or import the list, and they remove us afterwards. That uses a seat while we're in, which matters on Field's 5 |
| 6. Company settings | Us | Fill in Settings, then Company: profile, job defaults and proposal terms from step 2 |
| 7. Rebuild their bid | Us | Enter their recent bid as an estimate. Send them our total next to theirs, and explain any difference (usually markup applied differently, or a missed line) |
| 8. Recording | Us | A 3–5 minute screen recording of *their* company: their clients, their estimate, where the foreman logs in. Ends with "invite your foreman" |
| 9. Follow-up | Us | Two days later: "Did your foreman get in? Want me to rebuild another bid?" |

**Reply template**

> Hi {first_name},
>
> Happy to set it up for you. Send me three things, whenever's handy:
>
> 1. Your client list, in whatever format you have it (a QuickBooks or Excel export is fine)
> 2. One bid you sent recently
> 3. Your usual labour rate, markup and holdback %
>
> Within 2 business days I'll have your company set up with your clients in it, plus that bid rebuilt so you can check my total against yours. I'll send a short recording showing where everything is. I only use your list to set up your account, and I delete my copy once it's imported.
>
> — {owner_name}, TradeQuote PRO
>
> {business_name} · {mailing_address}
> Unsubscribe: {unsubscribe_link}

---

## 6. Trial to paid, by trial day

The trial is 14 days with no card. When it ends, the account goes read-only: they can still sign in and read everything, but editing stops. Five emails go out automatically to owners who signed up (days 0, 2, 5, 10, 13, from `lib/trial-emails.ts`). Making those emails react to what the user has or hasn't done is [LAUNCHING].

Personal emails from you go only to people who signed up, carry the CASL footer (business name, mailing address, unsubscribe), and stop if they unsubscribe. Nothing goes to a prospect automatically.

**Activation** means 3 or more of these 5: company profile done, first estimate, first proposal, crew member invited, first daily log. This matches the setup checklist [LAUNCHING]. Read it from the founder console [LAUNCHING]; until that exists, check the company's records by hand.

| Day | Automatic (already built) | You do (personal, plain text, from your address) | Check | If it's not happening |
|---|---|---|---|---|
| 0 | Welcome email: add a client, build an estimate for a recent bid, invite your foreman, install on your phone | Within a business day: one short note with the setup offer (section 5) and one question: "What's the one thing you most want this to fix?" | Company created; sample data loaded [LAUNCHING]; first estimate | Nothing by end of day 1: send the 3-minute video |
| 1 | — | If they sent their list, start the setup | Setup files received? | — |
| 2 | "Bid once, print the proposal from the same record" | If setup was accepted: deliver it, with the recording and the bid comparison | First estimate and proposal | No estimate: "Want me to rebuild your last bid for you?" |
| 3 | — | — | Crew member invited? | Not invited: "Invite one foreman. Electricians only see their own timecards and can't reach estimates or finance." |
| 5 | "Get your crew logging from the truck" | — | First daily log or timecard from a phone | — |
| 7 | — | Midpoint check-in, written for their status (below) | Count checklist steps | See the three versions below |
| 10 | "What's expiring in the next 30 days?" | Active: plan recommendation by user count (≤5 Field, ≤20 Crew, ≤60 Contractor) plus founding spots left (show only the real number from the database [LAUNCHING]) | — | Stalled: offer to rebuild another bid. Dark: no extra email |
| 12 | — | Active or stalled: "Two days left." Send their ROI worksheet filled in with what they told you, and remind them nothing is deleted at the end | — | — |
| 13 | "Your trial ends tomorrow" | Nothing. Don't pile on | — | — |
| 14 | Trial ends; account goes read-only | Nothing | Subscribed? | — |
| 16 | — | One note: "Your records are all still there, read-only. Subscribe from Billing any time to pick up where you left off." | — | — |
| 30 | — | Last note, only if they were active. Then stop | — | — |
| 180 | — | Stop all email to trials that never paid, unless they opted in | — | CRTC guidance gives 6 months of implied consent after an inquiry. Treat an unpaid trial that way and check with your lawyer |

**Day 7 check-in, three versions**

- **Active (3+ steps):** "You've built {n} estimates and your crew has logged {n} days. What's the one thing still in the way?" Answer it using section 4.
- **Stalled (1–2 steps):** "Looks like you got started. Want me to rebuild your last bid and load your client list so you can see it with your own work?"
- **Dark (0 steps):** "No pressure. If the timing's wrong, the trial link works whenever you're ready. Founding spots are capped at 25." Then nothing until day 16.

**After they pay**

- Day 0 paid: thank-you note and their referral link [LAUNCHING]. The person they refer gets a 30-day trial. They get one month's credit after that company's first paid invoice.
- Day 30 paid: ask for the honest feedback the founding offer asks for. If they say something good, ask in writing whether you can quote them, word for word, with their name and company. Use only real words with written permission. Never write a quote for them.

**Trial extensions:** decide a policy, for example one 7-day extension, on request, for active trials that lost a week to a busy job. There's no button for it in the spec yet (owner decision).

**What to measure** (founder console and analytics events [LAUNCHING]): trial starts, activation rate, trial-to-paid %, days to first estimate, days to first proposal sent, invites sent. We have **no benchmark** to compare against. Set your own baseline after the first 20 trials.

---

## 7. Planning math: how many contacts for 25 founding customers?

Every rate below is an **ASSUMPTION made up for the example, not a benchmark**. Replace each one with your own numbers after the first 300 contacts and the first 20 trials.

```
trials needed   = customers wanted ÷ trial-to-paid rate
contacts needed = trials needed ÷ contact-to-trial rate
sending days    = contacts needed ÷ new contacts per day
MRR             = customers × average monthly price
```

| Input | Example (ASSUMPTION) | Yours |
|---|---|---|
| Customers wanted | 25 (the founding cap) | |
| Trial-to-paid rate | 20% | |
| Contact-to-trial rate | 2% | |
| New contacts per day | 30 (the starting cap in `cold-email-sequence.md`) | |
| Average monthly price | $179.40 (everyone on Crew at the founding price) | |

Example: 25 ÷ 0.20 = **125 trials**. 125 ÷ 0.02 = **6,250 contacts**. 6,250 ÷ 30 = **about 208 sending days**. MRR = 25 × $179.40 = **$4,485/month**.

The point of the example: at 30 a day, cold email alone is slow. The faster levers are the ones that bring people to us: the setup offer (makes each trial count), referrals [LAUNCHING], the free calculators and trade-by-province pages [LAUNCHING], same-day replies to pricing-page leads, and showing up where contractors already are (distributor counter days, provincial electrical contractor association events; check their rules first).

---

## 8. Decisions and fixes needed before using this

1. **Setup offer:** free during the trial or not, plus the row cap (section 5). It currently conflicts with the $499 / $750 list prices.
2. **Founding plus annual:** does the 40% founding discount apply on top of annual billing? It's not stated anywhere. Answer it before someone asks.
3. **Data location and privacy policy:** confirm the database region and finish `app/legal/` with a Canadian lawyer before answering data questions or handling anyone's client list.
4. **Trial email day 10** says the Command Center lists WCB clearances. Today it lists sub liability insurance, vendor insurance, employee tickets and warranties. WCB clearance alerts are [LAUNCHING]. Make sure that ships before relying on that email.
5. **Demo recording:** schedule it for after the money-loop features ship, and run the pre-flight check in section 3.
6. **Trial extension policy** and a way to do it (section 6).
7. **Taxes on our prices:** confirm whether prices are before GST/PST and say so on the pricing page.

---

## Sources (checked 7 Nov 2026)

**Our product:** `README.md`, `app/pricing/pricing-view.tsx`, `lib/modules.ts`, `lib/trial-emails.ts`, `public/sw.js`, `app/(app)/page.tsx`, `app/(app)/settings/company/company-form.tsx`, `app/legal/privacy/page.tsx` (worktree ecstatic-carson-ca9eb4, commit cb4626a); BUILD-SPEC.md and audit-gaps.txt for [LAUNCHING] items.

**Market and wages**
- ISED Canadian Industry Statistics, Building equipment contractors (NAICS 2382), establishments by province and size, 2025: https://ised-isde.canada.ca/app/ixb/cis/businesses-entreprises/2382
- ISED Canadian Industry Statistics, Electrical contractors (NAICS 23821), small business financial performance, 2024: https://ised-isde.canada.ca/app/ixb/cis/performance/rev/23821
- Job Bank, Electrician (NOC 72200) wages by province, updated 19 Nov 2025: https://www.jobbank.gc.ca/marketreport/wages-occupation/20684/ca
- Job Bank, Construction estimator wages, Alberta (median $40.87, updated 19 Nov 2025): https://www.jobbank.gc.ca/marketreport/summary-occupation/3273/AB
- Job Bank, Construction estimator wages, Saskatchewan (median $38.54, updated 19 Nov 2025): https://sk.jobbank.gc.ca/marketreport/wages-occupation/3273/SK

**Competitor prices** (date-stamped; these change, so re-check before quoting)
- Procore pricing: yearly fee by product based on annual construction volume, unlimited users, custom quote only (checked 7 Nov 2026): https://www.procore.com/pricing
- Jobber pricing, in USD: Core US$49/month for 1 user with no commitment; Connect from US$139/month; Grow from US$199/month; Plus from US$499/month for 5 users; extra users US$29/month (checked 7 Nov 2026): https://www.getjobber.com/pricing/
- Tradify pricing, in USD: US$47 / $51 / $61 per user per month (checked 7 Nov 2026): https://www.tradifyhq.com/pricing
- QuickBooks Online Canada, regular prices in CAD: Plus $110/month, Advanced $220/month (checked 7 Nov 2026): https://quickbooks.intuit.com/ca/pricing/

**WCB clearances** (why sub compliance matters; not legal advice)
- WorkSafeBC: you may be liable for a registered sub's unpaid premiums; a clearance letter addressed to you protects you: https://www.worksafebc.com/en/insurance/why-clearance-letter
- WCB Alberta, when a clearance letter is needed: https://wcb.ab.ca/insurance-and-premiums/clearance-letters/
- WCB Saskatchewan, letters of good standing and clearances: https://wcbsask.com/letters-good-standing-and-clearances

**Prompt payment** (why getting invoices right matters; not legal advice)
- Osler, Canadian prompt payment and construction law reforms (updated 30 Mar 2026): AB in force 29 Aug 2022; SK 1 Mar 2022; MB 1 Apr 2025 for new contracts; BC's Act received royal assent 27 Nov 2025 but isn't in force yet: https://www.osler.com/en/insights/updates/canadian-prompt-payment-and-construction-law-reforms/

**CASL**
- CRTC guidance on implied consent (2 years after a purchase, 6 months after an inquiry): https://crtc.gc.ca/eng/com500/guide.htm
