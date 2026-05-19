# T&C Templates — Pac Technologies (Queensland)

**Status:** Design spec — pending user review
**Date:** 2026-05-19
**Author:** Kasper + Claude (brainstorming)

---

## Context

Pac Technologies is an Australian SI sub working for head-contractor system integrators across all engagement shapes: PLC software only, software + on-site commissioning, full turnkey (cabinets/wiring/software/commissioning), and ongoing support / call-out work.

The Pac-Quote v1 module already supports a T&C library (`tnc_templates` + `tnc_clauses`) with template versioning, an `is_default` flag, and clause-level title + body markdown. The library is empty — there are no templates to start from. The user wants industry-standard starter templates that reflect how Pac actually contracts, not generic boilerplate copied off the web.

Two templates are needed because Pac runs two pricing models with different risk allocations:

1. **Fixed Price** — Pac bears most timing/delay/travel/standby risk inside the quoted price. Default for the majority of engagements.
2. **Time & Materials (do-and-charge)** — Customer bears those risks via billable line items. Used when scope is uncertain (e.g. fault-finding, retrofits, support).

The two templates share most clauses but T&M adds four billing-protection clauses (Travel, Standby, Data Accuracy emphasis, Cybersecurity emphasis).

**Approach validated through brainstorming:**

- Customer mix: SI partners (Pac is a sub) — no direct end-user relationships
- Liability cap: at quote value
- Payment: 40% deposit / 50% on delivery / 10% on commissioning sign-off
- IP: project code transfers on full payment; Pac libraries stay Pac with perpetual royalty-free site licence
- Warranty: 12 months from handover
- Office locations: Brisbane (head office) and Melbourne
- Governing law: Queensland (single governing law regardless of work state)
- SOPA: state-of-work flexible (QLD *Building Industry Fairness Act 2017* or Vic *Building and Construction Industry Security of Payment Act 2002*)
- Hours: 0700–1800 Mon–Fri, excluding public holidays at the work location
- Template shape: tiered (main terms + appendix)

**Research notes:**

- **AS 4122-2010** is the AU standard consulting services contract — basis for liability and dispute resolution language.
- **AS 4901** is the AU subcontract companion to AS 4000 — informs the "mirror the head contract" risk approach.
- **Queensland BIF Act 2017** governs payment claims, payment schedules, and adjudication. Invoices serving as payment claims must be endorsed accordingly.
- **Consult Australia** recommends balanced rights/obligations with liability caps — adopted here.

---

## Template 1: Pac Standard — Fixed Price 2026

**Use for:** Quoted fixed-price jobs of any of the four engagement shapes.
**Default:** Yes (`is_default = true`).
**Version:** 1.

### Tier 1 — Main Terms

#### 1 — Scope and Variations

The scope of work, deliverables, and pricing set out in this quotation define the agreement between Pac Technologies Pty Ltd ("Pac") and the customer ("Customer"). Anything not expressly included is excluded.

Variations to the scope of work must be agreed in writing before Pac commences the varied work. Oral instructions, site discussions, or email threads do not constitute a variation unless confirmed by Pac in writing with a price impact and any consequential change to the program. Pac is not obliged to perform varied work until the variation is approved by the Customer in writing.

#### 2 — Price and Payment

Quotation prices are exclusive of GST and valid for 30 days from the issue date unless otherwise stated. Payment is on the following schedule unless otherwise specified in the quotation:

- **40%** deposit, payable on Customer's purchase order or written acceptance of the quotation;
- **50%** on delivery of the software or installed works;
- **10%** retention, payable on Customer's written acceptance of commissioning.

Each invoice is a payment claim made under the applicable Security of Payment legislation in the state where the work was performed (the *Building Industry Fairness (Security of Payment) Act 2017 (Qld)* for work performed in Queensland, or the *Building and Construction Industry Security of Payment Act 2002 (Vic)* for work performed in Victoria). Payment terms are 30 calendar days from the date of invoice. Overdue amounts attract interest at the Reserve Bank of Australia cash rate plus 4% per annum, calculated daily and compounded monthly.

#### 3 — Programme and Acceptance

Any program or delivery dates indicated in the quotation are estimates based on the assumptions stated and on Customer meeting its obligations under clause A1. Pac will use reasonable endeavours to meet stated dates but does not guarantee delivery on a specific date.

