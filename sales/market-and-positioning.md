# TradeQuote PRO: market, competitors and positioning (Western Canada)

Checked on **2026-11-07**. Every price below was read on that date from the link beside it. Prices change, so re-check before you quote one to a prospect.

US-dollar prices are converted at the Bank of Canada rate of **1.4113 CAD per USD (2026-11-06)** ([Bank of Canada][boc]). Formula: CAD = USD × 1.4113, rounded to the dollar.

**How to read this**
- **Live** = in the app today. **Launching** = in the build spec, being built now. Never sell a Launching item as done; say "launching" or "coming in the next release".
- **Not on their public pages** = we looked at their site on 2026-11-07 and didn't see it. It does not mean they can't do it. Ask in a demo, or ask the prospect.
- **Third-party price** = not from the vendor. Often from a review site or a competitor's blog. Treat as a rough guide.
- **Assumption** = our own estimate. The formula is always shown.
- Use the competitor points in conversation only. The build rules say no competitor claims on the website or in emails.

---

## 1. The short version

1. **The real competitor is a spreadsheet, a Word proposal, QuickBooks and paper.** Most shops in our target market are small. Win against that first.
2. **Nobody in this list is built for Canadian industrial electrical work.** The field-service tools (Jobber, Housecall Pro, ServiceTitan, Tradify, FieldEdge) are built for service calls. The construction platforms (Procore, Buildertrend, Fieldwire) are built for GCs and builders. The electrical-specific ones (Simpro, BuildOps, eSUB, Accubid, McCormick) are sales-led, mostly US-priced, and none showed LOTO permits, tailgate/FLHA sign-offs or WCB clearance tracking on its public pages.
3. **Simpro is the closest real competitor** for an electrical contractor: it has progress claims with automatic retention. Jobber is the one prospects will name most often: it's Canadian, cheap at the low end and well known.
4. **Flat pricing in Canadian dollars is a genuine edge.** Jobber and Housecall Pro bill in US dollars, Knowify doesn't state a currency, and Fieldwire's pricing page defaults to US dollars. At 1.41, a USD bill moves every month.
5. **Our prices are low: Crew is about 29 to 67% below published prices at 10 users, and 66 to 83% below at 20 users** (section 8). Hold them until the 25 founding spots are gone. Then raise Crew to $399 and Contractor to $899 for new customers, and put basic invoicing and LOTO in Field.
6. **The objection that will cost us the most deals is "does it sync with QuickBooks?"** Accounting sync is not in the build spec. CSV export is launching. Be upfront about it.

---

## 2. Positioning

### Positioning statement

> **For** electrical and industrial contractors in Western Canada with about 5 to 60 people, who bid and run shutdowns, plant maintenance and commercial electrical jobs,
> **TradeQuote PRO is** the one app that carries a job from estimate to final invoice, with the Canadian paperwork built in: LOTO permits, tailgate meetings, sub WCB clearance, lien holdback and GST/PST, billed flat in Canadian dollars.
> **Unlike** Procore, which is built and priced for general contractors, or Jobber and ServiceTitan, which are built for service calls,
> **TradeQuote PRO is** built around how an industrial electrical crew actually works and gets paid.

"Estimate to final invoice" and "holdback on invoices" are **Launching**. Until they ship, say:

> *Today:* estimates and printable proposals, daily logs with photos and client sign-off, LOTO, tailgate and safety registers, sub WCB and insurance expiry tracking, and an assistant that answers Canadian code questions with citations. *Launching:* the full chain from estimate to proposal, job, timecards, change orders, invoices with holdback, and job costing.

### The 20-second version for a contractor

"It's an app for electrical and shutdown contractors. You build the bid, send the proposal, run the crew's daily logs, tailgates and LOTO, and bill the draw with holdback, all on the same job. One flat price in Canadian dollars. Try it free for 14 days, no credit card."

(Billing the draw with holdback is Launching. Until it ships, end at "LOTO".)

### Who we're for

- Electrical, instrumentation and industrial maintenance contractors in AB, SK, MB and BC.
- About 5 to 60 people, field and office together.
- Project, shutdown and plant work, not mostly residential service calls.
- Today on spreadsheets plus QuickBooks, or on a home-service app they've outgrown.
- The owner or the operations manager makes the call.

### Who we're not for yet (walk away politely)

- Residential service shops with 10+ trucks who need call booking, a dispatch board, route planning and memberships.
- General contractors who need owner and architect collaboration on drawings.
- Anyone who needs live two-way accounting sync on day one.
- A full-time estimator who needs on-screen takeoff from PDFs.
- Firms over about 100 people who need a construction ERP (Jonas, Vista, Spectrum).

---

## 3. What we can sell today, and what's launching

Sources: `lib/modules.ts` (44 modules), `app/pricing/pricing-view.tsx`, the README, and the build spec (scope and decisions 1 to 14).

| Area | Live today | Launching |
|---|---|---|
| Estimating | Estimate lines, labour rate, one markup %, one tax %, printable estimate/proposal | Material catalog, labour-rate table, assemblies, supplier price-file import; estimate → proposal → project chain; AI draft estimate from a scope PDF |
| Proposals | Printable proposal | Client link to accept or decline with name and signature |
| Field | Daily logs with photos, client signature, lock and print; timecards (basic); crew schedule; punch list; tool crib | Timecard approval by foreman, lock, labour cost with overtime |
| Safety | Registers for LOTO permits, tailgate meetings, safety incidents, inspections | LOTO lock-on → verified → lock-off sign-offs in order, tailgate attendee and supervisor sign-off, lock on final sign-off, photos, print |
| Compliance | Sub compliance and vendors with WCB clearance and insurance expiry dates; 30-day expiry list on the dashboard | Daily alert digest by email |
| Money | Progress billing and invoice records (holdback % and GST as plain fields) | Invoices with lines, numbering, holdback withheld and released, tax; draw → invoice → receivable; priced change orders with client signature; job costing from timecards, payables and POs |
| AI assistant | Canadian code and construction answers with cited sources; searches your own records | Drafts proposal scope, exclusions and terms; cost prediction from your own closed jobs |
| Data | Install on Windows, Android, iPhone; 14-day trial; roles from owner to electrician | CSV import (clients, vendors, employees, catalog) and CSV export; audit log; file attachments |
| Free tools | None | Public calculators: voltage drop, markup vs margin, holdback amount, labour burden, Ohm's law |

