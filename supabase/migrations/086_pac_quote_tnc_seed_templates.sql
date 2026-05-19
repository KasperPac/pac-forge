-- ============================================================
-- 086_pac_quote_tnc_seed_templates.sql
-- Seed the Pac Standard T&C templates: Fixed Price (default) and
-- Time & Materials. Clauses are inserted in the order they should
-- appear in the rendered document.
-- Source-of-truth spec: Docs/superpowers/specs/2026-05-19-tnc-templates-design.md
-- ============================================================

DO $seed$
DECLARE
  fp_id uuid := '7bc40000-0000-4000-8000-000000000001';
  tm_id uuid := '7bc40000-0000-4000-8000-000000000002';
BEGIN

-- ------------------------------------------------------------
-- Template 1: Pac Standard — Fixed Price 2026 (default)
-- ------------------------------------------------------------
INSERT INTO tnc_templates (id, name, version, status, is_default)
VALUES (fp_id, 'Pac Standard — Fixed Price 2026', 1, 'active', true);

INSERT INTO tnc_clauses (template_id, clause_number, title, body_markdown, ordering) VALUES

(fp_id, '1', 'Scope and Variations', $body$
The scope of work, deliverables, and pricing set out in this quotation define the agreement between Pac Technologies Pty Ltd ("Pac") and the customer ("Customer"). Anything not expressly included is excluded.

Variations to the scope of work must be agreed in writing before Pac commences the varied work. Oral instructions, site discussions, or email threads do not constitute a variation unless confirmed by Pac in writing with a price impact and any consequential change to the program. Pac is not obliged to perform varied work until the variation is approved by the Customer in writing.
$body$, 0),

(fp_id, '2', 'Price and Payment', $body$
Quotation prices are exclusive of GST and valid for 30 days from the issue date unless otherwise stated. Payment is on the following schedule unless otherwise specified in the quotation:

- **40%** deposit, payable on Customer's purchase order or written acceptance of the quotation;
- **50%** on delivery of the software or installed works;
- **10%** retention, payable on Customer's written acceptance of commissioning.

Each invoice is a payment claim made under the applicable Security of Payment legislation in the state where the work was performed (the *Building Industry Fairness (Security of Payment) Act 2017 (Qld)* for work performed in Queensland, or the *Building and Construction Industry Security of Payment Act 2002 (Vic)* for work performed in Victoria). Payment terms are 30 calendar days from the date of invoice. Overdue amounts attract interest at the Reserve Bank of Australia cash rate plus 4% per annum, calculated daily and compounded monthly.
$body$, 1),

(fp_id, '3', 'Programme and Acceptance', $body$
Any program or delivery dates indicated in the quotation are estimates based on the assumptions stated and on Customer meeting its obligations under clause A1. Pac will use reasonable endeavours to meet stated dates but does not guarantee delivery on a specific date.

Acceptance occurs at the earlier of (a) Customer's written sign-off of factory acceptance test (FAT), site acceptance test (SAT), or commissioning, as applicable; or (b) the deliverable being put into beneficial use by Customer or the end user. Acceptance starts the defects liability period under clause 5.
$body$, 2),

(fp_id, '4', 'Hours of Work', $body$
Pricing is based on work performed during business hours: **0700–1800 Monday to Friday, excluding public holidays applicable at the work location**. Work outside these hours, including overnight commissioning, weekend shutdowns, and public holidays, requires written approval and is billed at the agreed out-of-hours rate captured in a variation under clause 1.

Where engineers based in different states (Pac has offices in Brisbane and Melbourne) work on the same engagement, the public holidays of the state in which each engineer is physically working apply to that engineer's time.
$body$, 3),

(fp_id, '5', 'Defects Liability', $body$
Pac warrants its workmanship for a period of **12 months from the date of acceptance** under clause 3 (the "Defects Liability Period"). During this period Pac will, at no cost to Customer, repair or replace any deliverable that fails to perform substantially in accordance with the agreed specification due to a defect in Pac's workmanship.

The warranty does not apply to: (a) wear and tear; (b) damage caused by misuse, mishandling, or operation outside specified parameters; (c) modifications made to the deliverable by anyone other than Pac; (d) faults caused by Customer-supplied hardware, software, or data; or (e) consequential damage to Customer's plant arising from a defect.
$body$, 4),