Acceptance occurs at the earlier of (a) Customer's written sign-off of factory acceptance test (FAT), site acceptance test (SAT), or commissioning, as applicable; or (b) the deliverable being put into beneficial use by Customer or the end user. Acceptance starts the defects liability period under clause 5.

#### 4 — Hours of Work

Pricing is based on work performed during business hours: **0700–1800 Monday to Friday, excluding public holidays applicable at the work location**. Work outside these hours, including overnight commissioning, weekend shutdowns, and public holidays, requires written approval and is billed at the agreed out-of-hours rate captured in a variation under clause 1.

Where engineers based in different states (Pac has offices in Brisbane and Melbourne) work on the same engagement, the public holidays of the state in which each engineer is physically working apply to that engineer's time.

If the Customer requires out-of-hours work as part of the original engagement, this must be specified in the quotation and is priced accordingly.

#### 5 — Defects Liability

Pac warrants its workmanship for a period of **12 months from the date of acceptance** under clause 3 (the "Defects Liability Period"). During this period Pac will, at no cost to Customer, repair or replace any deliverable that fails to perform substantially in accordance with the agreed specification due to a defect in Pac's workmanship.

The warranty does not apply to: (a) wear and tear; (b) damage caused by misuse, mishandling, or operation outside specified parameters; (c) modifications made to the deliverable by anyone other than Pac; (d) faults caused by Customer-supplied hardware, software, or data; or (e) consequential damage to Customer's plant arising from a defect.

#### 6 — Intellectual Property

On full payment, ownership of the **project-specific source code** Pac writes for the Customer transfers to the Customer.

Pac's **reusable libraries, function-block templates, screens, faceplates, frameworks, and patterns** ("Pac Libraries") remain the intellectual property of Pac. The Customer is granted a **perpetual, royalty-free, non-exclusive licence** to use the Pac Libraries embedded in the deliverable for the operation, maintenance, and reasonable modification of the Customer's plant only. The licence does not permit on-sale, redistribution outside the Customer's group, or use in other projects.

Customer's plant data, P&IDs, IO lists, electrical drawings, and operational information remain the Customer's property and are treated as confidential under clause A2.

#### 7 — Liability

Pac's total aggregate liability under or in connection with this engagement, whether in contract, tort (including negligence), under statute, or otherwise, is **capped at the total amount paid by Customer under this quotation**.

Neither party is liable for **indirect or consequential loss**, including loss of profit, loss of production, loss of opportunity, or loss of data, regardless of the cause.

The cap and exclusions in this clause do not apply to: (a) liability for death or personal injury caused by negligence; (b) liability for intellectual property infringement; or (c) liability that cannot lawfully be limited.

#### 8 — Termination

Either party may terminate this engagement on **14 days' written notice** if the other party is in material breach and has not remedied the breach within that period. The Customer may also terminate for convenience on written notice, in which case Pac is entitled to payment for all work performed up to the date of termination plus reasonable demobilisation costs.

On termination, all amounts payable to Pac up to the date of termination become immediately due. Clauses 5 (Defects Liability), 6 (IP), 7 (Liability), A2 (Confidentiality), and A6 (Dispute Resolution) survive termination.

---

### Tier 2 — Appendix

#### A1 — Customer Obligations

The Customer agrees to:

- Provide accurate and complete IO lists, P&IDs, electrical drawings, network diagrams, and any other technical information Pac reasonably requires;
- Provide safe and timely access to site, including electrical isolation, lock-out / tag-out, and any required permits or inductions;
- Make Customer's plant available for the agreed FAT, SAT, and commissioning windows;
- Identify a single technical point-of-contact for the duration of the engagement with authority to approve variations and acceptance.

Pac is not liable for delays, additional cost, or rework caused by inaccurate, incomplete, or late-supplied information from the Customer. Such delays may give rise to a variation under clause 1.

#### A2 — Confidentiality

Each party will treat the other's confidential information in strict confidence and use it only for the purposes of this engagement. This obligation survives termination by **three years**, except for trade secrets and personal information, which are protected indefinitely.

Confidential information does not include information that is or becomes public through no fault of the receiving party, is independently developed without reference to the other's information, or is required to be disclosed by law (with prior notice to the disclosing party where lawful).

#### A3 — Force Majeure

Neither party is liable for delay or failure to perform caused by events beyond its reasonable control, including acts of God, natural disasters, strikes, industrial action, pandemic public-health orders, war, terrorism, civil unrest, or supplier failure not foreseeable at the time of the quotation.