**Not in the build spec at all:** accounting sync (QuickBooks, Sage, Jonas), online card payments from clients, on-screen takeoff, call booking and dispatch, Accubid or ConEst import. Offline use of the installed app has not been tested; check it before you promise it to a remote site.

---

## 4. The yardstick: what Canadian industrial electrical work needs

These are the tests we hold every competitor to. Each has a source. None of this is legal or tax advice; contractors should check with their lawyer or accountant.

| Need | What the rules or the work say | Source |
|---|---|---|
| **Lien holdback** | AB: 10% of each payment, kept at least 60 days after substantial performance (90 days for oil and gas well sites and concrete work). BC: 10%, holdback period 55 days after the certificate of completion. MB: 7.5%. SK: 10% (lender guide, undated; check the Act). | [McCarthy Tétrault, 2024-08-19][mccarthy]; [BC Builders Lien Act s.4, s.8][bcbla]; [MLT Aikins (MB)][mltaikins-mb]; [RBC lending guide][rbc] |
| **Prompt payment** | AB in force since 2022-08-29: owner pays within 28 days of a proper invoice; proper invoices at least every 31 days and must say they are proper invoices. SK in force 2022-03-01: 28 days, monthly proper invoices. MB in force 2025-04-01: 28 days. BC: Act passed 2025-11-27, not in force as of Feb 2026. | [Bennett Jones, 2026-02-20][bennett]; [Miller Thomson (SK)][millerthomson-sk]; [MB proclamation][mb-proc]; [MHCA (MB)][mhca] |
| **WCB clearance** | WorkSafeBC: if your sub isn't paying premiums you "could be liable"; get a clearance letter addressed to you before and after the work. Other Western boards have clearance processes too; check each board's rules. | [WorkSafeBC][worksafebc] |
| **GST/PST** | GST 5% everywhere. Saskatchewan has charged PST on the total price of real property construction contracts since 2017-04-01, so SK quotes and invoices need PST on labour too. BC and MB have their own contractor rules. AB has no PST. | [Osler on SK 2017-18 budget][osler] |
| **CEC edition** | 2024 CEC in force: BC 2025-03-04, AB 2025-04-01, SK 2025-03-01 (one industry table). MB status not confirmed. Our assistant should always say which edition it's citing. | [Technical Safety BC][tsbc]; [Alberta notice][ab-cec]; [Electro-Federation Canada table][efc] |
| **LOTO** | Permits with isolation, verification of zero energy and release, signed in order. In the app today it's a register; the signed sequence is Launching. | Build spec decision 4 |
| **Shutdown work** | Crew size jumps for a few weeks, nights and swing shifts, permits and FLHAs every shift, owner prequalification (ISNetworld and Avetta are used by Western Canadian owners). | [ISN press release, Apr 2026][isn]; [Avetta case study][avetta] |
| **CAD billing** | Contractors earn and pay in CAD. A USD subscription changes cost with the exchange rate. | [Bank of Canada][boc] |

---

## 5. The landscape at a glance

Prices checked 2026-11-07. "List" = the vendor's own page. CAD in brackets uses 1.4113.

| Competitor | Built for | Public price | Strongest at | Biggest gap for Canadian industrial electrical |
|---|---|---|---|---|
| **Spreadsheets + QuickBooks + paper** | Everyone | Free (plus QuickBooks) | Known, flexible | Re-typing, lost logs, missed expiries, holdback in a side sheet |
| **Jobber** (Edmonton) | Small home-service businesses | List, **USD**: Core $49/mo (1 user); Grow 5 users $299/mo [$422]; Grow 15 users $499 [$704]; +$29/user; 16+ users contact sales ([pricing][jobber]) | Quotes, invoices, payments, scheduling, QuickBooks sync | Billed in USD even on the Canadian page ([en-ca][jobber-ca]); no LOTO, tailgate, WCB or holdback on pricing page |
| **Simpro** | Trade contractors incl. electrical, service + projects | Not published; per user ([Capterra][simpro-capterra]) | Progress claims with automatic retention ([help guide][simpro-claims]) | Sales-led, no published CAD price; no LOTO/WCB on public pages |
| **Procore** | GCs and owners; "Specialty Contractor" is a listed type | Not published; priced by product and Annual Construction Volume, unlimited users ([pricing][procore]) | Drawings, RFIs, submittals, GC collaboration | Priced on volume; GC workflow; billing help pages found are US-oriented ([Procore support][procore-billing]) |
| **ServiceTitan** | Residential and commercial service | Not published; per technician ([pricing][servicetitan]). Third-party: US$245–$500/tech/mo plus US$5k–$50k setup ([Projul, a competitor][projul-st]) | Call booking, dispatch, pricebook, memberships | Service-call model; per-tech cost for big crews |
| **BuildOps** | Commercial mechanical, electrical, plumbing, fire; mid-market to enterprise | Not published; quote after discovery call ([pricing][buildops]) | Service + projects; Vista, Spectrum, Sage, NetSuite, QuickBooks integrations | Sales-led; Canada not mentioned on pricing page |
| **Knowify** | Commercial subs and contractors | List, $ (currency not stated): Core $99 or $149/mo (1 user); Advanced $329 or $399/mo (10 users); +$29/user ([pricing][knowify]) | AIA billing, retainage, change orders, WIP | US billing format (AIA); job costing only on Advanced |
| **Tradify** | Small trade businesses | List, **CAD**: Lite $62, Pro $68, Plus $80 per user/mo ([CA pricing][tradify-ca]) | Simple quotes, invoices, scheduling; publishes CAD | Per-user cost climbs; no LOTO/WCB/holdback on pricing page |
| **Fieldwire** | Field teams on construction projects | List, $ (USD default): free for 5 users/3 projects; Pro $39, Business $64, Business Plus $89 per user/mo, billed yearly ([pricing][fieldwire]) | Drawings, sheet compare, punch, custom forms | No estimating, proposals, invoicing or holdback on pricing page; RFIs and change orders only on top tier |
| **eSUB** | Commercial subcontractors incl. electrical | Not published ([Capterra][esub-capterra]) | Daily reports, T&M, change orders, RFIs ([esub.com][esub]) | No Canada mention; no estimating or safety on home page |
| **Buildertrend** | Residential builders and remodelers | Not published since 2025; last published US$449–$989/mo billed yearly ([Projul, a competitor][projul-bt]) | Residential project management, unlimited users | Not built for industrial trade work |
| **Housecall Pro** | US home service | List, **USD**: Basic $79/mo (1 user); Essentials $189 (5 users); Max $329 (8 users) +$35/user; sales tax "depending on your state" ([pricing][hcp]) | Booking, dispatch, payments, financing | US-focused; no Canada mention on pricing page |
| **FieldEdge** | HVAC, plumbing, electrical service | Not published; "Request Pricing" ([pricing][fieldedge]) | Service dispatch | Service-call model |
| **Trimble Accubid / ConEst / McCormick** | Electrical estimators | Accubid and ConEst not published; McCormick listed at US$300/user/mo by Capterra ([Capterra][mccormick]) | Labour units, assemblies, takeoff on big bids | Estimating only; no field, safety or billing |
| **SiteMax** (sitemax.ca; HQ not verified) | Construction field management | Third-party: US$19–$24/user/mo ([GetApp][sitemax-getapp]) | Daily reports, time, forms | No estimating or billing found |
| **Workhub** (Calgary), **SiteDocs** (Abbotsford) | Safety compliance | Third-party: about $3/user/mo ([Capterra][workhub-sitedocs]) | Safety forms, training, COR programs | Safety only |
| **Jonas, Maestro** (Canadian ERPs) | Larger contractors needing full accounting | Not published | Full construction accounting | Heavy implementation; not for a 10-person shop |
| **Joist** (Canadian-founded) | One-person contractors | Capterra lists $8, $14, $32/mo ([Capterra][joist]) | Fast estimates and invoices | Not for crews |