(fp_id, '6', 'Intellectual Property', $body$
On full payment, ownership of the **project-specific source code** Pac writes for the Customer transfers to the Customer.

Pac's **reusable libraries, function-block templates, screens, faceplates, frameworks, and patterns** ("Pac Libraries") remain the intellectual property of Pac. The Customer is granted a **perpetual, royalty-free, non-exclusive licence** to use the Pac Libraries embedded in the deliverable for the operation, maintenance, and reasonable modification of the Customer's plant only. The licence does not permit on-sale, redistribution outside the Customer's group, or use in other projects.

Customer's plant data, P&IDs, IO lists, electrical drawings, and operational information remain the Customer's property and are treated as confidential under clause A2.
$body$, 5),

(fp_id, '7', 'Liability', $body$
Pac's total aggregate liability under or in connection with this engagement, whether in contract, tort (including negligence), under statute, or otherwise, is **capped at the total amount paid by Customer under this quotation**.

Neither party is liable for **indirect or consequential loss**, including loss of profit, loss of production, loss of opportunity, or loss of data, regardless of the cause.

The cap and exclusions in this clause do not apply to: (a) liability for death or personal injury caused by negligence; (b) liability for intellectual property infringement; or (c) liability that cannot lawfully be limited.
$body$, 6),

(fp_id, '8', 'Termination', $body$
Either party may terminate this engagement on **14 days' written notice** if the other party is in material breach and has not remedied the breach within that period. The Customer may also terminate for convenience on written notice, in which case Pac is entitled to payment for all work performed up to the date of termination plus reasonable demobilisation costs.

On termination, all amounts payable to Pac up to the date of termination become immediately due. Clauses 5 (Defects Liability), 6 (IP), 7 (Liability), A2 (Confidentiality), and A6 (Dispute Resolution) survive termination.
$body$, 7),

(fp_id, 'A1', 'Customer Obligations', $body$
The Customer agrees to:

- Provide accurate and complete IO lists, P&IDs, electrical drawings, network diagrams, and any other technical information Pac reasonably requires;
- Provide safe and timely access to site, including electrical isolation, lock-out / tag-out, and any required permits or inductions;
- Make Customer's plant available for the agreed FAT, SAT, and commissioning windows;
- Identify a single technical point-of-contact for the duration of the engagement with authority to approve variations and acceptance.

Pac is not liable for delays, additional cost, or rework caused by inaccurate, incomplete, or late-supplied information from the Customer. Such delays may give rise to a variation under clause 1.
$body$, 8),

(fp_id, 'A2', 'Confidentiality', $body$
Each party will treat the other's confidential information in strict confidence and use it only for the purposes of this engagement. This obligation survives termination by **three years**, except for trade secrets and personal information, which are protected indefinitely.

Confidential information does not include information that is or becomes public through no fault of the receiving party, is independently developed without reference to the other's information, or is required to be disclosed by law (with prior notice to the disclosing party where lawful).
$body$, 9),

(fp_id, 'A3', 'Force Majeure', $body$
Neither party is liable for delay or failure to perform caused by events beyond its reasonable control, including acts of God, natural disasters, strikes, industrial action, pandemic public-health orders, war, terrorism, civil unrest, or supplier failure not foreseeable at the time of the quotation.

The affected party must notify the other promptly, take reasonable steps to mitigate, and resume performance as soon as practicable. If the event continues for more than **60 days**, either party may terminate without penalty under clause 8.
$body$, 10),

(fp_id, 'A4', 'Insurance', $body$
Pac maintains:

- **Professional indemnity** insurance to a minimum of **AUD $5 million** per claim;
- **Public and product liability** insurance to a minimum of **AUD $20 million** per occurrence;
- **Workers compensation** insurance as required by Queensland law.

Pac will provide certificates of currency on request. The Customer is responsible for insuring its plant, equipment, and operations against property and business-interruption risk.
$body$, 11),

