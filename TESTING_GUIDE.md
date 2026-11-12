# Continuous Close Hub — Continuous Close Solution
## Complete Step-by-Step Testing & Walkthrough Guide

This document provides a step-by-step guide to run, test, and verify the replicated **Continuous Close Hub** platform locally.

---

## 1. Quick Start

### Step 1.1: Open Terminal in the Project Directory
```bash
cd /Users/aksharajain/Desktop/erp
```

### Step 1.2: Initialize / Reset Local Database
Run the initialization script to populate the local SQLite database (`erp.db`) with the baseline data matching the demo video:
```bash
python3 init_db.py
```
> **Output:** `Database initialized successfully at: .../erp/erp.db`

### Step 1.3: Start the Local Application Server
Start the lightweight Python server:
```bash
python3 server.py
```
> **Output:** `ERP Continuous Close Platform running at http://localhost:8000`

*(If the server is already running in the background, you can proceed directly to Step 1.4).*

### Step 1.4: Open in Your Browser
Open any web browser (Google Chrome, Safari, or Brave) and navigate to:
👉 **[http://localhost:8000](http://localhost:8000)**

---

## 2. Step-by-Step Testing Walkthrough

Follow these sequential steps to test each screen and interactive flow exactly as shown in the original video.

---

### Test 1: Month-End Close Acceleration (Multi-Entity Hub)
1. **Initial Screen**: Upon loading, you land on the **Month-End Close Acceleration** screen.
2. **Verify Header & Enterprise Brain Banner**:
   - Check the top banner: `ENTERPRISE BRAIN` with a green pulsing **`CONNECTED`** badge.
   - Check the **AI CLOSE FORECAST** alert card: notice the `D+8.0` prediction and drag highlights (9 overdue tasks, Accruals, Recognition, and Flux behind pace).
3. **Verify Entity Cards Grid**:
   - Observe the 7 regional entities with radial progress gauges:
     - **Global Close - Aug 2026**: `44.8%`, `Tasks Complete: 5 / 14`, Badge: `At risk`.
     - **Tech Uniapps India**: `50%`, `6 / 14`, Badge: `Needs review`.
     - **UnifyApps Inc.**: `56.7%`, `6 / 14`, Badge: `On track`.
     - **UnifyApps Sales ME**: `42.1%`, Badge: `At risk`.
     - **UnifyApps ME FZ**: `35.7%`, Badge: `At risk`.
     - **Unify Arabia**: `28.6%`, Badge: `Needs review`.
     - **Unifyapps EU**: Badge: `SET UP REQUIRED` with button `Set up ->`.
4. **Action**: Click on the **Global Close - Aug 2026** card (or click `View dashboard ->`).

---

### Test 2: Closure Overview (Global Close Cockpit)
1. **Interactive Close Burndown Chart**:
   - Locate the **Close burndown** SVG chart on the top left.
   - Verify the 3 plotted lines:
     - **PLAN** (dashed gray line descending to 0 by D+4).
     - **ACTUAL** (solid dark line showing actual progress up to D+4).
     - **AI PROJECTED** (dotted violet forecast line extending to D+8).
   - Notice the **highlighted vertical lavender column at `D+4`** marking the current close day.
   - Check the status pill in the top right: `+4.0D BEHIND PLAN`.
2. **Close Health Card**:
   - Observe the headline: **`D+8.0`** (`+4.0 vs plan`) with `AI PREDICTED` badge.
   - Notice the progress bar (`D+4 / 56% complete`, Target: 12 Sep 2026).
   - Check stats: `Tasks complete: 5 of 14`, `Open tasks: 9`, `Overdue tasks: 3` (red alert).
   - Read the embedded **AI INSIGHT** card.
3. **Workload by Sub-Process Chart**:
   - Locate the bar chart comparing **COMPLETE** (green) vs **OPEN** (red) tasks for:
     - Pre-close (2 complete)
     - Reconciliations (3 complete)
     - Accruals (2 open)
     - Intercompany (2 open)
     - Compliance (3 open)
     - Board pack (2 open)
4. **Active Close Modules**:
   - Review the module cards on the bottom right: `Accrual & prepaid` (37%), `Recognition and compliance` (43%), `Flux & variance` (34%).

---

### Test 3: Phased Checklist & AI Task Drawer
1. **Navigate to Checklist**: In the left sidebar tree, click **Checklist**.
2. **Verify Summary Metrics**:
   - Total Tasks: `14` | Completed: `5` (36%) | In Progress: `6` | Not Started: `3`.
3. **Inspect Grouped Tasks**:
   - **PRE-CLOSE** (2/2 complete): Notice the purple sparkle badges: **`✦ COMPLETED BY AI`**.
   - **RECONCILIATIONS** (3/3 complete): AP reconciliation, Fixed deposit, Bank Reconciliation.
   - **ACCRUALS** (0/2 complete): Controller sign-off, Review all accrual entries.
4. **Open Task Slide-over Drawer**:
   - Click on the task: **"Confirm cut-off dates with all entities"**.
   - A right drawer smoothly slides in showing:
     - Header: `PRE-CLOSE - VERIFIED BY AI` | `Enterprise Brain reconciled across 14 systems`.
     - Sub-tasks list (3 AI-drafted items with checkboxes):
       - [x] *Read the cut-off timestamp from each connected ledger*
       - [x] *Compare every entity against the close calendar*
       - [x] *Flag entities whose cut-off moved since last close*
5. **Interactive Sub-task Testing**:
   - Uncheck/check any subtask to test live database synchronization.
   - Type in the input: `Verify EMEA currency FX rate` and click **`+ Add sub-task`**. Notice it appears immediately and a toast notification confirms the change.
6. **Interactive Comment Testing**:
   - Type in the comment box: `Audit sign-off received from regional controller.` and click **`Post comment`**. Notice the new comment card appears in the thread.
7. **Close Drawer**: Click the `✕` at the top right of the drawer.

---

### Test 4: Accrual & Prepaid Automation
1. **Navigate to Accruals**: In the left sidebar, click **Accrual & prepaid**.
2. **Top KPI Metrics**:
   - **Category Spend**: `$630.7K` (vs `$1.2M` run-rate, `-$551.5K` delta) with category mini-chart (Software, Marketing, Consulting, Hosting, etc.).
   - **Accrued Liabilities**: `$64.5K` (11% of run-rate).
   - **Prepaid Assets**: `$11.5K` (2.1% of run-rate).
   - **Needs Accrual**: `13` (`8471K suggested - 3 found, 10 carried over`).
3. **Detected from the Ledger (AI Next Proposals)**:
   - Observe the horizontal proposals cards:
     - **Amazon Web Services India**: `-$1.3M` (Hosting / Cloud) -> Click `Check the rate →` to trigger live rate telemetry.
     - **Fivora Consulting LLP**: `3.00 lacs` (Professional Charges).
     - **Deloitte Touche Tohmatsu India**: `2.64 lacs`.
     - **Travelstack Tech**: `100` (Travel).
4. **Bottom Widgets**: Check Balance rollforward ($64.5K closing) and Top vendors list.

---

### Test 5: Recognition & ASC 606 Gating Queue
1. **Navigate to Recognition**: In the left sidebar, click **Recognition and compliance**.
2. **Planned vs Recognised 2026 Chart**:
   - Check the monthly dual-bar SVG chart from Jan to Dec:
     - Notice **August 2026** is highlighted with Planned (`$1.56M`) vs Recognised (`>$450k`), showing the delta `-$1.11M`.
   - Review metric cards: Contracted ARR (`$25.68M`), Deviations (`118`), ASC 606 Compliance (`11 / 135`).
3. **4-Column Gating Queue Kanban Board**:
   - Observe the 4 columns:
     - **NEEDS REVIEW (3 contracts)**: *Dubai Chamber of Commerce* ($3,000), *Easy Data Integration* ($3,786), *Credila Financial* ($22,917).
     - **AUTO-APPLIED (3 contracts)**: *ChargePoint* ($40,417), *Aarti Industries* ($2,363), *Emirates Rawabi* ($14,583).
     - **STARTED (0 contracts)**.
     - **DEFERRED (0 contracts)**.
4. **Open Contract Gating Decision Drawer**:
   - Click on the **Dubai Chamber of Commerce** card.
   - Drawer slides in with full ASC 606 contract details:
     - ARR: `$36,000` | Monthly: `$3,000` | Owner: `Shubhang K`.
     - **Source Evidence Box (HubSpot)**:
       - `recognition_trigger = signature (HubSpot)`
       - `no trigger event for Aug 2026 recorded in HubSpot`
       - `Schedule v1 of 1 - effective Oct 26`
   - **Justification & Defer Action**:
     - Type in the justification box: `Signatures delayed to early September.`
     - Click the black button: **`✦ Defer to Sep (recommended)`**.
   - **Verify Live Kanban Update**:
     - The drawer closes, a toast notification appears: *"Contract Dubai Chamber of Commerce deferred to September"*.
     - The card moves automatically from **NEEDS REVIEW** to the **DEFERRED** column!
     - The column counters update in real time (`NEEDS REVIEW: 2 contracts`, `DEFERRED: 1 contract`).

---

### Test 6: Flux & Variance (P&L Review & Dynamic AI Context)
1. **Navigate to Flux**: In the left sidebar, click **Flux & variance**.
2. **P&L Variance Review Table**:
   - Review the snapshot KPIs: `Flagged: 37 / 51`, `Materiality: $25,000.00 / 10%`.
   - Inspect the hierarchical tree table comparing **JUL 2026 vs AUG 2026**:
     - **Recurring Revenue**: Jul `$672,258.25` → Aug `$0.00` | Δ: `-$672,258.25 (-100.0%)` (Red dot).
       - *40201001 License / Subscription Fee*: `-$572,199.91`.
       - *40201002 Professional Fee*: `-$100,058.34`.
     - *Bank Charges*: `-$1,383.47 (-96.6%)`.
     - *Employee related cost*: `-$187,888.56 (-99.8%)`.
3. **Open Variance Detail Drawer**:
   - Click on **Recurring Revenue** (or click `View →`).
   - Drawer slides in with:
     - Figures: `672,258.25 → 0.00 | -$672,258.25 (-100.0%)`.
     - **AI EXPLANATION**: Explains that revenue does not stop, but August revenue recognition has not yet posted because items remain in the gating queue.
     - **ATTRIBUTION BY CHILD**: Red bars showing +85% License / Subscription Fee and +15% Professional Fee.
4. **Test Dynamic AI Context Rewriting (Key Demo Feature)**:
   - In the drawer, select the **✦ AI context** tab.
   - In the text box, enter:
     ```
     billing occurs every 45 days
     ```
   - Click **`+ Add context`**.
   - **Observe Real-Time Behavior**:
     - Toast appears: *"Explanation rewritten - context now applies across Flux."*
     - The AI Explanation text instantly rewrites in real time:
       > *"AI EXPLANATION: 1 context note applied (billing occurs every 45 days). Taking into account that 'billing occurs every 45 days', the revenue gap is verified as expected billing cycle timing rather than contractual churn..."*
     - The activity log below records the context entry by Aman Agrawal.
5. **Approve Variance**:
   - Click the **`Approve`** button at the top of the drawer.
   - Notice the status badge switches to `APPROVED` (green) in the table.
6. **Close Drawer**: Click `✕`.

---

### Test 7: Drafted Journal Entries (HITL Batch Approval)
1. **Navigate to Drafted JEs**:
   - In the top right of the Flux screen, click the black button:
     **`✦ Draft JEs for 37 flagged lines`**.
2. **Inspect Drafted JEs Table**:
   - Notice the table contains **24 AI-prepared entries totaling $701,000.00**:
     - *Correction*: `40201001 License / Subscription Fee` ($354,800.00)
     - *Correction*: `40201002 Professional Fee` ($62,000.00)
     - *Reclass*: `60501001 Bank Charges` ($900.00)
     - *Accrual*: `60105011 Payroll Expenses/Commissions` ($116,800.00)
     - *Reclass*: `60801001 Company Insurance` ($3,700.00)
     - *Reclass*: `60901001 Legal Charges` ($2,400.00)
     - *Reclass*: `61001002 Management consulting & Strategy` ($11,500.00)
     - Additional operational accruals and reclassifications totaling $701k.
3. **Batch Approve**:
   - Click the black button in the header:
     **`✦ Approve all 24 at $751,000.00`**.
   - **Verify Result**:
     - All status badges update to **`POSTED`** (green).
     - Toast confirms: *"All 24 drafted entries approved into the General Ledger."*
     - Global Close tasks completed increments, and progress updates.
4. **Return**: Click `< P&L Variance Review` to return to the Flux page.

---

### Test 8: Enterprise Brain & Setup View
1. **Navigate to Setup**: In the left sidebar tree under Close Management, click **Enterprise Brain / Setup**.
2. **Verify Connected Sources**:
   - Review the **6 Connected Categories**:
     1. Communication channels (Slack)
     2. Documents & budget (Drive, SharePoint)
     3. Ledger (NetSuite, SAP)
     4. Contracts & CRM (Salesforce, HubSpot)
     5. Billing & usage (Stripe)
     6. Banking (Open Banking)
   - Review the **10 pre-authorized Enterprise Brain sources** listed below with `✦ Via Brain` tags.

---

### Test 9: "Ask AI" Global Copilot
1. **Open Copilot**:
   - Click the floating black button at the bottom right: **`✦ Ask AI`** (or press **`⌘K`** anywhere).
2. **Try the Quick Chips**:
   - Click **`Why are we behind plan?`**: Copilot queries the local SQLite database and explains that Global Close is at D+8.0 (+4 days behind) due to 9 open checklist tasks, 3 gating queue items, and flagged variance lines.
   - Click **`Dubai Chamber gating status?`**: Copilot explains the ARR ($36,000), HubSpot signature trigger evidence, and September deferral recommendation.
   - Click **`Recurring Revenue decline explanation?`**: Copilot explains the -$672k variance and attribution breakdown.
   - Click **`Summarize drafted journal entries`**: Copilot summarizes the 24 entries totaling $701k across Corrections, Reclasses, and Accruals.
3. **Custom Query**:
   - Type any question into the input and press Enter.

---

## 3. Maintenance & Resetting

- **To Reset Data Back to Fresh Demo State**:
  ```bash
  python3 init_db.py
  ```
  *(Refreshes the database back to 0 approvals, pristine gating queue, and 24 ready-to-approve JEs).*

- **To Stop the Server**:
  Press `Ctrl + C` in the terminal where `server.py` is running, or:
  ```bash
  kill $(lsof -t -i:8000)
  ```
