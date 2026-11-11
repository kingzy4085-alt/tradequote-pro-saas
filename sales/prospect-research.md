# Prospect research: Western Canada A and B list

Checked 7 November 2026. Every fit call and opening line below comes from the company's own homepage, read that day. The full row-by-row results are in `prospect-research.csv` in this folder. Your original `prospects-western-canada.csv` was not changed.

## The short version

- **45 companies checked** (all priority A and B rows): 21 high fit, 22 medium, 1 low (Kristian Electric is a welding and crane supplier, not an electrical contractor), and 1 not checked (Apex Electric's website wouldn't load because of a security certificate error).
- **None of the 44 sites that loaded say "no solicitation" or "no unsolicited email".** Check again the day before you send. If a notice like that has been added since, it rules that company out.
- **Start with the 15 below.** All are high fit, and each publishes an email address on its own site. Each has a specific, true opening line in the CSV.
- **Don't send anything yet.** Wait until the trial link works and the items in "Before you send" are done.

## How fit was judged

| Fit | What it means here |
|---|---|
| high | The main work is industrial, shutdown, commercial or instrumentation. Residential is either missing or clearly a side line. |
| medium | Mixed work, with residential as a main line alongside commercial, industrial or farm work. Two commercial low-voltage specialists are also marked medium (Diverse Systems for nurse call and security, Klein's for structured cabling) because fewer of the product's power-side modules (LOTO, shutdown logs) apply to them. |
| low | Residential only, or not an electrical contractor. |

All of these are cold-list leads. Nobody has asked to hear from us, so ranking is mostly about fit, then about how specific the hook is and whether we can reach the right person.

## The best 15 to start with

| # | Company | Prov | Why start here | Route (from the company's own site) |
|---|---|---|---|---|
| 1 | MM Energy (MME) | AB | Industrial E&I for oil and gas, chemical and petrochemical in the Heartland since 1998. Their openings include estimators, foremen and project managers, so new people will need a bid and daily-log system. | info@ inbox |
| 2 | Burco Electrical Contractors | SK | Industrial and institutional project list (NexGen camp, water treatment plants). They publish an address for their estimating and project management contact, so the email reaches the person who builds bids. | estimating/PM address on homepage |
| 3 | Impact Energy Services | SK | E&I for mining and oil and gas, with a CSA panel shop, 25+ trucks and three locations. That's a lot of crews, timecards and safety logs. | sales@ (contact page) |
| 4 | DME Controls | AB | Oil and gas instrumentation and controls. COR, ComplyWorks and ISNetworld mean heavy safety paperwork, which fits the tailgate, safety and LOTO logs. | admin@ inbox |
| 5 | Triad Power | SK | E&I on water, wastewater and food plants. The commissioning and cable-testing modules match this work. | info@ inbox |
| 6 | PS Electric | SK | Oilfield, hazardous-area and plant maintenance around Estevan. Owner-run, with COR since 2009. | published inbox |
| 7 | Fieldstone Energy | SK | E&I for oil and gas, municipal water and mining, with 24/7 on-call service, which means lots of service-call logs. | admin@ inbox |
| 8 | Milltron Electric | BC | Industrial work for mills and mines across Northern BC. They offer shift coverage (timecards) and run their own panel shop. | info@ inbox |
| 9 | Humboldt Electric | SK | Commercial and industrial since 1966, with COR, ISN and Gold Seal, plus offices in Saskatoon and Regina. | service@ inbox |
| 10 | Electrical Solutions of Regina | SK | Commercial and industrial. ISN and eRailSafe logos point to industrial and rail clients. The address is a named person's. | named address on homepage |
| 11 | Synergy Electric | SK | Industrial design, install and maintenance for mining, manufacturing and municipal clients. Has COR and offices in three western cities. | inquiries@ (contact page) |
| 12 | COBO Electric | MB | Industrial service for food plants and breweries. Thermal imaging and arc flash work goes with the safety logs. | info@ (hidden by spam protection on the site, but published) |
| 13 | Dobbyn Electrical Services | AB | Industrial and commercial, utility and street lighting since 1974. They're hiring and have ISNetworld. | info@ inbox |
| 14 | Bridge City Electric | SK | Commercial and industrial since 1964, with up to 80 people. That's the Contractor plan or bigger. | info@ inbox |
| 15 | Summit Electric | BC | Industrial work in mining, forestry and pulp and paper, including commissioning. It sits lower on the list because Sabre bought it in 2022, and the parent company may already set the software. | Kamloops admin inbox |

Sources: each company's homepage, as listed in the `source_urls` column of `prospect-research.csv`.

**Next in line, if any of the 15 drop out:** Pentec Energy, Team Power Solutions and Alliance Energy. Alliance has 100+ staff and Team Power is ISO 9001, so both may already run bigger systems. Flyer Electric and Clean Energy Electrical are next after that (contact form only), then Western Electrical (phone only; its estimators are Accubid-trained, so pitch the field side, not estimating).

**Medium fit (do these after the first 30 high-fit sends):** Regal, Tarnes, Battle River, JESCO, Strugnell, Camco, G&K, Powertec, Sparxx, All-Brite, Amtech, Croft, Diverse Systems, High-Arc, Iles, Jet, Kadco, Klein's, L7, Lite-Way, Saunders, Shaw's. Most of these are smaller mixed shops, a natural fit for the Field plan. Croft's site says its crews already quote on site with a program, so lead with the field side (daily logs, timecards, change orders), not quoting.

## Fix these in your list before sending

| Company | What I found | What to do |
|---|---|---|
| Clean Energy Electrical | Your list has info@cleanenergymb.ca, but the homepage (cleanenergymb.com, a .com) doesn't show that address. | Use their contact form, or confirm the address on their contact page first. |
| Flyer Electric | The named address in your list isn't on the homepage. There is a "Quick Inquiry Form". | Use the form. |
| Kadco, High-Arc, Croft, Strugnell | Your list has an email address that isn't on their homepage. | Use their contact forms. |
| JESCO | Your list says "contact form only", but the homepage now shows admin@jescoelectrical.ca. | Update the row. |
| COBO, Jet | The email address is hidden behind spam protection on the page. | It counts as published. Open the site in a browser to read it. |
| Summit Electric | A help widget on their site shows a Gmail address that doesn't look like the company's. | Ignore it. Use kamloopsadmin@summitelec.com. |
| Western Electrical | No email or form on the homepage, and the page carries unrelated online-casino text. | Phone only. Don't mention the casino text. |
| Apex Electric | The site wouldn't load (certificate error). | Check it in a browser before deciding. |
| Kristian Electric | Welding equipment and cranes, not electrical contracting. | Remove it or move it to C. |

**Also important:** in the main project folder, git shows `sales/` as untracked, not ignored. One `git add .` would put this prospect data into the public repo. Add `sales/` to `.gitignore` in the main checkout, or move this folder outside the project.

## How to use the opening lines

Paste the `personalized_line` from the CSV in as the first line of Email 1 in `cold-email-sequence.md`, then go straight into the pain point. Use the lines only for high and medium rows. Here is Email 1 for prospect #1, ready to paste once the trial link is live (about 105 words):

> **Subject:** Estimator hiring at MM Energy
>
> Hi there,
>
> Saw MM Energy has been doing industrial E&I work in the Heartland since 1998, and that your openings include estimators, foremen and project managers.
>
> If a new estimator starts on an old spreadsheet, every markup and tax line is a chance to slip. TradeQuote PRO keeps the bid in one record: material and labour hours per line, your markup and GST built in, and a clean proposal printed from the same record. Foremen get daily logs, tailgate meetings and LOTO permits on their phone.
>
> Try it free for 14 days, no credit card: {trial_link}
>
> The TradeQuote PRO team
> {business_name} · {mailing_address}
> Don't want these emails? {unsubscribe_link}

One wording check in the existing sequence: Email 1 opens with "Most electrical shops we talk to...". Keep that only if it's true. Otherwise change it to "A lot of electrical shops build the bid in a spreadsheet..."

## Before you send

1. **Only promise what exists.** Live in the app today, per the module list and pricing page: estimates, proposals, daily logs, timecards, tailgate meetings, safety logs, LOTO permits, punch list, change orders, RFIs, submittals, job costing, progress billing, crew schedule, tool crib, sub compliance (WCB and insurance), warranty, commissioning, cable testing, and the AI assistant. **Launching (being built now; say "coming soon" if you mention them):** one connected flow from estimate to proposal to job to invoice with holdback, alerts, the client portal, free calculators (voltage drop, markup vs margin, holdback, labour burden), referral credits and the live founding-spots counter. Live supplier pricing is shown as "coming soon" on the pricing page.
2. **Finish the "Before you sell it" items in the README.** That means Privacy Policy and Terms reviewed by a lawyer, business entity, Stripe verification, GST/HST registration and production hosting. The trial link has to work.
3. **CASL.** You can rely on implied consent from a published address only if three things hold: the company published the address itself, there's no "no unsolicited email" statement with it, and the message relates to the recipient's business role. The sender has to be able to prove all three. ([Bennett Jones summary of the CRTC decision](https://www.bennettjones.com/Insights/Blogs/2016/11/CRTC-Assesses-Conspicuous-Publication-Basis-of-Implied-Consent-in-CASL-Enforcement-Decision), [BLG on the Federal Court of Appeal ruling](https://www.blg.com/insights/2020/07/federal-court-of-appeal-rules-casl-constitutionally-valid-and-provides-interpretive-guidance).) For this list, that means:
   - Use addresses from the company's own site, not ones copied from an association directory. Publication by a third party may not count.
   - Keep the `source_urls` column.
   - Recheck for no-solicitation notices the day before sending.
   - Keep to the 30-a-day cap and the one-click unsubscribe already in the sequence.
4. **Every batch needs your approval before it goes out.** That's the rule in the build spec. Nothing in this research was sent, submitted or signed up for.

## What the first 15 could be worth (assumptions, not a forecast)

There is no reply or conversion data for this product yet, so this only shows how to work out the value of a win. Prices are from `app/pricing/pricing-view.tsx`, read 7 November 2026, in CAD before tax.

| Plan | List price | Founding price (40% off) |
|---|---|---|
| Field (up to 5 users) | $99/month | $59.40/month |
| Crew (up to 20 users) | $299/month | $179.40/month |
| Contractor (up to 60 users) | $699/month | $419.40/month |

- **Formula:** monthly revenue = number of companies × plan price × 0.6 (the founding discount).
- **Example (assumption):** if 2 of the 15 subscribe on Crew, that's 2 × $299 × 0.6 = **$358.80 a month**.
- **Example (assumption):** if 1 subscribes on Contractor and 2 on Crew, that's (699 + 2 × 299) × 0.6 = **$778.20 a month**.
- Annual billing on the pricing page is 10 × the monthly price.

## Where to find more Western Canadian electrical contractors

These are places to look one company at a time. Don't bulk-copy them. Pull each email address from the company's own website, never from the directory itself (see the CASL point above).

| Source | Prov | What it is | Link | Note |
|---|---|---|---|---|
| ECAS contractor list | SK | Electrical Contractors Association of Saskatchewan members | ecasask.ca/contractors | Already the source for most of your list. ECAS also runs SaskPower's Registered Electrical Contractor Program. |
| ECAA member directory | AB | Electrical Contractors Association of Alberta, searchable by letter and distance | https://members.ecaa.ab.ca/directory/FindStartsWith?term=C | Also shows PEC (Professional Electrical Contractor) designations. |
| ECABC | BC | Electrical Contractors Association of BC | eca.bc.ca (per [Similarweb](https://www.similarweb.com/company/eca.bc.ca)) | Couldn't find a member directory page. ecabc.org doesn't resolve (checked 7 November 2026). |
| ECAM | MB | Electrical Contractors Association of Manitoba | [Manitoba Chamber listing](https://business.mbchamber.mb.ca/list/member/electrical-contractors-association-of-manitoba-ecam-902) | Official site not found. ecam.ca is a parked domain for sale (checked 7 November 2026). |
| Technical Safety BC "Find a Licensed Contractor" | BC | Official licence lookup for every licensed electrical contractor in BC | https://www.technicalsafetybc.ca/contact/find-contractor | Searches by company name or licence number, so it's best for checking a lead, not browsing. |
| TSASK licensing | SK | Technical Safety Authority of Saskatchewan, which licenses electrical contractors | https://www.tsask.ca/licensing-applications/electrical/electrical-contractor | TSASK refers to a licensed contractor directory, but I couldn't confirm its address. |
| City of Winnipeg contractor licensing | MB | City licence requirements for electrical contractors | https://legacy.winnipeg.ca/ppd/Documents/InfoCentre/Electrical/Important-Info-for-Licenced-Electrical-Contractors.pdf | For checking a Winnipeg lead's licence. |
| SIMSA supplier database | SK | Saskatchewan Industrial and Mining Suppliers Association; members are sortable by capability | https://simsa.ca/ | Good for industrial and mining E&I shops. |
| ICBA directory | BC/AB | Independent Contractors and Businesses Association member directory | https://icba.ca/directory | Mixed trades, so filter for electrical. |
| Winnipeg Construction Association | MB | Commercial contractors and suppliers in Manitoba | winnipegconstruction.ca (per [ZoomInfo profile](https://www.zoominfo.com/c/winnipeg-construction-association/98254850)) | Couldn't confirm a public directory. |
| Saskatchewan Construction Association | SK | Provincial construction association | scaonline.ca (per [Datanyze profile](https://www.datanyze.com/companies/saskatchewan-construction-association/1152795803)) | Couldn't confirm a public directory. |
| Merit Contractors (SK, MB, AB) | All | Open-shop contractor associations | [Merit SK on Saskatoon Chamber](https://thechamber.saskatoonchamber.com/list/member/merit-contractors-association-of-saskatchewan-7781.htm) | No public member list found. Useful for events and sponsorships. |

Lower-value sources: BBB categories and Scott's Directories list electrical contractors by city, but they're third-party listings with no fit information.

## Method

- **Skills used:** lead triage (fit and intent scoring and ranking), account research (site-based fit and hooks), draft outreach (opening lines and one ready-to-paste email).
- **Not available:** no CRM, email or enrichment connector was signed in (HubSpot, Salesforce, Apollo, ZoomInfo and similar need authorizing through /mcp). That means no check against an existing CRM or past email threads. Your CSV was treated as the full book, and company websites were the only research source.
- **Site visits:** 49 page fetches, a little over the 45 budget: 44 company homepages, 1 redirect for Pentec, 2 failed Apex attempts and 2 association sites. No services pages were needed, because every homepage that loaded said enough to judge fit.
- Nothing was emailed, submitted or signed up for.
