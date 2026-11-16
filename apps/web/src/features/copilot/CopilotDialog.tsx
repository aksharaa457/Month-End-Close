import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, User } from "lucide-react";
import { streamSSE, errorMessage } from "@/shared/api/client";
import type { Citation } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { CitationList } from "@/shared/ui/domain";
import { cn } from "@/shared/lib/utils";

interface Msg {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  outcome?: string;
  modelId?: string;
  streaming?: boolean;
}

const QUICK = ["Why are we behind plan?", "Gulf Chamber gating status?", "Explain the Recurring Revenue decline", "Summarize drafted journal entries", "Which tasks are overdue?"];

/** Ask AI copilot (AI-1..AI-5): read-only, cited, streamed over SSE. */
export function CopilotDialog({ open, onOpenChange, entityId }: { open: boolean; onOpenChange: (o: boolean) => void; entityId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: question }, { role: "assistant", text: "", streaming: true }]);
    const patchLast = (f: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? f(m) : m)));
    try {
      await streamSSE("/copilot/ask", { question, entityId }, (event, data) => {
        if (event === "token") patchLast((m) => ({ ...m, text: m.text + JSON.parse(data) }));
        if (event === "done") {
          const d = JSON.parse(data);
          patchLast((m) => ({ ...m, streaming: false, citations: d.citations, outcome: d.outcome, modelId: d.modelId }));
        }
      });
    } catch (e) {
      patchLast((m) => ({ ...m, streaming: false, outcome: "failed", text: `Sorry — ${errorMessage(e)}` }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-2xl flex-col gap-3 p-0">
        <DialogHeader className="border-b p-4 pr-10">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-ai" /> Ask AI <Badge variant="ai">v1</Badge> <Badge variant="outline">Read-only</Badge>
          </DialogTitle>
          <DialogDescription>Answers come only from your close data and cite their sources. The copilot can explain and navigate, but can't approve or post anything.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-4" aria-live="polite">
          {msgs.length === 0 ? (
            <div className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground">Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {QUICK.map((q) => (
                  <Button key={q} variant="outline" size="sm" onClick={() => ask(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex gap-2", m.role === "user" && "justify-end")}>
              {m.role === "assistant" ? <Bot className="mt-1 size-5 shrink-0 text-ai" aria-hidden /> : null}
              <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : m.outcome === "insufficient_data" || m.outcome === "failed" ? "border border-warning/40 bg-warning/5" : "bg-muted")}>
                <p className="whitespace-pre-line">
                  {m.text}
                  {m.streaming ? <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-middle" /> : null}
                </p>
                {m.citations ? <CitationList citations={m.citations} /> : null}
                {m.modelId ? <p className="mt-1 text-[10px] text-muted-foreground">{m.modelId} · grounded in Enterprise Brain data</p> : null}
              </div>
              {m.role === "user" ? <User className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden /> : null}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about close status, variances, entries…" aria-label="Question" autoFocus />
          <Button type="submit" disabled={!input.trim() || busy} aria-label="Send">
            <Send />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
