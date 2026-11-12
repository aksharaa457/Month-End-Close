import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "erp.db")

def init_database():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 1. Entities
    c.execute("""
    CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        period TEXT NOT NULL,
        status TEXT NOT NULL,
        progress_pct REAL NOT NULL,
        tasks_completed INTEGER NOT NULL,
        total_tasks INTEGER NOT NULL,
        open_tasks INTEGER NOT NULL,
        target_date TEXT NOT NULL,
        projected_close TEXT NOT NULL,
        is_active INTEGER DEFAULT 0
    )
    """)

    entities_data = [
        ("global-close", "Global Close", "Aug 2026", "At risk", 44.8, 5, 14, 9, "12 Sep 2026", "D+8.0", 1),
        ("tech-uniapps-india", "Tech Uniapps India", "Aug 2026", "Needs review", 50.0, 6, 14, 8, "12 Sep 2026", "D+7.0", 0),
        ("uniapps-inc", "UnifyApps Inc.", "Aug 2026", "On track", 56.7, 6, 14, 8, "12 Sep 2026", "D+4.5", 0),
        ("uniapps-sales-me", "UnifyApps Sales ME", "Aug 2026", "At risk", 42.1, 5, 14, 9, "12 Sep 2026", "D+8.5", 0),
        ("uniapps-me-fz", "UnifyApps ME FZ", "Aug 2026", "At risk", 35.7, 5, 14, 9, "12 Sep 2026", "D+9.0", 0),
        ("unify-arabia", "Unify Arabia", "Aug 2026", "Needs review", 28.6, 4, 14, 10, "12 Sep 2026", "D+9.5", 0),
        ("uniapps-eu", "Unifyapps EU", "Aug 2026", "SET UP REQUIRED", 0.0, 0, 14, 14, "15 Sep 2026", "Pending", 0)
    ]
    c.executemany("INSERT INTO entities VALUES (?,?,?,?,?,?,?,?,?,?,?)", entities_data)

    # 2. Enterprise Brain Sources
    c.execute("""
    CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        details TEXT NOT NULL,
        connected INTEGER DEFAULT 1,
        via_brain INTEGER DEFAULT 1
    )
    """)

    sources_data = [
        ("src-slack", "Communication", "Slack", "#finance-close, #ap-approvals, #project-updates. Threads, files and decisions.", 1, 1),
        ("src-gdrive", "Documents & budget", "Google Drive", "Finance shared drive - Budgets FY26, board packs.", 1, 1),
        ("src-sharepoint", "Documents & budget", "Microsoft SharePoint", "IntraNet/Finance - Cost and Budgets libraries.", 1, 1),
        ("src-dropbox", "Documents & budget", "Dropbox", "/Finance/archive - Vendor and audit exchanges.", 1, 1),
        ("src-netsuite", "Ledger", "NetSuite", "Primary entity general ledgers, sub-ledgers & charts of accounts.", 1, 1),
        ("src-sap", "Ledger", "SAP S/4HANA", "Regional ERP entity feeds and live journal vouchers.", 1, 1),
        ("src-salesforce", "Contracts & CRM", "Salesforce", "Signed deals, customer contracts, ARR schedules, billing terms.", 1, 1),
        ("src-hubspot", "Contracts & CRM", "HubSpot", "Sales contracts, deal signatures, trigger events.", 1, 1),
        ("src-stripe", "Billing & usage", "Stripe", "Metered billing events, payment webhooks, subscription schedules.", 1, 1),
        ("src-banking", "Banking", "Open Banking", "Live transaction feeds, bank statements, cash positions.", 1, 1)
    ]
    c.executemany("INSERT INTO sources VALUES (?,?,?,?,?,?)", sources_data)

    # 3. Checklist Tasks
    c.execute("""
    CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        assignee TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_by_ai INTEGER DEFAULT 0,
        ai_reasoning TEXT,
        order_index INTEGER NOT NULL
    )
    """)

    tasks_data = [
        ("task-1", "global-close", "PRE-CLOSE", "Confirm cut-off dates with all entities", 
         "Cut-off timestamps from every connected ledger and matched to the close calendar.", 
         "Aman Agrawal", "Done", 1, 
         "Enterprise Brain reconciled cut-off timestamps across 14 connected systems and matched them to the close calendar.", 1),
        ("task-2", "global-close", "PRE-CLOSE", "Lock period in source system", 
         "Period lock verified in the source ledger - no postings after cut-off.", 
         "Aman Agrawal", "Done", 1, 
         "Period lock verified across NetSuite and SAP S/4HANA instances without unauthorized postings.", 2),
        ("task-3", "global-close", "RECONCILIATIONS", "AP reconciliation", 
         "Accounts payable sub-ledger reconciled against GL balances.", 
         "Aman Agrawal", "Done", 0, None, 3),
        ("task-4", "global-close", "RECONCILIATIONS", "Fixed deposit reconciliation", 
         "Interest accrued and bank confirmation statements matched.", 
         "Aman Agrawal", "Done", 0, None, 4),
        ("task-5", "global-close", "RECONCILIATIONS", "Bank Reconciliation", 
         "Bank reconciled against statements, unmatched items raised as variances.", 
         "Aman Agrawal", "Done", 0, None, 5),
        ("task-6", "global-close", "ACCRUALS", "Controller sign-off on all accrual entries", 
         "Accrual & prepaid is worked - 37% done.", 
         "S. Bakr", "In progress", 0, None, 6),
        ("task-7", "global-close", "ACCRUALS", "Review all accrual entries", 
         "Review automated ledger detections for vendor invoices and unbilled receipts.", 
         "S. Bakr", "In progress", 0, None, 7),
        ("task-8", "global-close", "CLOSING REVENUE", "All receipts mapped to respective customers", 
         "Customer payment allocations validated against billing engine.", 
         "Aman Agrawal", "To do", 0, None, 8),
        ("task-9", "global-close", "CLOSING REVENUE", "Post depreciation in Journal Entry", 
         "Fixed asset schedule calculated; journal entries drafted for review.", 
         "D. Okonjo", "In progress", 0, None, 9),
        ("task-10", "global-close", "INTERCOMPANY", "Intercompany balance matching & eliminations", 
         "Cross-entity balances reconciled across 6 regional entities.", 
         "A. Roy", "In progress", 0, None, 10),
        ("task-11", "global-close", "COMPLIANCE", "ASC 606 revenue recognition audit", 
         "135 customer contracts verified against performance milestones.", 
         "D. Okonjo", "In progress", 0, None, 11),
        ("task-12", "global-close", "COMPLIANCE", "Statutory tax provision calculation", 
         "Indirect tax and withholding computations generated from GL.", 
         "Ishaan Jain", "To do", 0, None, 12),
        ("task-13", "global-close", "BOARD PACK", "Generate preliminary financial statements", 
         "Draft Balance Sheet, P&L, and Cash Flow statement compilation.", 
         "Ishaan Jain", "To do", 0, None, 13),
        ("task-14", "global-close", "BOARD PACK", "CFO executive summary deck generation", 
         "Automated close narrative with key variance highlights.", 
         "Ishaan Jain", "To do", 0, None, 14)
    ]
    c.executemany("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)", tasks_data)

    # 4. Subtasks
    c.execute("""
    CREATE TABLE subtasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        is_completed INTEGER DEFAULT 0,
        is_ai_drafted INTEGER DEFAULT 1
    )
    """)

    subtasks_data = [
        ("sub-1", "task-1", "Read the cut-off timestamp from each connected ledger", 1, 1),
        ("sub-2", "task-1", "Compare every entity against the close calendar", 1, 1),
        ("sub-3", "task-1", "Flag entities whose cut-off moved since last close", 1, 1),
        ("sub-4", "task-2", "Validate NetSuite period status is Locked", 1, 1),
        ("sub-5", "task-2", "Check SAP transaction posting block flag", 1, 1),
        ("sub-6", "task-6", "Cross-examine unbilled AWS hosting consumption", 0, 1),
        ("sub-7", "task-6", "Verify Fivora consulting milestone approvals", 0, 1)
    ]
    c.executemany("INSERT INTO subtasks VALUES (?,?,?,?,?)", subtasks_data)

    # 5. Task Comments
    c.execute("""
    CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT NOT NULL,
        content TEXT NOT NULL
    )
    """)

    # 6. Accruals & Prepaid Proposals
    c.execute("""
    CREATE TABLE accrual_proposals (
        id TEXT PRIMARY KEY,
        vendor_name TEXT NOT NULL,
        category TEXT NOT NULL,
        amount_display TEXT NOT NULL,
        numeric_amount REAL NOT NULL,
        needs_type TEXT NOT NULL,
        action_note TEXT NOT NULL,
        status TEXT DEFAULT 'SUGGESTED'
    )
    """)

    accrual_proposals_data = [
        ("acc-1", "AMAZON WEB SERVICES INDIA PRIVATE LIMITED", "Hosting / Cloud", "-$1.3M", -1300000.0, "Accrual", "Check the rate", "SUGGESTED"),
        ("acc-2", "FIVORA CONSULTING LLP", "Professional Charges", "3.00 lacs", 300000.0, "Accrual", "Check the rate", "SUGGESTED"),
        ("acc-3", "Deloitte Touche Tohmatsu India LLP", "Professional Charges", "2.64 lacs", 264000.0, "Accrual", "Check the rate", "SUGGESTED"),
        ("acc-4", "TRAVELSTACK TECH PRIVATE LIMITED", "Travel", "100", 100.0, "Accrual", "Check the rate", "SUGGESTED"),
        ("acc-5", "Snowflake Software Inc.", "Software", "$42,500", 42500.0, "Accrual", "Auto-matched", "SUGGESTED"),
        ("acc-6", "Datadog Cloud Monitoring", "Hosting / Cloud", "$18,200", 18200.0, "Accrual", "Auto-matched", "SUGGESTED")
    ]
    c.executemany("INSERT INTO accrual_proposals VALUES (?,?,?,?,?,?,?,?)", accrual_proposals_data)

    # 7. Recognition & Compliance (ASC 606 & Gating Queue)
    c.execute("""
    CREATE TABLE gating_contracts (
        id TEXT PRIMARY KEY,
        customer_name TEXT NOT NULL,
        contract_code TEXT NOT NULL,
        arr REAL NOT NULL,
        monthly_amount REAL NOT NULL,
        status TEXT NOT NULL,
        owner TEXT NOT NULL,
        asc_status TEXT NOT NULL,
        schedule_info TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        trigger_rule TEXT NOT NULL,
        source_evidence TEXT NOT NULL,
        ai_recommendation TEXT NOT NULL,
        user_justification TEXT
    )
    """)

    contracts_data = [
        ("gating-1", "Dubai Chamber of Commerce", "C-4 / CONTRACT-1011", 36000.0, 3000.0, "NEEDS REVIEW", 
         "Shubhang K", "In review", "5 of 12 (v1 of 1)", "2026-10-01", "2027-09-30",
         "recognition_trigger = signature (HubSpot)", 
         "no trigger event for Aug 2026 recorded in HubSpot. Schedule v1 of 1 becomes effective Oct 26.", 
         "Defer to Sep (recommended)", None),
        ("gating-2", "Easy Data Integration", "C-7 / CONTRACT-1042", 45432.0, 3786.0, "NEEDS REVIEW", 
         "Shubhang K", "In review", "1 of 12 (v1 of 1)", "2026-09-01", "2027-08-31",
         "recognition_trigger = deployment_signoff (Jira)", 
         "Pending final deployment signoff from client security team.", 
         "Defer to Sep (recommended)", None),
        ("gating-3", "Credila Financial", "C-12 / CONTRACT-0988", 275000.0, 22917.0, "NEEDS REVIEW", 
         "Shubhang K", "In review", "8 of 12 (v2 of 2)", "2026-09-15", "2027-09-14",
         "recognition_trigger = usage_threshold (Stripe)", 
         "Metered API consumption under 80% threshold for monthly recognition gate.", 
         "Defer to Sep (recommended)", None),
        ("gating-4", "ChargePoint", "C-19 / CONTRACT-1102", 485000.0, 40417.0, "AUTO-APPLIED", 
         "Priya Sharma", "ASC 606 Verified", "3 of 12", "2026-08-01", "2027-07-31",
         "recognition_trigger = subscription_active (Stripe)", 
         "Active license key registered and telemetry confirmed in enterprise portal.", 
         "Start in Aug (recommended)", None),
        ("gating-5", "Aarti Industries", "C-23 / CONTRACT-1090", 28356.0, 2363.0, "AUTO-APPLIED", 
         "Priya Sharma", "ASC 606 Verified", "6 of 12", "2026-08-01", "2027-07-31",
         "recognition_trigger = contract_milestone_2 (Salesforce)", 
         "Milestone 2 deliverable accepted by client with digital signoff.", 
         "Start in Aug (recommended)", None),
        ("gating-6", "Emirates Rawabi", "C-29 / CONTRACT-1077", 175000.0, 14583.0, "AUTO-APPLIED", 
         "Priya Sharma", "ASC 606 Verified", "4 of 12", "2026-08-01", "2027-07-31",
         "recognition_trigger = monthly_schedule (NetSuite)", 
         "Standard recurring monthly SaaS license schedule active.", 
         "Start in Aug (recommended)", None)
    ]
    c.executemany("INSERT INTO gating_contracts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", contracts_data)

    # 8. Flux & Variance (P&L Lines)
    c.execute("""
    CREATE TABLE flux_variance (
        account_code TEXT PRIMARY KEY,
        parent_category TEXT NOT NULL,
        account_name TEXT NOT NULL,
        jul_amount REAL NOT NULL,
        aug_amount REAL NOT NULL,
        delta_amount REAL NOT NULL,
        delta_pct REAL NOT NULL,
        is_parent INTEGER DEFAULT 0,
        is_flagged INTEGER DEFAULT 1,
        status TEXT DEFAULT 'OPEN',
        ai_explanation TEXT,
        ai_context_note TEXT
    )
    """)

    variance_data = [
        ("INC-REC", "Income", "Recurring Revenue", 672258.25, 0.0, -672258.25, -100.0, 1, 1, "OPEN",
         "Every account under Recurring Revenue booked $672,258.25 in July and nil in August. Revenue does not stop; a nil month means the revenue close has not run for this period - recognition is still sitting in the gating queue, so nothing has posted to the P&L yet. Treat this as an unfinished close, not a $672,258.25 decline: no journal will fix it and no explanation is owed until the recognition run posts. Clear the 2 gating decisions in Recognition and compliance, refresh the snapshot, then read this line again.", None),
        ("40201001", "Income", "License / Subscription Fee", 572199.91, 0.0, -572199.91, -100.0, 0, 1, "OPEN",
         "License recognition gated pending Dubai Chamber and Credila contract gating determinations.", None),
        ("40201002", "Income", "Professional Fee", 100058.34, 0.0, -100058.34, -100.0, 0, 1, "OPEN",
         "Implementation milestones deferred awaiting client sign-off.", None),
        ("INC-TOT", "Income", "Total Income", 672258.25, 0.0, -672258.25, -100.0, 1, 1, "OPEN",
         "Consolidated income variance driven wholly by unposted August revenue recognition cycle.", None),
        ("60501001", "Operating Expenses", "Bank Charges", 1432.51, 49.04, -1383.47, -96.6, 0, 1, "OPEN",
         "Standard merchant transaction fees unbilled or delayed in bank statement sync.", None),
        ("60701002", "Operating Expenses", "Depreciation", 1570.62, 1626.04, 55.42, 3.5, 0, 0, "APPROVED",
         "Standard straight-line asset depreciation run completed.", None),
        ("EXP-EMP", "Operating Expenses", "Employee related cost", 188333.56, 445.0, -187888.56, -99.8, 1, 1, "OPEN",
         "Payroll journal entry pending final HR clearance and benefits accrual confirmation.", None),
        ("60104001", "Operating Expenses", "Hiring Charges", 0.0, 445.0, 445.0, 100.0, 0, 0, "OPEN",
         "Direct recruiter posting fee.", None),
        ("60105011", "Operating Expenses", "Payroll Expenses/Commissions", 188333.56, 0.0, -188333.56, -100.0, 0, 1, "OPEN",
         "Bi-weekly payroll voucher not yet posted into current ledger period.", None),
        ("60801001", "Operating Expenses", "Company Insurance", 8091.68, 2046.47, -6045.21, -74.7, 0, 1, "OPEN",
         "Quarterly policy premium amortization adjustment.", None),
        ("EXP-LEG", "Operating Expenses", "Legal and professional charges", 445671.28, 383371.73, -62299.55, -14.0, 1, 1, "OPEN",
         "Legal counsel retainers and audit advisory retainers under review.", None),
        ("60901001", "Operating Expenses", "Legal Charges", 19611.53, 2400.0, -17211.53, -87.8, 0, 1, "OPEN",
         "IP litigation retainer billed quarterly.", None),
        ("61001002", "Operating Expenses", "Management consulting & Strategy", 56588.02, 11500.0, -45088.02, -79.7, 0, 1, "OPEN",
         "Strategic engagement phase 1 concluded; phase 2 commences next cycle.", None)
    ]
    c.executemany("INSERT INTO flux_variance VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", variance_data)

    # 9. Child Attributions for Flux (e.g. for Recurring Revenue)
    c.execute("""
    CREATE TABLE flux_attributions (
        id TEXT PRIMARY KEY,
        parent_account_code TEXT NOT NULL,
        child_code TEXT NOT NULL,
        child_name TEXT NOT NULL,
        pct_contribution REAL NOT NULL,
        color TEXT NOT NULL
    )
    """)

    attributions_data = [
        ("attr-1", "INC-REC", "40201001", "License / Subscription Fee", 85.0, "#C93B2B"),
        ("attr-2", "INC-REC", "40201002", "Professional Fee", 15.0, "#C93B2B")
    ]
    c.executemany("INSERT INTO flux_attributions VALUES (?,?,?,?,?,?)", attributions_data)

    # 10. AI Context Logs
    c.execute("""
    CREATE TABLE ai_context_logs (
        id TEXT PRIMARY KEY,
        account_code TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT NOT NULL,
        note TEXT NOT NULL
    )
    """)

    # 11. Drafted Journal Entries (24 entries totaling $701k)
    c.execute("""
    CREATE TABLE journal_entries (
        id TEXT PRIMARY KEY,
        row_number INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        source_account_code TEXT NOT NULL,
        source_account_name TEXT NOT NULL,
        source_variance_amount REAL NOT NULL,
        entry_amount REAL NOT NULL,
        memo TEXT NOT NULL,
        status TEXT DEFAULT 'DRAFTED'
    )
    """)

    jes_data = [
        ("je-1", 1, "Correction", "40201001", "License / Subscription Fee", -572199.91, 354800.0, 
         "Flux adjustment - 40201001 License / Subscription Fee, per Aug 2026 variance review", "DRAFTED"),
        ("je-2", 2, "Correction", "40201002", "Professional Fee", -100058.34, 62000.0, 
         "Flux adjustment - 40201002 Professional Fee, per Aug 2026 variance review", "DRAFTED"),
        ("je-3", 3, "Reclass", "60501001", "Bank Charges", -1383.47, 900.0, 
         "Flux adjustment - 60501001 Bank Charges, per Aug 2026 variance review", "DRAFTED"),
        ("je-4", 4, "Accrual", "60105011", "Payroll Expenses/Commissions", -188333.56, 116800.0, 
         "Flux adjustment - 60105011 Payroll Expenses/Commissions, per Aug 2026 variance review", "DRAFTED"),
        ("je-5", 5, "Reclass", "60801001", "Company Insurance", -6045.21, 3700.0, 
         "Flux adjustment - 60801001 Company Insurance, per Aug 2026 variance review", "DRAFTED"),
        ("je-6", 6, "Reclass", "60901001", "Legal Charges", -17211.53, 2400.0, 
         "Flux adjustment - 60901001 Legal Charges, per Aug 2026 variance review", "DRAFTED"),
        ("je-7", 7, "Reclass", "61001002", "Management consulting & Strategy", -45088.02, 11500.0, 
         "Flux adjustment - 61001002 Management consulting & Strategy, per Aug 2026 variance review", "DRAFTED"),
        ("je-8", 8, "Accrual", "60301004", "AWS Hosting Infrastructure", -1300000.0, 85000.0, 
         "Accrual adjustment - Hosting run-rate estimate for Aug unbilled usage", "DRAFTED"),
        ("je-9", 9, "Correction", "40101001", "Direct Sales Software Licensing", -42000.0, 22000.0, 
         "Revenue alignment across customer accounts", "DRAFTED"),
        ("je-10", 10, "Reclass", "60401002", "Travel & Lodging - Executive", -12400.0, 6800.0, 
         "Expense reclassification to Q3 expansion budget", "DRAFTED"),
        ("je-11", 11, "Accrual", "60201001", "Deloitte Tax Advisory", -264000.0, 18400.0, 
         "Professional fee accrual per signed milestone confirmation", "DRAFTED"),
        ("je-12", 12, "Reclass", "60701001", "IT Hardware Amortization", -8200.0, 6700.0, 
         "Fixed asset schedule amortization correction", "DRAFTED")
    ]
    # Add filler to reach 24 entries totaling $701,000.00
    current_total = sum(item[6] for item in jes_data)
    remaining_entries = 24 - len(jes_data)
    amount_per_entry = (701000.0 - current_total) / remaining_entries

    for i in range(len(jes_data) + 1, 25):
        jes_data.append((
            f"je-{i}", i, "Reclass" if i % 2 == 0 else "Accrual", 
            f"60{i}01001", f"Operational Account Line {i}", -15000.0, 
            round(amount_per_entry, 2), 
            f"Flux adjustment - Line {i}, per Aug 2026 variance review", "DRAFTED"
        ))

    c.executemany("INSERT INTO journal_entries VALUES (?,?,?,?,?,?,?,?,?)", jes_data)

    conn.commit()
    conn.close()
    print("Database initialized successfully at:", DB_PATH)

if __name__ == "__main__":
    init_database()
