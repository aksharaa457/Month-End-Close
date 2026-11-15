import { useRef, useState } from "react";
import { Check, FileUp, Paperclip, Pencil, Play, Plus, Send, ShieldAlert, Sparkles, Trash2, Undo2 } from "lucide-react";
import { api } from "@/shared/api/client";
import type { Task } from "@/shared/api/types";
import { qk, useAction, useCan, useMe, useUserName, useUsers } from "@/shared/api/hooks";
import { bytes, closeDay, dateTimeLabel } from "@/shared/lib/format";
import { phaseLabel, taskStatusMeta } from "@/shared/lib/labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/shared/ui/dialog";
import { AiPanel, ReasonDialog, SectionTitle } from "@/shared/ui/domain";
import { Input, Label, Select } from "@/shared/ui/input";
import { Checkbox, Tooltip } from "@/shared/ui/misc";
import { CommentThread } from "@/features/checklist/CommentThread";

export function TaskDrawer({ task, allTasks, entityId, onClose }: { task: Task | null; allTasks: Task[]; entityId: string; onClose: () => void }) {
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>{task ? <Body task={task} allTasks={allTasks} entityId={entityId} /> : null}</SheetContent>
    </Dialog>
  );
}

function Body({ task: t, allTasks, entityId }: { task: Task; allTasks: Task[]; entityId: string }) {
  const can = useCan();
  const me = useMe();
  const users = useUsers();
  const name = useUserName();
  const [newSub, setNewSub] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [rejectOpen, setRejectOpen] = useState<null | "task" | "ai">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inv = [qk.tasks(entityId), qk.period(entityId)];
  const canEdit = can("task.edit", entityId);
  const canSign = can("task.signoff", entityId);
  const uid = me.data?.user.id;
  const isPreparer = t.ownerId === uid || t.submittedBy === uid;
  const meta = taskStatusMeta[t.status];

  const patch = useAction((body: Record<string, unknown>) => api.patch(`/tasks/${t.id}`, { ...body, version: t.version }), { invalidate: inv, success: "Task updated" });
  const addSub = useAction((title: string) => api.post(`/tasks/${t.id}/subtasks`, { title }), { invalidate: inv, onSuccess: () => setNewSub("") });
  const patchSub = useAction((v: { id: string; body: Record<string, unknown> }) => api.patch(`/subtasks/${v.id}`, v.body), { invalidate: inv, onSuccess: () => setEditing(null) });
  const action = useAction((v: { action: string; reason?: string }) => api.post(`/tasks/${t.id}/${v.action}`, { reason: v.reason }), {
    invalidate: inv,
    success: (r) => `Task ${taskStatusMeta[(r as Task).status].label.toLowerCase()}`,
    onSuccess: () => setRejectOpen(null),
  });
  const upload = useAction((f: File) => api.post(`/tasks/${t.id}/evidence`, { fileName: f.name, sizeBytes: f.size, contentType: f.type }), {
    invalidate: inv,
    success: "Evidence uploaded and scanned",
  });

  const deps = allTasks.filter((x) => t.dependsOn.includes(x.id));
  const subs = t.subtasks.filter((s) => !s.removed);
  const active = (users.data ?? []).filter((u) => u.status === "active");

  return (
    <>
      <div className="border-b p-5 pr-10">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {phaseLabel[t.phase]} {t.verifiedByAi ? "· verified by AI" : ""}
        </p>
        <DialogTitle className="text-lg font-semibold">{t.title}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">{t.description}</DialogDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={meta.tone}>{meta.label}</Badge>
          {t.overdue ? <Badge variant="destructive">Overdue · due {closeDay(t.dueDay)}</Badge> : <Badge variant="outline">Due {closeDay(t.dueDay)}</Badge>}
          {t.requiresEvidence ? <Badge variant="outline">Evidence required</Badge> : null}
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {t.aiVerification ? (
          <AiPanel output={t.aiVerification} title="AI verification">
            {t.verifiedByAi && canSign ? (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setRejectOpen("ai")}>
                <ShieldAlert /> Reject AI verification
              </Button>
            ) : null}
          </AiPanel>
        ) : null}

        <section>
          <SectionTitle>People and timing</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="owner">Owner (preparer)</Label>
              <Select id="owner" value={t.ownerId ?? ""} disabled={!canEdit || t.status === "completed"} onChange={(e) => patch.mutate({ ownerId: e.target.value })}>
                {active.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="reviewer">Reviewer</Label>
              <Select id="reviewer" value={t.reviewerId ?? ""} disabled={!canEdit || t.status === "completed"} onChange={(e) => patch.mutate({ reviewerId: e.target.value })}>
                {active.map((u) => (
                  <option key={u.id} value={u.id} disabled={u.id === t.ownerId}>
                    {u.name}
                    {u.id === t.ownerId ? " (owner)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="due">Due day</Label>
              <Select id="due" value={t.dueDay} disabled={!canEdit || t.status === "completed"} onChange={(e) => patch.mutate({ dueDay: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => i).map((d) => (
                  <option key={d} value={d}>
                    D+{d}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">The reviewer must be a different person from the owner (CL-5).</p>
          {deps.length ? (
            <p className="mt-2 text-xs">
              Depends on:{" "}
              {deps.map((d) => (
                <Badge key={d.id} variant={d.status === "completed" ? "success" : "warning"} className="mr-1">
                  {d.title}
                </Badge>
              ))}
            </p>
          ) : null}
        </section>

        <section>
          <SectionTitle>
            Subtasks · {subs.filter((s) => s.isDone).length}/{subs.length}
          </SectionTitle>
          <ul className="space-y-1">
            {subs.map((s) => (
              <li key={s.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
                <Checkbox
                  checked={s.isDone}
                  disabled={!canEdit || t.status === "completed"}
                  onCheckedChange={(v) => patchSub.mutate({ id: s.id, body: { isDone: !!v } })}
                  aria-label={`Mark "${s.title}" ${s.isDone ? "not done" : "done"}`}
                />
                {editing === s.id ? (
                  <form
                    className="flex flex-1 gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      patchSub.mutate({ id: s.id, body: { title: editText } });
                    }}
                  >
                    <Input value={editText} onChange={(e) => setEditText(e.target.value)} className="h-7" autoFocus aria-label="Subtask title" />
                    <Button size="sm" type="submit" aria-label="Save">
                      <Check />
                    </Button>
                  </form>
                ) : (
                  <span className={s.isDone ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm"}>{s.title}</span>
                )}
                {s.aiDrafted ? (
                  <Tooltip content="Drafted by AI — edit freely">
                    <Sparkles className="size-3.5 text-ai" aria-label="AI drafted" />
                  </Tooltip>
                ) : null}
                {canEdit && t.status !== "completed" && editing !== s.id ? (
                  <span className="flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Rename "${s.title}"`}
                      onClick={() => {
                        setEditing(s.id);
                        setEditText(s.title);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove "${s.title}"`} onClick={() => patchSub.mutate({ id: s.id, body: { removed: true } })}>
                      <Trash2 />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit && t.status !== "completed" ? (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newSub.trim()) addSub.mutate(newSub.trim());
              }}
            >
              <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add a subtask, e.g. Verify EMEA FX rate" aria-label="New subtask" />
              <Button type="submit" variant="outline" loading={addSub.isPending} disabled={!newSub.trim()}>
                <Plus /> Add
              </Button>
            </form>
          ) : null}
        </section>

        <section>
          <SectionTitle
            right={
              canEdit && t.status !== "completed" ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload.mutate(f);
                      e.target.value = "";
                    }}
                    aria-label="Upload evidence file"
                  />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={upload.isPending}>
                    <FileUp /> Attach evidence
                  </Button>
                </>
              ) : null
            }
          >
            Evidence
          </SectionTitle>
          {t.evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.requiresEvidence ? "A workpaper is required before this task can be submitted (CL-8)." : "No files attached."}</p>
          ) : (
            <ul className="space-y-1">
              {t.evidence.map((ev) => (
                <li key={ev.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                  <Paperclip className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{ev.fileName}</span>
                  <span className="text-xs text-muted-foreground">{bytes(ev.sizeBytes)}</span>
                  <Badge variant={ev.scanStatus === "clean" ? "success" : ev.scanStatus === "infected" ? "destructive" : "warning"}>{ev.scanStatus === "clean" ? "Scanned" : ev.scanStatus}</Badge>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {name(ev.uploadedBy)} · {dateTimeLabel(ev.uploadedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Comments and history</SectionTitle>
          <CommentThread subjectType="task" subjectId={t.id} />
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 p-4">
        {t.signedOffBy ? <span className="mr-auto text-xs text-muted-foreground">Signed off by {name(t.signedOffBy)}</span> : null}
        {canEdit && t.status === "not_started" ? (
          <Button variant="outline" onClick={() => patch.mutate({ status: "in_progress" })}>
            <Play /> Start
          </Button>
        ) : null}
        {canEdit && ["in_progress", "not_started", "rejected"].includes(t.status) ? (
          <Button onClick={() => action.mutate({ action: "submit" })} loading={action.isPending}>
            <Send /> Submit for sign-off
          </Button>
        ) : null}
        {t.status === "submitted" ? (
          canSign && !isPreparer ? (
            <>
              <Button variant="outline" onClick={() => setRejectOpen("task")}>
                <Undo2 /> Send back
              </Button>
              <Button variant="success" onClick={() => action.mutate({ action: "sign-off" })} loading={action.isPending}>
                <Check /> Sign off
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">{isPreparer ? "Waiting for a different reviewer to sign off (CL-5)." : "Waiting for the reviewer's sign-off."}</span>
          )
        ) : null}
      </div>

      <ReasonDialog
        open={rejectOpen !== null}
        onOpenChange={(o) => !o && setRejectOpen(null)}
        title={rejectOpen === "ai" ? "Reject the AI verification?" : "Send this task back?"}
        description={rejectOpen === "ai" ? "The task re-opens and someone has to complete it manually." : "The owner will see your reason as a comment."}
        confirmLabel={rejectOpen === "ai" ? "Reject verification" : "Send back"}
        destructive
        loading={action.isPending}
        onConfirm={(reason) => action.mutate({ action: rejectOpen === "ai" ? "reject-ai-verification" : "reject", reason })}
      />
    </>
  );
}