---

## 6. Battlecards

Each card: who they are, price, where they're strong (be honest), where they fall short for our work, when we win, when to walk away, questions to ask, and the honest one-line answer to "we already use X".

### 6.1 Spreadsheets, Word, QuickBooks and paper

- **Who:** Almost every shop under 20 people. In NAICS 2382 (building equipment contractors, which includes electrical), 57.8% of employer businesses have fewer than 5 employees ([ISED, 2025][ised]).
- **Price:** Free, plus QuickBooks.
- **Strong at:** Everyone knows Excel. QuickBooks handles GST and payroll. Nothing to learn.
- **Falls short:** The bid is re-typed into Word. Daily logs go missing. Nobody sees a sub's WCB clearance expire. Holdback lives in a side sheet. LOTO and tailgate forms sit in a truck.
- **We win when:** They've lost money on a bid math error, a disputed extra or a missed clearance. Or they bill progress draws with holdback and chase paper at month end.
- **Walk away when:** The owner bids every job alone, has no crew to coordinate and likes it that way. Ask if you can check back in slow season (only if they say yes; CASL applies).
- **Ask:**
  - "When a sub's WCB clearance lapses, how do you find out?"
  - "If a client disputes extra work from three months ago, how long does it take to find the signed daily log?"
- **"We use Excel."** → "Keep Excel for what it's good at. Run one job in TradeQuote PRO, the estimate, daily logs and tailgates, and compare the paperwork at the end."

### 6.2 Jobber

- **Who:** Edmonton-based ([Edmonton Global][jobber-edm]). Built for small home-service businesses: landscapers, cleaners, plumbers, HVAC, electricians.
- **Price (list, USD, 2026-11-07):** Core $49/mo, 1 user. Connect 5 users $199/mo ($149 billed yearly). Grow 5 users $299 [$422 CAD], 15 users $499 [$704 CAD]. Plus 15 users $699 [$987 CAD]. Extra users $29 [$41 CAD]. 16+ users: contact sales. "All prices in USD", including on the Canadian page ([pricing][jobber], [en-ca][jobber-ca]).
- **Strong at:** Clean quotes and invoices, online payments, scheduling, QuickBooks Online sync (Connect and up), job costing (Grow and up), progress invoicing, a full 14-day trial. Big brand, Canadian company, good mobile app. For service work they're hard to beat.
- **Falls short for us:** Built around service visits, not shutdowns and project work. Their pricing page lists no LOTO permits, tailgate or FLHA sign-offs, sub WCB tracking, holdback, RFIs or submittals. Billed in USD. Published tiers stop at 15 users.
- **We win when:** A 10 to 60 person shop doing industrial or commercial projects with change orders, holdback draws, LOTO and tailgates. Or a Jobber shop that has grown past 15 users.
- **Walk away when:** Most of their work is residential service calls, and they need online booking, card payments at the door, route planning or marketing tools. Jobber is better at that.
- **Ask:**
  - "How do you bill a progress draw with 10% holdback today, and how do you track when the holdback comes due?"
  - "Where do your tailgate meetings and LOTO permits live?"
  - "Is your Jobber bill in Canadian or US dollars?"
- **"We already use Jobber."** → "Jobber's great for service calls. We're for the project and shutdown side: LOTO, tailgates, change orders and holdback on the same job, in Canadian dollars. If service is most of your work, stay with Jobber."

### 6.3 Simpro (closest feature competitor)