The affected party must notify the other promptly, take reasonable steps to mitigate, and resume performance as soon as practicable. If the event continues for more than **60 days**, either party may terminate without penalty under clause 8.

#### A4 — Insurance

Pac maintains:

- **Professional indemnity** insurance to a minimum of **AUD $5 million** per claim;
- **Public and product liability** insurance to a minimum of **AUD $20 million** per occurrence;
- **Workers compensation** insurance as required by Queensland law.

Pac will provide certificates of currency on request. The Customer is responsible for insuring its plant, equipment, and operations against property and business-interruption risk.

#### A5 — Cybersecurity and Network Security

The Customer is responsible for the security of its operational technology (OT) network, control system network, and any IT infrastructure that Pac connects to during the engagement.

Pac will follow the Customer's documented cybersecurity procedures and reasonable directions while on site or connected remotely. Pac is not liable for cyber-attack, malware, intrusion, or data loss originating from or facilitated by the Customer's network, systems, or third-party suppliers, except where caused by Pac's negligent failure to follow Customer's documented procedures.

Remote access by Pac, when used, will be via a VPN or jump host nominated by the Customer.

#### A6 — Dispute Resolution

If a dispute arises, the parties will first attempt to resolve it through good-faith negotiation at senior management level within **14 days** of written notice. If unresolved, the parties will refer the dispute to mediation administered by the **Resolution Institute** under its mediation rules. If mediation does not resolve the dispute within 30 days of referral, either party may commence proceedings.

Nothing in this clause prevents either party from seeking urgent injunctive relief.

#### A7 — Sub-subcontracting

Pac may subcontract specialist tasks (e.g. cabinet manufacture, electrical install, panel wiring, scaffolding) to qualified third parties without the Customer's consent. Pac remains responsible to the Customer for the performance of its sub-subcontractors.

Named key personnel identified in the quotation, where any, will not be substituted without the Customer's prior written consent (not to be unreasonably withheld).

#### A8 — Governing Law and General

This engagement is governed by the laws of Queensland, Australia. The parties submit to the exclusive jurisdiction of the courts of Queensland and the courts of appeal from them.

If any provision is held unenforceable, the remaining provisions remain in full force. Failure or delay by either party to enforce a right is not a waiver of that right. This quotation, together with any signed variation, constitutes the entire agreement between the parties on its subject matter and supersedes prior representations.

Any notice under this engagement must be given in writing to the addresses or email addresses set out in the quotation.

---

## Template 2: Pac Standard — Time & Materials 2026

**Use for:** Do-and-charge engagements where scope is uncertain — fault-finding, support call-outs, retrofits with unknown scope, ad-hoc engineering time.
**Default:** No.
**Version:** 1.

The Time & Materials template **inherits** all clauses from the Fixed Price template above except where amended or added below. The clauses that differ or are added are:

### Amended Main Terms

#### 1 — Scope and Rates (replaces Fixed Price clause 1)

The Customer engages Pac to perform engineering services on a time-and-materials basis. The work is described at a high level in the quotation but is not bounded by a fixed scope; Pac will perform the work directed by the Customer's technical point-of-contact within the disciplines and rates set out in the quotation.

Rates set out in the quotation apply to engineering hours billed in 30-minute increments. Materials and third-party purchases are billed at cost plus a 10% administrative margin unless otherwise stated.

#### 2 — Payment Terms (replaces Fixed Price clause 2)

Pac invoices monthly in arrears, with a detailed time-sheet attached to each invoice. Each invoice is a payment claim made under the applicable Security of Payment legislation in the state where the work was performed (the *Building Industry Fairness (Security of Payment) Act 2017 (Qld)* for work performed in Queensland, or the *Building and Construction Industry Security of Payment Act 2002 (Vic)* for work performed in Victoria). Payment terms are 30 calendar days from the date of invoice. Overdue amounts attract interest at the Reserve Bank of Australia cash rate plus 4% per annum, calculated daily and compounded monthly.

The Customer may set a written cap on cumulative spend; Pac will not exceed the cap without prior written approval.

### Added Main Terms

#### 9 — Travel Time and Expenses

Travel time to and from site is **billable at standard engineering rates**. Travel from Pac's office locations (**Brisbane CBD or Melbourne CBD**, whichever is closest to the assigned engineer's home base) is excluded for the first 30 minutes each way; beyond that, full rates apply.