(fp_id, 'A5', 'Cybersecurity and Network Security', $body$
The Customer is responsible for the security of its operational technology (OT) network, control system network, and any IT infrastructure that Pac connects to during the engagement.

Pac will follow the Customer's documented cybersecurity procedures and reasonable directions while on site or connected remotely. Pac is not liable for cyber-attack, malware, intrusion, or data loss originating from or facilitated by the Customer's network, systems, or third-party suppliers, except where caused by Pac's negligent failure to follow Customer's documented procedures.

Remote access by Pac, when used, will be via a VPN or jump host nominated by the Customer.
$body$, 12),

(fp_id, 'A6', 'Dispute Resolution', $body$
If a dispute arises, the parties will first attempt to resolve it through good-faith negotiation at senior management level within **14 days** of written notice. If unresolved, the parties will refer the dispute to mediation administered by the **Resolution Institute** under its mediation rules. If mediation does not resolve the dispute within 30 days of referral, either party may commence proceedings.

Nothing in this clause prevents either party from seeking urgent injunctive relief.
$body$, 13),

(fp_id, 'A7', 'Sub-subcontracting', $body$
Pac may subcontract specialist tasks (e.g. cabinet manufacture, electrical install, panel wiring, scaffolding) to qualified third parties without the Customer's consent. Pac remains responsible to the Customer for the performance of its sub-subcontractors.

Named key personnel identified in the quotation, where any, will not be substituted without the Customer's prior written consent (not to be unreasonably withheld).
$body$, 14),

(fp_id, 'A8', 'Governing Law and General', $body$
This engagement is governed by the laws of Queensland, Australia. The parties submit to the exclusive jurisdiction of the courts of Queensland and the courts of appeal from them.

If any provision is held unenforceable, the remaining provisions remain in full force. Failure or delay by either party to enforce a right is not a waiver of that right. This quotation, together with any signed variation, constitutes the entire agreement between the parties on its subject matter and supersedes prior representations.

Any notice under this engagement must be given in writing to the addresses or email addresses set out in the quotation.
$body$, 15);

-- ------------------------------------------------------------
-- Template 2: Pac Standard — Time & Materials 2026
-- ------------------------------------------------------------
INSERT INTO tnc_templates (id, name, version, status, is_default)
VALUES (tm_id, 'Pac Standard — Time & Materials 2026', 1, 'active', false);

INSERT INTO tnc_clauses (template_id, clause_number, title, body_markdown, ordering) VALUES

(tm_id, '1', 'Scope and Rates', $body$
The Customer engages Pac to perform engineering services on a time-and-materials basis. The work is described at a high level in the quotation but is not bounded by a fixed scope; Pac will perform the work directed by the Customer's technical point-of-contact within the disciplines and rates set out in the quotation.

Rates set out in the quotation apply to engineering hours billed in 30-minute increments. Materials and third-party purchases are billed at cost plus a 10% administrative margin unless otherwise stated.

Variations to the agreed disciplines, rates, or spending caps must be agreed in writing before Pac performs the varied work.
$body$, 0),

(tm_id, '2', 'Payment Terms', $body$
Pac invoices monthly in arrears, with a detailed time-sheet attached to each invoice. Each invoice is a payment claim made under the applicable Security of Payment legislation in the state where the work was performed (the *Building Industry Fairness (Security of Payment) Act 2017 (Qld)* for work performed in Queensland, or the *Building and Construction Industry Security of Payment Act 2002 (Vic)* for work performed in Victoria). Payment terms are 30 calendar days from the date of invoice. Overdue amounts attract interest at the Reserve Bank of Australia cash rate plus 4% per annum, calculated daily and compounded monthly.

The Customer may set a written cap on cumulative spend; Pac will not exceed the cap without prior written approval.
$body$, 1),

(tm_id, '3', 'Programme and Acceptance', $body$
There is no fixed program or formal acceptance milestone for time-and-materials engagements. Discrete deliverables may be subject to written acceptance if specified in the quotation; in that case clause 5 applies to those deliverables only.
$body$, 2),

