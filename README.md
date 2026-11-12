# Continuous Close Hub — Real-Time Month-End Close Platform

An enterprise-grade, real-time month-end close acceleration platform featuring autonomous reconciliation tracking, ASC 606 revenue gating, dynamic P&L flux analysis, and Human-in-the-Loop (HITL) journal entry governance.

---

## 🌟 Key Features

1. **Month-End Close Acceleration (Multi-Entity Hub)**
   - Consolidated global close cockpit with multi-entity progress rings (*Global Close*, *Tech Uniapps India*, *UnifyApps Inc.*, etc.).
   - Real-time **AI Close Forecast** alerting on critical path blockers and projected close velocity (`D+8.0`).

2. **Closure Overview & Telemetry**
   - Interactive **Close Burndown** SVG chart tracking *Plan*, *Actual*, and *AI Projected* timelines with active day highlighting (`D+4`).
   - Workload distribution by sub-process (Pre-close, Reconciliations, Accruals, Intercompany, Compliance, Board pack).
   - High-level close health KPIs and module tracking.

3. **Phased Checklist & Autonomous Task Verification**
   - Step-by-step close governance with automated AI verification across connected systems.
   - Slide-over inspection drawer with AI-drafted subtasks, editable checklist items, and immutable audit comment trail.

4. **Accrual & Prepaid Automation**
   - Category spend analysis and run-rate variance detection.
   - AI-detected missing ledger accrual proposals (AWS, Fivora Consulting, Deloitte Touche Tohmatsu, Travelstack).

5. **ASC 606 Revenue Recognition & Gating Queue**
   - 12-month planned vs. recognised revenue comparison chart.
   - 4-column interactive Kanban board (*Needs Review*, *Auto-Applied*, *Started*, *Deferred*).
   - Contract decision drawer with CRM/HubSpot trigger evidence inspection and 1-click deferral workflows.

6. **P&L Flux & Variance Review (Dynamic AI Context)**
   - Hierarchical tree table comparing monthly performance against materiality thresholds ($25,000 / 10%).
   - Variance detail drawer with child account attribution breakdowns.
   - **Dynamic AI Context Rewriter**: Input custom business rules (e.g., `"billing occurs every 45 days"`) to trigger real-time AI explanation recalculation.

7. **Drafted Journal Entries (HITL Batch Approval)**
   - 24 AI-prepared draft journal entries ($701k) tied back to underlying variance anomalies.
   - One-click batch approval into the General Ledger.

8. **"Ask AI" Close Assistant**
   - Omnipresent Copilot modal (accessible via floating button or `⌘K`) querying real-time close blockers, contract statuses, and ledger anomalies.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: HTML5, Vanilla CSS (KPMG Navy & Slate design system), Modular ES6+ JavaScript.
- **Backend**: Python 3.9+ HTTP/REST API server (`server.py`).
- **Database**: SQLite3 (`erp.db`) pre-seeded with clean corporate ledger and entity data.
- **Styling**: KPMG corporate palette (`#00338D` Navy, `#005EB8` Royal Blue, `#F4F7FB` Canvas).

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/aksharaa457/Month-End-Close.git
cd Month-End-Close
```

### 2. Initialize the local database
```bash
python3 init_db.py
```
*Creates `erp.db` and populates all baseline entities, tasks, contracts, accounts, and journal entries.*

### 3. Launch the server
```bash
python3 server.py
```

### 4. Open in browser
Navigate to:
```
http://localhost:8000
```

---

## 📖 Testing & Verification Guide

For a complete step-by-step verification checklist covering all screens and interactive flows, see [TESTING_GUIDE.md](TESTING_GUIDE.md).

---

## 📄 License
MIT License