Airfares, accommodation, hire vehicles, fuel, parking, tolls, meals, and other reasonable travel expenses are billed **at cost plus a 10% administrative margin**.

#### 10 — Standby Time

If Pac engineers are on site or have mobilised to site and are unable to perform work due to delays outside Pac's control (e.g. permit not issued, plant not isolated, materials not delivered, area not made safe), the engineer's time is billed at **standby rate**: 100% of standard engineering rate.

Pac will use reasonable endeavours to redirect engineers to other productive work where practical and bill at standard rate for that work instead.

### Amended Appendix

#### A1 — Customer Obligations (T&M emphasis)

The Customer Obligations clause is **strengthened** for T&M engagements:

In addition to the Fixed Price obligations, the Customer acknowledges that on a time-and-materials basis Pac relies entirely on the accuracy of Customer-supplied information. Any defect, delay, or rework arising from inaccurate, incomplete, or out-of-date Customer-supplied information (including IO lists, P&IDs, electrical drawings, network configurations, plant tag databases, and operating procedures) is **billable as ordinary T&M time** and is not a defect under clause 5.

#### A5 — Cybersecurity (T&M emphasis)

Cybersecurity provisions from the Fixed Price template apply. In addition, on T&M engagements Pac will not be held responsible for any time billed investigating, recovering from, or remediating cybersecurity incidents originating from the Customer's network — such time is fully billable as ordinary T&M work.

### Removed / Adjusted

- **Clause 3 (Programme and Acceptance)** — replaced with: "There is no fixed program or formal acceptance milestone for T&M engagements. Discrete deliverables may be subject to written acceptance if specified in the quotation."
- **Clause 5 (Defects Liability)** — applies only to discrete identifiable deliverables specified in the quotation. General T&M engineering work carries no warranty beyond Pac's professional duty of care.
- **Clause 8 (Termination)** — either party may terminate on **7 days' written notice**; on termination, all hours worked to the date of termination are billable.

---

## How to load into the T&C library

The Pac-Quote T&C admin route (`/tnc`) supports template + clause creation via the UI. The recommended path is:

1. Open `/tnc`.
2. Click "New template", enter `Pac Standard — Fixed Price 2026`, version `1`, status `active`, default `true`.
3. For each clause in this spec (1 through 8, then A1 through A8), click "Add clause" and paste the clause number, title, and body markdown.
4. Repeat for `Pac Standard — Time & Materials 2026` with default `false`. For the T&M template, paste the inherited clauses from Fixed Price unchanged, then apply the amendments and additions described above.

Alternative path: a one-off SQL seed migration. If the user prefers, an implementation plan can produce a migration file that inserts both templates and all clauses with deterministic UUIDs.

---

## Out of scope (deliberate)

- **Modern slavery statement** — Pac is below the $100M revenue threshold; not required.
- **Anti-bribery / anti-corruption** — covered implicitly under "Governing Law"; head contractor's flow-down will cover this for any relevant engagement.
- **Software escrow** — Pac source transfers on payment, so escrow is not required.
- **Data privacy / Privacy Act** — Pac doesn't handle personal data in OT systems by default; can be added per engagement if the SI head contract requires it.
- **Liquidated damages** — explicitly not offered; risk is allocated via the liability cap in clause 7.
- **Performance guarantees / bonds** — not standard for Pac's engagement size; can be negotiated per quote.

---

## Open questions / things to confirm before sign-off

- **Resolution Institute** is the default mediation administrator. Confirm Pac is happy with this vs. RICS or ad-hoc.
- **Insurance limits** — $5M PI / $20M PL are typical for AU SI subs; confirm these match Pac's actual policy.
- **Travel time exemption** is set to the first 30 minutes from Brisbane CBD or Melbourne CBD (whichever is closest to the assigned engineer). Confirm this matches Pac's existing practice, or strike it.
- **Governing law stays QLD** even for work performed by the Melbourne office. If the user prefers governing law to follow the office serving the customer, the dispute resolution clause needs splitting per template variant — flag if so.
- **Late-payment interest** is set to RBA cash rate + 4%. Confirm or change to a fixed rate.
- **Materials margin** is 10%. Confirm or change.

Once these are confirmed, the spec is ready for implementation (loading into the T&C library).