(tm_id, '4', 'Hours of Work', $body$
Pricing is based on work performed during business hours: **0700–1800 Monday to Friday, excluding public holidays applicable at the work location**. Work outside these hours, including overnight commissioning, weekend shutdowns, and public holidays, requires written approval and is billed at the agreed out-of-hours rate captured in a variation under clause 1.

Where engineers based in different states (Pac has offices in Brisbane and Melbourne) work on the same engagement, the public holidays of the state in which each engineer is physically working apply to that engineer's time.
$body$, 3),

(tm_id, '5', 'Defects Liability', $body$
Pac's defects liability applies only to discrete identifiable deliverables expressly specified in the quotation. For any such deliverable, Pac warrants its workmanship for **12 months from the date of acceptance** and will repair or replace defects in workmanship at no additional cost.

General time-and-materials engineering work carries no warranty beyond Pac's professional duty of care. The exclusions in the Fixed Price defects liability clause apply equally here (wear and tear, misuse, third-party modification, Customer-supplied input faults, consequential damage).
$body$, 4),

(tm_id, '6', 'Intellectual Property', $body$
On full payment, ownership of the **project-specific source code** Pac writes for the Customer transfers to the Customer.

Pac's **reusable libraries, function-block templates, screens, faceplates, frameworks, and patterns** ("Pac Libraries") remain the intellectual property of Pac. The Customer is granted a **perpetual, royalty-free, non-exclusive licence** to use the Pac Libraries embedded in the deliverable for the operation, maintenance, and reasonable modification of the Customer's plant only. The licence does not permit on-sale, redistribution outside the Customer's group, or use in other projects.

Customer's plant data, P&IDs, IO lists, electrical drawings, and operational information remain the Customer's property and are treated as confidential under clause A2.
$body$, 5),

(tm_id, '7', 'Liability', $body$
Pac's total aggregate liability under or in connection with this engagement, whether in contract, tort (including negligence), under statute, or otherwise, is **capped at the total amount paid by Customer under this quotation**.

Neither party is liable for **indirect or consequential loss**, including loss of profit, loss of production, loss of opportunity, or loss of data, regardless of the cause.

The cap and exclusions in this clause do not apply to: (a) liability for death or personal injury caused by negligence; (b) liability for intellectual property infringement; or (c) liability that cannot lawfully be limited.
$body$, 6),

(tm_id, '8', 'Termination', $body$
Either party may terminate this engagement on **7 days' written notice** with or without cause. On termination, all hours worked and materials purchased up to the date of termination are billable and become immediately due.

Clauses 5 (Defects Liability, where it applies), 6 (IP), 7 (Liability), A2 (Confidentiality), and A6 (Dispute Resolution) survive termination.
$body$, 7),

(tm_id, '9', 'Travel Time and Expenses', $body$
Travel time to and from site is **billable at standard engineering rates**. Travel from Pac's office locations (**Brisbane CBD or Melbourne CBD**, whichever is closest to the assigned engineer's home base) is excluded for the first 30 minutes each way; beyond that, full rates apply.

Airfares, accommodation, hire vehicles, fuel, parking, tolls, meals, and other reasonable travel expenses are billed **at cost plus a 10% administrative margin**.
$body$, 8),

(tm_id, '10', 'Standby Time', $body$
If Pac engineers are on site or have mobilised to site and are unable to perform work due to delays outside Pac's control (e.g. permit not issued, plant not isolated, materials not delivered, area not made safe), the engineer's time is billed at **standby rate**: 100% of standard engineering rate.

Pac will use reasonable endeavours to redirect engineers to other productive work where practical and bill at standard rate for that work instead.
$body$, 9),

(tm_id, 'A1', 'Customer Obligations', $body$
The Customer agrees to:

- Provide accurate and complete IO lists, P&IDs, electrical drawings, network diagrams, and any other technical information Pac reasonably requires;
- Provide safe and timely access to site, including electrical isolation, lock-out / tag-out, and any required permits or inductions;
- Make Customer's plant available for the agreed test and commissioning windows where deliverables are specified;
- Identify a single technical point-of-contact with authority to direct Pac engineers, approve variations, and accept any specified deliverables.

The Customer acknowledges that on a time-and-materials basis Pac relies entirely on the accuracy of Customer-supplied information. Any defect, delay, or rework arising from inaccurate, incomplete, or out-of-date Customer-supplied information (including IO lists, P&IDs, electrical drawings, network configurations, plant tag databases, and operating procedures) is **billable as ordinary time-and-materials time** and is not a defect under clause 5.
$body$, 10),

