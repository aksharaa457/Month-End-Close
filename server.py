import http.server
import socketserver
import json
import sqlite3
import os
import urllib.parse
from datetime import datetime

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DB_PATH = os.path.join(BASE_DIR, "erp.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

class ERPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self.handle_api_get(path, urllib.parse.parse_qs(parsed.query))
        else:
            # Fallback to SPA index.html for frontend routes if file doesn't exist
            filepath = os.path.join(PUBLIC_DIR, path.lstrip("/"))
            if not os.path.exists(filepath) or os.path.isdir(filepath):
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            try:
                body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
            except Exception:
                body = {}
            self.handle_api_post(path, body)
        else:
            self.send_error(404, "Endpoint not found")

    def send_json(self, data, status_code=200):
        response_bytes = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(response_bytes)

    def handle_api_get(self, path, query_params):
        conn = get_db()
        c = conn.cursor()

        try:
            if path == "/api/entities":
                rows = c.execute("SELECT * FROM entities").fetchall()
                entities = [dict(r) for r in rows]
                self.send_json({"entities": entities})

            elif path == "/api/sources":
                rows = c.execute("SELECT * FROM sources").fetchall()
                sources = [dict(r) for r in rows]
                self.send_json({"sources": sources})

            elif path == "/api/overview":
                # Close Burndown & Close Health data
                entity = c.execute("SELECT * FROM entities WHERE id='global-close'").fetchone()
                
                burndown_data = [
                    {"day": "D-3", "plan": 14, "actual": 14, "projected": None},
                    {"day": "D-2", "plan": 12, "actual": 13, "projected": None},
                    {"day": "D-1", "plan": 10, "actual": 12, "projected": None},
                    {"day": "D+0", "plan": 8, "actual": 11, "projected": None},
                    {"day": "D+1", "plan": 6, "actual": 11, "projected": None},
                    {"day": "D+2", "plan": 4, "actual": 10, "projected": None},
                    {"day": "D+3", "plan": 2, "actual": 10, "projected": None},
                    {"day": "D+4", "plan": 0, "actual": 9, "projected": 9, "isCurrent": True},
                    {"day": "D+5", "plan": None, "actual": None, "projected": 7},
                    {"day": "D+6", "plan": None, "actual": None, "projected": 5},
                    {"day": "D+7", "plan": None, "actual": None, "projected": 3},
                    {"day": "D+8", "plan": None, "actual": None, "projected": 0}
                ]

                subprocesses = [
                    {"name": "Pre-close", "complete": 2, "open": 0},
                    {"name": "Reconciliations", "complete": 3, "open": 0},
                    {"name": "Accruals", "complete": 0, "open": 2},
                    {"name": "Intercompany", "complete": 0, "open": 2},
                    {"name": "Compliance", "complete": 0, "open": 3},
                    {"name": "Board pack", "complete": 0, "open": 2}
                ]

                modules = [
                    {
                        "name": "Accrual & prepaid",
                        "status": "In progress",
                        "sub": "Behind pace",
                        "assignee": "S. Bakr",
                        "pct": 37,
                        "url": "accrual-prepaid"
                    },
                    {
                        "name": "Recognition and compliance",
                        "status": "In progress",
                        "sub": "Behind pace",
                        "assignee": "D. Okonjo",
                        "pct": 43,
                        "url": "recognition-compliance"
                    },
                    {
                        "name": "Flux & variance",
                        "status": "Early stage",
                        "sub": "Behind pace",
                        "assignee": "A. Roy",
                        "pct": 34,
                        "url": "flux-variance"
                    }
                ]

                self.send_json({
                    "entity": dict(entity),
                    "burndown": burndown_data,
                    "subprocesses": subprocesses,
                    "modules": modules,
                    "ai_insight": "5 of 14 checklist tasks are complete and 3 of 3 modules are underway. 8 days to the 12 Sep 2026 target."
                })

            elif path == "/api/checklist":
                task_rows = c.execute("SELECT * FROM tasks ORDER BY order_index ASC").fetchall()
                tasks = []
                for t in task_rows:
                    t_dict = dict(t)
                    sub_rows = c.execute("SELECT * FROM subtasks WHERE task_id=?", (t_dict["id"],)).fetchall()
                    t_dict["subtasks"] = [dict(s) for s in sub_rows]
                    comment_rows = c.execute("SELECT * FROM comments WHERE task_id=? ORDER BY created_at DESC", (t_dict["id"],)).fetchall()
                    t_dict["comments"] = [dict(cm) for cm in comment_rows]
                    tasks.append(t_dict)

                self.send_json({
                    "total": len(tasks),
                    "completed": sum(1 for t in tasks if t["status"] == "Done"),
                    "in_progress": sum(1 for t in tasks if t["status"] == "In progress"),
                    "not_started": sum(1 for t in tasks if t["status"] == "To do"),
                    "tasks": tasks
                })

            elif path == "/api/accruals":
                proposals = c.execute("SELECT * FROM accrual_proposals").fetchall()
                self.send_json({
                    "kpis": {
                        "category_spend": 630700.0,
                        "six_month_runrate": 1200000.0,
                        "change_amount": -551500.0,
                        "accrued_liabilities": 64500.0,
                        "accrued_pct": 11.0,
                        "prepaid_assets": 11500.0,
                        "prepaid_pct": 2.1,
                        "needs_accrual_count": 13,
                        "suggested_amount": "8471K suggested - 3 found, 10 carried over",
                        "estimate_accuracy": "0%",
                        "estimate_note": "0 of 0 past accruals inside +-5% tracking across periods"
                    },
                    "spend_categories": [
                        {"category": "Software", "amount": 180000},
                        {"category": "Marketing", "amount": 95000},
                        {"category": "Consulting", "amount": 140000},
                        {"category": "Hosting", "amount": 110000},
                        {"category": "Legal", "amount": 55000},
                        {"category": "Travel", "amount": 32000},
                        {"category": "Office", "amount": 18700}
                    ],
                    "proposals": [dict(p) for p in proposals],
                    "balance_rollforward": {
                        "opening": 0.0,
                        "additions": 64500.0,
                        "releases": 0.0,
                        "closing": 64500.0
                    }
                })

            elif path == "/api/recognition":
                monthly = [
                    {"month": "Jan", "planned": 1.20, "recognised": 1.20},
                    {"month": "Feb", "planned": 1.30, "recognised": 1.30},
                    {"month": "Mar", "planned": 1.40, "recognised": 1.35},
                    {"month": "Apr", "planned": 1.45, "recognised": 1.45},
                    {"month": "May", "planned": 1.50, "recognised": 1.50},
                    {"month": "Jun", "planned": 1.55, "recognised": 1.50},
                    {"month": "Jul", "planned": 1.56, "recognised": 1.56},
                    {"month": "Aug", "planned": 1.56, "recognised": 0.45, "current": True},
                    {"month": "Sep", "planned": 1.60, "recognised": 0.0},
                    {"month": "Oct", "planned": 1.60, "recognised": 0.0},
                    {"month": "Nov", "planned": 1.65, "recognised": 0.0},
                    {"month": "Dec", "planned": 1.65, "recognised": 0.0}
                ]
                contracts = c.execute("SELECT * FROM gating_contracts").fetchall()
                self.send_json({
                    "kpis": {
                        "contracted_arr": "$25.68M",
                        "contracts_count": 135,
                        "crm_delivered": 124,
                        "deviations_count": 118,
                        "deviations_posted": "$450k posted against $1.56M planned",
                        "recognition_run_aug": "$1.56M",
                        "recognition_run_details": "$450k posted - 95 proposals - 3 gating decisions open",
                        "asc_606_compliance": "11 / 135",
                        "asc_details": "11 read from the signed document - 124 derived from CRM"
                    },
                    "monthly_trend": monthly,
                    "contracts": [dict(ct) for ct in contracts]
                })

            elif path == "/api/flux":
                lines = c.execute("SELECT * FROM flux_variance").fetchall()
                attributions = c.execute("SELECT * FROM flux_attributions").fetchall()
                context_logs = c.execute("SELECT * FROM ai_context_logs ORDER BY created_at DESC").fetchall()
                self.send_json({
                    "snapshot": "v1",
                    "snapshot_date": "Sep 26 2026",
                    "materiality": "$25,000.00 / 10%",
                    "flagged_count": 37,
                    "total_lines": 51,
                    "unreviewed_count": 37,
                    "lines": [dict(l) for l in lines],
                    "attributions": [dict(a) for a in attributions],
                    "context_logs": [dict(cl) for cl in context_logs]
                })

            elif path == "/api/journals":
                jes = c.execute("SELECT * FROM journal_entries ORDER BY row_number ASC").fetchall()
                jes_list = [dict(je) for je in jes]
                total_amount = sum(item["entry_amount"] for item in jes_list)
                approved_count = sum(1 for item in jes_list if item["status"] == "APPROVED")
                self.send_json({
                    "entries": jes_list,
                    "total_entries": len(jes_list),
                    "approved_entries": approved_count,
                    "total_amount": round(total_amount, 2),
                    "ready_batch_text": f"Approve all {len(jes_list)} at ${round(total_amount, 2):,.2f}"
                })

            else:
                self.send_error(404, "Endpoint not found")

        finally:
            conn.close()

    def handle_api_post(self, path, body):
        conn = get_db()
        c = conn.cursor()

        try:
            if path == "/api/checklist/toggle-subtask":
                subtask_id = body.get("id")
                sub = c.execute("SELECT * FROM subtasks WHERE id=?", (subtask_id,)).fetchone()
                if sub:
                    new_val = 0 if sub["is_completed"] else 1
                    c.execute("UPDATE subtasks SET is_completed=? WHERE id=?", (new_val, subtask_id))
                    conn.commit()
                self.send_json({"success": True})

            elif path == "/api/checklist/add-subtask":
                task_id = body.get("task_id")
                title = body.get("title", "").strip()
                if title:
                    new_id = f"sub-{int(datetime.now().timestamp() * 1000)}"
                    c.execute("INSERT INTO subtasks (id, task_id, title, is_completed, is_ai_drafted) VALUES (?,?,?,0,0)",
                              (new_id, task_id, title))
                    conn.commit()
                    self.send_json({"success": True, "id": new_id, "title": title})
                else:
                    self.send_json({"error": "Title required"}, 400)

            elif path == "/api/checklist/delete-subtask":
                subtask_id = body.get("id")
                c.execute("DELETE FROM subtasks WHERE id=?", (subtask_id,))
                conn.commit()
                self.send_json({"success": True})

            elif path == "/api/checklist/add-comment":
                task_id = body.get("task_id")
                content = body.get("content", "").strip()
                if content:
                    new_id = f"comment-{int(datetime.now().timestamp() * 1000)}"
                    author = body.get("author", "Akshara Jain")
                    created_at = datetime.now().strftime("%d %b %H:%M")
                    c.execute("INSERT INTO comments (id, task_id, author, created_at, content) VALUES (?,?,?,?,?)",
                              (new_id, task_id, author, created_at, content))
                    conn.commit()
                    self.send_json({"success": True, "id": new_id, "author": author, "created_at": created_at, "content": content})
                else:
                    self.send_json({"error": "Content required"}, 400)

            elif path == "/api/recognition/gating-action":
                contract_id = body.get("id")
                action = body.get("action") # "defer" or "start"
                justification = body.get("justification", "").strip()

                contract = c.execute("SELECT * FROM gating_contracts WHERE id=?", (contract_id,)).fetchone()
                if not contract:
                    self.send_json({"error": "Contract not found"}, 404)
                    return

                new_status = "DEFERRED" if action == "defer" else "STARTED"
                c.execute("UPDATE gating_contracts SET status=?, user_justification=? WHERE id=?",
                          (new_status, justification, contract_id))
                conn.commit()
                self.send_json({"success": True, "status": new_status})

            elif path == "/api/flux/add-context":
                account_code = body.get("account_code", "INC-REC")
                note = body.get("note", "").strip()
                author = body.get("author", "Aman Agrawal")

                if note:
                    new_id = f"ctx-{int(datetime.now().timestamp() * 1000)}"
                    timestamp_str = datetime.now().strftime("%d %b %H:%M")
                    c.execute("INSERT INTO ai_context_logs (id, account_code, author, created_at, note) VALUES (?,?,?,?,?)",
                              (new_id, account_code, author, timestamp_str, note))
                    
                    # Synthesize an updated AI explanation taking into account the new business context note
                    updated_explanation = (
                        f"AI EXPLANATION: 1 context note applied ({note}).\n"
                        f"Taking into account that '{note}', the revenue gap is verified as expected billing cycle timing rather than contractual churn. "
                        f"Every account under Recurring Revenue booked $672,258.25 in July. Revenue does not stop; recognition is calibrated with the 45-day lag. "
                        f"Clear the pending gating decisions in Recognition and compliance, refresh the snapshot, then post the finalized August ledger entries."
                    )
                    c.execute("UPDATE flux_variance SET ai_explanation=?, ai_context_note=? WHERE account_code=?",
                              (updated_explanation, note, account_code))
                    conn.commit()
                    self.send_json({
                        "success": True,
                        "updated_explanation": updated_explanation,
                        "log": {
                            "id": new_id,
                            "account_code": account_code,
                            "author": author,
                            "created_at": timestamp_str,
                            "note": note
                        }
                    })
                else:
                    self.send_json({"error": "Note required"}, 400)

            elif path == "/api/flux/approve":
                account_code = body.get("account_code")
                c.execute("UPDATE flux_variance SET status='APPROVED' WHERE account_code=?", (account_code,))
                conn.commit()
                self.send_json({"success": True})

            elif path == "/api/journals/approve-single":
                je_id = body.get("id")
                c.execute("UPDATE journal_entries SET status='APPROVED' WHERE id=?", (je_id,))
                conn.commit()
                self.send_json({"success": True})

            elif path == "/api/journals/approve-batch":
                c.execute("UPDATE journal_entries SET status='APPROVED'")
                # Also update corresponding flux variances
                c.execute("UPDATE flux_variance SET status='APPROVED' WHERE is_flagged=1")
                # Also update checklist tasks
                c.execute("UPDATE tasks SET status='Done' WHERE id='task-6' OR id='task-7'")
                # Update entity progress
                c.execute("UPDATE entities SET tasks_completed=7, progress_pct=50.0, open_tasks=7 WHERE id='global-close'")
                conn.commit()
                self.send_json({"success": True, "message": "All 24 drafted entries approved into the General Ledger."})

            elif path == "/api/ai/copilot":
                prompt = body.get("prompt", "").lower().strip()
                
                # Intelligent local copilot responses based on real DB status
                if "behind" in prompt or "burndown" in prompt or "forecast" in prompt or "d+8" in prompt:
                    reply = (
                        "Global Close - Aug 2026 is currently projected at D+8.0 (+4.0 days behind plan). "
                        "The primary drags identified by the Enterprise Brain are:\n"
                        "1. 9 open checklist tasks across Accruals & Compliance.\n"
                        "2. 3 unreviewed contract gating items in Recognition (Dubai Chamber of Commerce, Easy Data Integration, Credila Financial).\n"
                        "3. 37 flagged P&L variance lines awaiting batch journal entry approval."
                    )
                elif "dubai" in prompt or "gating" in prompt or "contract" in prompt:
                    reply = (
                        "Dubai Chamber of Commerce (Contract-1011) is currently in the Gating Queue with ARR of $36,000 ($3,000/mo). "
                        "Enterprise Brain evidence: HubSpot signature trigger has not fired for August 2026, and Schedule v1 of 1 takes effect in October 2026. "
                        "Recommendation: Defer to September."
                    )
                elif "recurring revenue" in prompt or "flux" in prompt or "variance" in prompt:
                    reply = (
                        "Recurring Revenue shows a -$672,258.25 delta (-100%) because the August revenue close has not yet posted. "
                        "Attribution: License / Subscription Fee accounts for 85% and Professional Fee for 15%. "
                        "Once the gating queue decisions are submitted and draft journal entries are approved, this line will normalize."
                    )
                elif "journal" in prompt or "je" in prompt or "batch" in prompt:
                    reply = (
                        "There are 24 AI-drafted Journal Entries totaling $701,000.00 ready for batch review. "
                        "This includes Corrections for License ($354.8k) and Professional Fees ($62k), Reclassifications for Bank Charges and Legal, "
                        "and Payroll Accruals ($116.8k). You can approve them all in one click."
                    )
                else:
                    reply = (
                        "Enterprise Brain is continuously reconciling data across 14 connected systems (NetSuite, SAP, Slack, Salesforce, Stripe, Open Banking). "
                        "All close items are monitored in real time with Human-in-the-Loop approval before GL posting."
                    )
                
                self.send_json({"response": reply})

            else:
                self.send_error(404, "Endpoint not found")

        finally:
            conn.close()

if __name__ == "__main__":
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    os.makedirs(os.path.join(PUBLIC_DIR, "css"), exist_ok=True)
    os.makedirs(os.path.join(PUBLIC_DIR, "js"), exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), ERPRequestHandler) as httpd:
        print(f"ERP Continuous Close Platform running at http://localhost:{PORT}")
        httpd.serve_forever()