- **Who:** Field service and project software for trade contractors, with a dedicated electrical product ([Simpro electrical][simpro-elec]). Lists Canada among its regions; we found no Canadian office listed (verify).
- **Price:** Not published. Per user, "contact vendor" ([Capterra][simpro-capterra]). One reviewer reports 3 or 5 year lock-ins with about 8% a year increases (single review on Capterra; verify).
- **Strong at:** Real electrical depth. Quoting, scheduling and dispatch, service and projects together. Progress claims that deduct retention automatically and remind you when to claim it ([progress claims][simpro-claims], [retention claims][simpro-retention]). This is the most complete product on this list for an electrical contractor.
- **Falls short for us:** Sales-led, with a demo before any price. No published CAD price. No LOTO permits, tailgate sign-offs or WCB clearance tracking on its public pages. Users report contract terms worth checking.
- **We win when:** A 5 to 30 person shop that wants to be running this week, month to month, at a flat CAD price, with the safety paperwork on the same job.
- **Walk away when:** They run a big service department (maintenance contracts, recurring service, asset registers, dispatch) plus projects, and have the budget and time for an implementation. Simpro is more mature there.
- **Ask:**
  - "What's the contract length, and what's the yearly increase?"
  - "Where do your LOTO permits and FLHAs get signed?"
- **"We already use Simpro."** → "Simpro is a deep system and good at retention claims. If you want something running this week, month to month in Canadian dollars, with LOTO and tailgates in the same app, try us on one job."

### 6.4 Procore

- **Who:** The big construction management platform. Prices "by product and based upon your Annual Construction Volume", with unlimited users ([pricing][procore]). Lists "Specialty Contractor" as a customer type.
- **Price:** Not published. Third-party: about US$10,000/yr at the low end, US$10,000–$80,000/yr for contractors under $50M revenue, based on user reports ([Projul, a competitor, updated Oct 2026][projul-procore]). Treat as rough.
- **Strong at:** The standard for GCs. Drawings, RFIs, submittals, unlimited users, lots of integrations. Many GCs use it, so subs often work inside a GC's Procore project.
- **Falls short for us:** Priced on construction volume, so the bill grows with your revenue. Built around GC workflows. The progress billing help pages we found are US-oriented ([Procore support][procore-billing]). LOTO is not a named product.
- **We win when:** A sub uses Procore only because the GC invites them, but still estimates in Excel and tracks their own crew, timecards and safety on paper.
- **Walk away when:** They're a GC or self-perform at $50M+ volume, need owner and architect collaboration, or already use Procore Financials every day.
- **Ask:**
  - "Is the Procore you use your own licence or the GC's project?"
  - "Where do your own estimates, timecards and LOTO permits live?"
- **"We already use Procore."** → "Keep using Procore where your GCs require it. We're for running your own shop: your bids, your crew's time, your LOTO and your holdback, at a flat CAD price that isn't based on your construction volume."

### 6.5 ServiceTitan

- **Who:** Service software for HVAC, plumbing and electrical. Three plans (Starter, Essentials, The Works), priced per technician, "Request Pricing" ([pricing][servicetitan]).
- **Price:** Not published. Third-party: US$245–$500 per technician per month [$346–$706 CAD], plus US$5,000–$50,000 implementation ([Projul, a competitor, citing FSM Advisor and ToolEdUp][projul-st]).
- **Strong at:** Running a service business: call booking, dispatch board, pricebook, memberships, payroll, commissions, reporting.
- **Falls short for us:** Built for service calls, not two-week shutdowns. Per-technician pricing adds up fast for a 30-person crew. No LOTO, tailgate or holdback on its pricing page.
- **We win when:** An industrial or commercial project shop that was pitched ServiceTitan and balked at the per-tech price and the setup project.
- **Walk away when:** A residential service shop with a call centre, 10+ trucks and memberships. ServiceTitan is built for them.
- **Ask:**
  - "How many of your people answer service calls, and how many work shutdowns and projects?"
  - "What was the implementation quote?"
- **"We already use ServiceTitan."** → "ServiceTitan is built to run a dispatch board for service calls. If most of your work is projects and shutdowns, we fit that work better, at a flat price instead of per technician."

### 6.6 BuildOps

- **Who:** Commercial contractors in mechanical, electrical, plumbing, fire and refrigeration, "mid-market shops to enterprise", "across North America" ([pricing][buildops]).
- **Price:** Not published; quote after a discovery call and demo. Review sites put it around US$200–$400+ per user per month (unverified; see [Capterra Canada listing][buildops-capterra]).
- **Strong at:** Commercial service and projects in one app. Integrates with Viewpoint Vista, Spectrum, Sage Intacct, NetSuite and QuickBooks. A good fit for a larger commercial electrical contractor with an ops team.
- **Falls short for us:** Sales-led and priced for mid-market. Canada not mentioned on the pricing page. No LOTO, tailgate or WCB tracking on its public pages.
- **We win when:** A 5 to 40 person shop that can't justify a discovery process and an implementation, and needs safety paperwork with the job.
- **Walk away when:** A $10M+ commercial service contractor on Vista or Spectrum who needs deep ERP integration and dispatch.
- **Ask:** "Which accounting system does it have to talk to, and how soon?"
- **"We already use BuildOps."** → "BuildOps suits bigger commercial shops with an ERP behind them. If that's you, stay. If you want to be running this week at a flat CAD price, we're the lighter option."

### 6.7 Knowify