(tm_id, 'A2', 'Confidentiality', $body$
Each party will treat the other's confidential information in strict confidence and use it only for the purposes of this engagement. This obligation survives termination by **three years**, except for trade secrets and personal information, which are protected indefinitely.

Confidential information does not include information that is or becomes public through no fault of the receiving party, is independently developed without reference to the other's information, or is required to be disclosed by law (with prior notice to the disclosing party where lawful).
$body$, 11),

(tm_id, 'A3', 'Force Majeure', $body$
Neither party is liable for delay or failure to perform caused by events beyond its reasonable control, including acts of God, natural disasters, strikes, industrial action, pandemic public-health orders, war, terrorism, civil unrest, or supplier failure not foreseeable at the time of the quotation.

The affected party must notify the other promptly, take reasonable steps to mitigate, and resume performance as soon as practicable. If the event continues for more than **60 days**, either party may terminate without penalty under clause 8.
$body$, 12),

(tm_id, 'A4', 'Insurance', $body$
Pac maintains:

- **Professional indemnity** insurance to a minimum of **AUD $5 million** per claim;
- **Public and product liability** insurance to a minimum of **AUD $20 million** per occurrence;
- **Workers compensation** insurance as required by Queensland law.

Pac will provide certificates of currency on request. The Customer is responsible for insuring its plant, equipment, and operations against property and business-interruption risk.
$body$, 13),

(tm_id, 'A5', 'Cybersecurity and Network Security', $body$
The Customer is responsible for the security of its operational technology (OT) network, control system network, and any IT infrastructure that Pac connects to during the engagement.

Pac will follow the Customer's documented cybersecurity procedures and reasonable directions while on site or connected remotely. Pac is not liable for cyber-attack, malware, intrusion, or data loss originating from or facilitated by the Customer's network, systems, or third-party suppliers, except where caused by Pac's negligent failure to follow Customer's documented procedures.

On time-and-materials engagements, Pac will not be held responsible for any time billed investigating, recovering from, or remediating cybersecurity incidents originating from the Customer's network — such time is fully billable as ordinary time-and-materials work.

Remote access by Pac, when used, will be via a VPN or jump host nominated by the Customer.
$body$, 14),

(tm_id, 'A6', 'Dispute Resolution', $body$
If a dispute arises, the parties will first attempt to resolve it through good-faith negotiation at senior management level within **14 days** of written notice. If unresolved, the parties will refer the dispute to mediation administered by the **Resolution Institute** under its mediation rules. If mediation does not resolve the dispute within 30 days of referral, either party may commence proceedings.

Nothing in this clause prevents either party from seeking urgent injunctive relief.
$body$, 15),

(tm_id, 'A7', 'Sub-subcontracting', $body$
Pac may subcontract specialist tasks (e.g. cabinet manufacture, electrical install, panel wiring, scaffolding) to qualified third parties without the Customer's consent. Pac remains responsible to the Customer for the performance of its sub-subcontractors.

Named key personnel identified in the quotation, where any, will not be substituted without the Customer's prior written consent (not to be unreasonably withheld).
$body$, 16),

(tm_id, 'A8', 'Governing Law and General', $body$
This engagement is governed by the laws of Queensland, Australia. The parties submit to the exclusive jurisdiction of the courts of Queensland and the courts of appeal from them.

If any provision is held unenforceable, the remaining provisions remain in full force. Failure or delay by either party to enforce a right is not a waiver of that right. This quotation, together with any signed variation, constitutes the entire agreement between the parties on its subject matter and supersedes prior representations.

Any notice under this engagement must be given in writing to the addresses or email addresses set out in the quotation.
$body$, 17);

END $seed$;