- **Who:** Commercial contractors and subs who live in QuickBooks.
- **Price (list, 2026-11-07, currency not stated):** Core $99 or $149/mo, 1 user (the page doesn't say which is yearly). Advanced $329 or $399/mo, 10 users. Enterprise: talk to us. Extra users $29/mo ([pricing][knowify]).
- **Strong at:** Progress billing, AIA G702/G703 pay apps, retainage, change orders, time tracking, WIP reports.
- **Falls short for us:** Built around US-style AIA billing and retainage, not Canadian holdback and prompt payment. Job costing only on Advanced. The pricing page doesn't mention Canada or QuickBooks Canada. No LOTO or tailgate.
- **We win when:** A Canadian sub who wants holdback in Canadian terms, safety records and CAD pricing.
- **Walk away when:** Live two-way QuickBooks sync is a must today. We don't have it.
- **"We already use Knowify."** → "Knowify is solid if your billing is US-style AIA through QuickBooks. We're built for Canadian holdback, WCB and the safety paperwork, priced in CAD. If QuickBooks sync is the deal-breaker, we're not there yet."

### 6.8 Tradify

- **Who:** Small trade businesses: electricians, plumbers, builders. Publishes CAD prices.
- **Price (list, CAD, 2026-11-07):** Lite $62, Pro $68, Plus $80 per user per month; Custom by request ([CA pricing][tradify-ca]). 20 users on Pro = $1,360/mo.
- **Strong at:** Simple quoting and invoicing, scheduling, progress invoicing and timesheets (Pro), Xero and QuickBooks Online sync, a fair CAD price for a small crew.
- **Falls short for us:** Per-user pricing climbs with crew size. No LOTO, tailgate, WCB or holdback on its pricing page. Built for smaller service jobs.
- **We win when:** The shop is past 5 or 6 people, or does industrial work with LOTO and holdback.
- **Walk away when:** A 1 to 3 person residential electrician who needs simple quotes, invoices, card payments and accounting sync.
- **"We already use Tradify."** → "Tradify is simple and fair for a small crew. Once you're past five or six people, or doing industrial work with LOTO and holdback, we cover more of the job for less per person."

### 6.9 Fieldwire

- **Who:** Field management for construction teams: drawings, tasks, punch lists, forms.
- **Price (list, 2026-11-07, $ shown, USD default):** Basic free for 5 users, 3 projects, 100 sheets. Pro $39, Business $64, Business Plus $89 per user per month, billed yearly ([pricing][fieldwire]). RFIs and change orders only on Business Plus.
- **Strong at:** The best drawing viewer on this list: sheet compare, BIM viewer, punch, tasks, custom forms. A free tier.
- **Falls short for us:** No estimating, proposals, invoicing, holdback or job costing on its pricing page. LOTO only as a custom form you build yourself.
- **We win when:** They need the money side: estimate, change orders, billing with holdback.
- **Walk away when:** Drawings are the main need. Our drawings module is a register (file attachments are Launching); we're not a plan viewer.
- **"We already use Fieldwire."** → "Fieldwire is great for drawings on site. It doesn't estimate, bill or track holdback. Lots of shops will keep Fieldwire for plans and use us for the bid, the crew paperwork and the billing."

### 6.10 eSUB

- **Who:** Commercial construction subcontractors, including electrical ([esub.com][esub]).
- **Price:** Not published ([Capterra][esub-capterra]). A US$49/user figure circulates on aggregator sites; we couldn't confirm it.
- **Strong at:** Project-side sub workflow: daily reports, time and materials, timecards, change orders, RFIs, submittals, progress billing, job costing, QuickBooks Online.
- **Falls short for us:** No mention of Canada. No estimating or safety records on its home page.
- **We win when:** A Canadian sub who wants estimating, project paperwork and safety in one app at a CAD price.
- **Walk away when:** QuickBooks sync is a must today, or they need US-style T&M workflows with GC portals.
- **"We already use eSUB."** → "eSUB is good on the project paperwork. We add the bid at the front, LOTO and tailgates in the field, and Canadian holdback at the back, in CAD."

### 6.11 Estimating suites: Trimble Accubid, ConEst IntelliBid, McCormick

- **Who:** Dedicated electrical estimating with big material and labour-unit databases. Accubid started in Concord, Ontario and was bought by Trimble ([Electrical Marketing][accubid-trimble]). Capterra lists Accubid Classic with 40,000+ items and 9,500 assemblies ([Capterra][accubid-capterra]).
- **Price:** Accubid not published; one listing shows "from US$2,000" flat ([GetApp Canada][accubid-getapp]). ConEst quote-based ([Software Advice][conest]). McCormick listed at US$300/user/mo [$423 CAD] by Capterra; the vendor doesn't publish it ([Capterra][mccormick]).
- **Strong at:** Speed and accuracy on big bids: labour units, assemblies, takeoff, supplier price updates. Estimators trust years of tuned data.
- **Falls short for us:** Estimating only. They don't run the field, safety, timecards or billing. Some reviewers report trouble with database updates (single reviews).
- **We win when:** No full-time estimator; small and mid-size bids done in Excel; or the owner wants the estimate to flow into the job, crew and billing.
- **Walk away when:** A full-time estimator bidding large jobs with takeoff from drawings. We have no takeoff. Catalog and assemblies are Launching. Supplier prices depend on each distributor sharing a price file.
- **"We already use Accubid."** → "Keep Accubid for the big bids. We take over once you win the job: proposal, crew, LOTO, timecards, change orders and billing. Today you'd re-enter the totals; there's no Accubid import."

### 6.12 Canadian field and safety apps: SiteMax, Workhub, SiteDocs

- **Who:** SiteMax: construction field management (daily reports, time, forms). Workhub (Calgary) and SiteDocs (Abbotsford): safety and compliance.
- **Price:** Third-party only. SiteMax US$19–$24/user/mo ([GetApp][sitemax-getapp], [FitGap][sitemax-fitgap]). Workhub and SiteDocs about $3/user/mo, currency unclear ([Capterra][workhub-sitedocs]). SiteMax's own site didn't load when we checked.
- **Strong at:** Cheap and Canadian. Workhub and SiteDocs go deeper on safety programs: training records, policies, audits.
- **Falls short for us:** No estimating or billing found.
- **We win when:** They want safety on the same job as the estimate, the crew's hours and the invoice.
- **Walk away when:** They want a full COR safety program manager, or only safety forms at $3 a user.
- **"We already use Workhub / SiteDocs."** → "If you only need safety forms, those are cheaper. We put LOTO and tailgates on the same job as the bid, the hours and the invoice."

---

## 7. Others, in one line each

- **Housecall Pro:** US home service. "All prices are in USD", sales tax depends on "your state of residence" ([pricing][hcp]). Not a fit for industrial work.
- **Buildertrend:** Residential builders and remodelers. Stopped publishing prices in 2025; last published US$449–$989/mo billed yearly ([Projul, a competitor][projul-bt]). Rarely a real competitor for us.
- **FieldEdge:** HVAC, plumbing and electrical service; "Request Pricing" ([pricing][fieldedge]). Same answer as ServiceTitan.
- **Jonas Construction, Jonas Premier, Maestro:** Canadian construction ERPs with full accounting; quote-based ([Capterra Canada][jonas]). If they run Jonas or Maestro, we're not replacing their accounting. Position as the field and estimating front end, and be clear there's no integration.
- **Joist:** Canadian-founded app for one-person contractors, $8 to $32/mo on Capterra ([Capterra][joist]). Not our customer.
- **ISNetworld, Avetta, ComplyWorks:** Owner prequalification platforms ([ISN][isn], [Avetta][avetta]). Complements, not competitors. Our line: "We don't replace your ISN or Avetta account. We keep your own copies and expiry dates so nothing lapses before the owner's audit."

---

## 8. Pricing recommendation

### What we charge now

From `app/pricing/pricing-view.tsx`: Field **$99/mo** (up to 5 users), Crew **$299** (up to 20), Contractor **$699** (up to 60). Yearly = 10 × monthly. Extra users $19/mo. Enterprise from $1,500/mo. Guided onboarding $499. Data import $750. Founding offer: first 25 companies get 40% off their plan for life.

Price per user at the cap: Field $99 ÷ 5 = **$19.80**. Crew $299 ÷ 20 = **$14.95**. Contractor $699 ÷ 60 = **$11.65**.

### What a shop pays elsewhere (CAD per month, list prices, 2026-11-07)

Monthly billing where shown. USD × 1.4113.

| | 5 users | 10 users | 20 users |
|---|---|---|---|
| **TradeQuote PRO** | $99 Field ($299 Crew) | $194 Field + 5 extra, or $299 Crew | $299 Crew |
| Jobber Grow (has job costing) | $422 | $563 | contact sales |
| Jobber Connect (no job costing) | $281 | $422 | contact sales |
| Housecall Pro | $267 (Essentials) | $563 (Max + 2) | $1,057 (Max + 12) |
| Tradify Pro (CAD list) | $340 | $680 | $1,360 |
| Knowify | $303–$374 (Core + 4, no job costing) | $464–$563 (Advanced) | $874–$972 (Advanced + 10) |
| Fieldwire Business (yearly billing) | $452 | $903 | $1,806 |
| Per-user, quote only (third-party) | ServiceTitan $346–$706 per tech; BuildOps $282–$565 per user; McCormick $423 per user | | |
| Volume-based (third-party) | Procore about US$10,000/yr at the low end ≈ $1,176/mo; Buildertrend last published US$499/mo ≈ $704 | | |

Sources: the section 5 links. Formulas: Jobber Grow 10 = US$399 × 1.4113; Housecall Max + 2 = (329 + 2 × 35) × 1.4113; Knowify Core + 4 = (99 or 149 + 4 × 29) × 1.4113; Fieldwire = users × 64 × 1.4113; Procore = 10,000 × 1.4113 ÷ 12. Knowify's currency isn't stated; we assumed USD.

**What this says:** Crew at $299 is 29% below the cheapest published 10-user price (Jobber Connect, $422, which has no job costing) and up to 67% below (Fieldwire, $903). At 20 users it's 66% to 83% below (Knowify $874 to Fieldwire $1,806). Formula: 1 − 299 ÷ their price. And those tools don't cover LOTO, tailgates, WCB or holdback. At 5 users Field is below even Jobber Connect. Being cheapest is fine right now: no reviews, no customers to point to, and the money loop is still launching. But Crew and Contractor have room.

### Recommendations, in order

1. **Hold every list price until the 25 founding spots are gone.** The founding offer promises "lock in 40% off". Changing prices mid-offer muddies that, and we have no conversion data yet. The founding offer is already public and in the build spec (G5), so honour it exactly as written.

2. **Put basic invoicing in Field.** Every entry plan we checked includes invoicing: Jobber Core, Tradify Lite, Housecall Pro Basic, Knowify Core. Without it, Field loses head to head with all of them. Keep progress draws with holdback in Crew; that's the commercial and industrial value. (Owner decision; plan gating is build spec decision 11.)

3. **Move LOTO permits into Field.** LOTO is the one thing no field-service competitor shows out of the box, and a 5-person industrial maintenance crew is exactly our entry customer. Gating it at $299 blocks the wedge. Let Crew's reasons to upgrade be job costing, change orders, holdback billing, crew schedule and more than 5 users.

4. **After the founding 25 (or after 90 days, whichever comes first), raise Crew to $399 and Contractor to $899 for new customers only.** Keep Field at $99 as the way in.
   - Crew $399 for 20 users = $19.95 a user. Still below Jobber Grow at 10 users ($563), Housecall Pro at 10 ($563) and Tradify Pro at 10 ($680).
   - Contractor $899 for 60 users = $14.98 a user. Still below the low-end third-party Procore estimate (about $1,176/mo).
   - **Test it with real numbers, don't guess.** The founder console (G1) shows trial-to-paid by tier. The raise pays for itself if conversion stays at or above *old price ÷ new price* of what it was: Crew 299 ÷ 399 = **75%**, Contractor 699 ÷ 899 = **78%**. Below that, go back. (Simple arithmetic; it ignores any difference in churn.) Wait for at least 30 trials per tier before judging; fewer than that is noise (assumption).
   - Existing customers keep their price.

5. **Sell the extra-user price as shutdown seats, with a cap.** Crews swing from 15 to 60 for a three-week turnaround. Let customers add $19 seats for the month and drop them after. Promise: "your bill never goes above the next tier's price that month". The break-even is (699 − 299) ÷ 19 ≈ 21 extra seats on Crew, after which Contractor is cheaper, so the cap is easy to explain. Needs build work on the Stripe extra-seat price (decision 11 already names `STRIPE_PRICE_EXTRA_SEAT`).

6. **Make basic data import free.** The cold-email reply plan already offers to "import their customer list for them", which contradicts the $750 import fee. Make CSV import of clients, vendors and employees free for everyone (CSV import is Launching). Keep $750 for full migrations such as old job history. Include the $499 guided onboarding free with yearly Contractor. "No setup fee" is a real wedge: third-party sources report ServiceTitan setup of US$5,000–$50,000 ([Projul][projul-st]).

7. **Keep yearly at 10 × monthly** (two months free, about 17% off). Jobber advertises up to 25% off yearly; we don't need to match it.

8. **Shout the Canadian-dollar price, and show tax.** Put "CAD, plus GST/PST" beside every price. Jobber and Housecall Pro show USD, and Fieldwire defaults to USD.

9. **Don't add a cheaper solo plan.** Solo electricians are well served by Joist, Jobber Core and Tradify Lite, and the AI assistant has a real cost per company. Our customer is a crew.

10. **Before the first founding signup, write down what the 40% covers.** The FAQ says "40% off their plan". Read literally, that's the plan price, not extra seats, onboarding or import. Say so in the terms so nobody is surprised later.

### Illustrative revenue math (assumption)

The tier mix below is invented to show the arithmetic. Replace it with real signups.

- Founding 25, mix of 10 Field, 12 Crew, 3 Contractor. List MRR = 10 × 99 + 12 × 299 + 3 × 699 = **$6,675**. At 40% off: 6,675 × 0.6 = **$4,005 CAD/mo**.
- The next 25 with the same mix at current prices = $6,675/mo. At the proposed prices = 10 × 99 + 12 × 399 + 3 × 899 = **$8,475/mo**, which is $1,800 (27%) more for the same number of customers.

### Size of the market (context, with limits)

ISED's 2025 figures for NAICS 2382, building equipment contractors (electrical, plumbing, HVAC and similar, so broader than electrical): employer businesses AB 4,530, SK 1,062, MB 1,040, BC 5,916, total **12,548**. Nationally 57.8% have 1 to 4 employees, 40.5% have 5 to 99, 1.5% have 100 to 499 ([ISED][ised]).

Assumption: if the West has the national size mix, 12,548 × 40.5% ≈ **5,080** businesses with 5 to 99 employees. Electrical is only part of that. For the electrical-only count (NAICS 238210) by province, pull Statistics Canada's Canadian Business Counts table; we couldn't get it from the public pages.

What it means for pricing: most shops have under 5 people, so Field's price and features decide most first sales. Crew and Contractor are where the revenue per customer is.

---

## 9. Gaps we have to own

Be upfront about these. Losing a deal honestly beats a refund and a bad review.

1. **No accounting sync.** Jobber, Tradify, Housecall Pro, Knowify, eSUB and BuildOps all advertise accounting integrations. Not in our build spec. CSV export is Launching. This is the most likely deal-breaker; the most valuable next build is QuickBooks Online sync.
2. **No takeoff, and supplier pricing depends on distributors.** Catalog and assemblies are Launching. Most Western Canada distributors share prices per account, so each customer needs a price file from their rep (README).
3. **Not a service dispatch tool.** No call booking, route planning, memberships or online card payments from clients.
4. **Offline use not tested.** Test the installed app with no signal before promising it to a mine site, plant or oil sands job.
5. **Prompt payment.** AB, SK and MB have proper-invoice rules in force; BC has passed its Act ([Bennett Jones][bennett]). When invoicing ships, make the invoice template prompt-payment ready (for example, AB requires the invoice to say it's a proper invoice). Don't claim it until it's built.
6. **New vendor risk.** No reviews or customer names yet, and none may be invented. Answer with: month to month, 14-day trial, your data exportable to CSV (Launching). If asked where the data is stored, answer only once hosting is chosen; the README says data location still needs a lawyer.

---

## 10. Claims check on current sales material

Things to fix before the outbound sequence goes out:

- **Cold email 1** says it "applies your markup and GST/PST". Today an estimate has one markup % and one tax % (default 5%); province tax defaults are still on the backlog. Safer: "applies your markup and tax rate."
- **Reply table, "We use Procore / another tool":** use the one-liners in section 6.
- **Reply table, "Too busy":** offers free company setup and customer import, but the pricing page charges $750 for import. Align them (recommendation 6).
- **Pricing page FAQ** says LOTO permits are built in. True as a register; the signed lock-on → verified → lock-off sequence is Launching. Fine to keep; don't describe sign-off steps until they ship.

---

## 11. How this was built, and keeping it current

- Method: the sales competitive-intelligence skill. No CRM, call recordings or email were connected for this run, so there is **no win/loss data and no customer quotes** here. Everything is from public pages and the codebase.
- To make the battlecards real: on every deal, record which competitor (or "spreadsheets") and why you won or lost. After 10 closed deals, rewrite "when we win" and "walk away" from that record instead of from this desk research.
- Re-check prices monthly. Buildertrend dropped its public prices in 2025 ([Projul][projul-bt]); others can too.

---

## Sources (all read 2026-11-07 unless dated)

| Source | What it supports | Type |
|---|---|---|
| [Bank of Canada][boc] | USD/CAD 1.4113 on 2026-11-06 | Official |
| [Jobber pricing][jobber], [Jobber en-ca][jobber-ca] | Jobber prices, "All prices in USD" | Vendor |
| [Tradify CA pricing][tradify-ca] | Tradify CAD prices | Vendor |
| [Housecall Pro pricing][hcp] | Housecall Pro prices, USD, US sales tax | Vendor |
| [Knowify pricing][knowify] | Knowify prices and features | Vendor |
| [Fieldwire pricing][fieldwire] | Fieldwire prices and features | Vendor |
| [Procore pricing][procore] | ACV-based pricing, unlimited users | Vendor |
| [ServiceTitan pricing][servicetitan] | Per-technician pricing, plan names | Vendor |
| [BuildOps pricing][buildops] | Custom pricing, trades, North America | Vendor |
| [FieldEdge pricing][fieldedge] | Request pricing, trades | Vendor |
| [eSUB][esub] | Who eSUB serves, features | Vendor |
| [Simpro help guide][simpro-claims] | Progress claims and retention | Vendor |
| [Projul][projul-procore] | Third-party Procore, ServiceTitan, Buildertrend prices | Competitor blog |
| Capterra, GetApp, Software Advice, FitGap listings | Third-party prices for Simpro, McCormick, Accubid, SiteMax, Workhub, SiteDocs, Joist, BuildOps | Review sites |
| [ISED][ised] | NAICS 2382 business counts, 2025 | Official |
| [BC Builders Lien Act][bcbla], [McCarthy][mccarthy], [MLT Aikins][mltaikins-mb], [RBC][rbc] | Holdback rules | Statute, law firms, bank guide |
| [Bennett Jones][bennett], [Miller Thomson][millerthomson-sk], [MB proclamation][mb-proc], [MHCA][mhca] | Prompt payment status | Law firms, government, association |
| [WorkSafeBC][worksafebc] | Clearance letters, contractor liability | Official |
| [Osler][osler] | SK PST on construction contracts since 2017 | Law firm |
| [Technical Safety BC][tsbc], [Alberta notice][ab-cec], [EFC][efc] | 2024 CEC adoption dates | Official, industry |

[boc]: https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5
[jobber]: https://www.getjobber.com/pricing/
[jobber-ca]: https://www.getjobber.com/en-ca/pricing/
[jobber-edm]: https://edmontonglobal.ca/news/edmonton-based-jobber-lands-100m-usd-series-d-deal/
[tradify-ca]: https://www.tradifyhq.com/ca/pricing
[hcp]: https://www.housecallpro.com/pricing/
[knowify]: https://knowify.com/pricing/
[fieldwire]: https://www.fieldwire.com/pricing/
[procore]: https://www.procore.com/pricing
[procore-billing]: https://support.procore.com/products/online/user-guide/project-level/progress-billings/tutorials/about-progress-billings
[projul-procore]: https://projul.com/blog/procore-pricing-analysis-2026/
[servicetitan]: https://www.servicetitan.com/pricing
[projul-st]: https://projul.com/blog/servicetitan-pricing-analysis-2026
[projul-bt]: https://projul.com/blog/buildertrend-pricing-analysis-2026/
[buildops]: https://buildops.com/pricing
[buildops-capterra]: https://www.capterra.ca/software/194155/buildops
[simpro-capterra]: https://capterra.com/p/10529/Simpro-Enterprise/pricing/
[simpro-elec]: https://www.simprogroup.com/industries/electrical-software
[simpro-claims]: https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Progress-Claim.htm
[simpro-retention]: https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Retention-Claim.htm
[esub]: https://esub.com/
[esub-capterra]: https://www.capterra.com/p/76833/eSUB-Subcontractor-Software/
[fieldedge]: https://fieldedge.com/pricing/
[accubid-trimble]: https://www.electricalmarketing.com/mag/article/20908213/accubid-systems-bought-by-trimble
[accubid-capterra]: https://www.capterra.ca/software/74728/trimble-accubid
[accubid-getapp]: https://www.getapp.ca/software/2061472/trimble-accubid-classic
[conest]: https://www.softwareadvice.com/construction/conest-intellibid-profile/
[mccormick]: https://capterra.com/p/165314/Electrical-Estimating-Software/
[sitemax-getapp]: https://www.getapp.ca/software/105349/sitemax
[sitemax-fitgap]: https://us.fitgap.com/products/sitemax
[workhub-sitedocs]: https://www.capterra.com/compare/137350-143579/SafetySync-vs-SiteDocs
[jonas]: https://www.capterra.ca/compare/25050/133101/jonas-construction-software/vs/premier
[joist]: https://capterra.com/p/230138/Joist/pricing/
[isn]: https://www.streetinsider.com/Press+Releases/Obsidian+Energy+Continues+to+Mitigate+Operational+Risk+with+ISN/26310113.html
[avetta]: https://www.avetta.com/customers/avetta-helps-leading-energy-infrastructure-service-provider-streamline-compliance-management
[ised]: https://ised-isde.canada.ca/app/ixb/cis/businesses-entreprises/2382
[mccarthy]: https://www.mccarthy.ca/en/insights/blogs/canadian-construction-law-blog/alberta-lien-fund-and-holdback-system-explained
[bcbla]: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/97045_01
[mltaikins-mb]: https://www.mltaikins.com/?p=16057
[rbc]: https://www.rbcroyalbank.com/legalforms/download/collateral/00630.pdf
[bennett]: https://www.bennettjones.com/insights/blogs/2026/02/updates-to-prompt-payment-legislation
[millerthomson-sk]: https://www.millerthomson.com/en/insights/construction-and-infrastructure-law/please-pay-asap-saskatchewans-prompt-payment-legislation-will-be-in-force-in-march-2022/
[mb-proc]: https://web2.gov.mb.ca/laws/statutes/proclamations/2023c30(2025-04-01).php?lang=en
[mhca]: https://mhca.mb.ca/mhca-news/prompt-payment-in-effect-as-of-april-1/
[worksafebc]: https://www.worksafebc.com/en/insurance/why-clearance-letter
[osler]: https://www.osler.com/en/insights/updates/saskatchewan-s-2017-18-budget-provincial-sales-ta/
[tsbc]: https://technicalsafetybc.ca/regulatory-resources/regulatory-notices/information-bulletin-adoption-of-bc-electrical-code-2024-edition
[ab-cec]: https://electricalindustry.ca/latest-articles/alberta-standata-notice-of-publication-for-new-ce-code/
[efc]: https://www.electrofed.com/products/codes/
