import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { api } from "@/shared/api/client";
import type { Comment } from "@/shared/api/types";
import { qk, useAction, useCan, useUserName } from "@/shared/api/hooks";
import { dateTimeLabel } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Initials } from "@/shared/ui/domain";
import { Textarea } from "@/shared/ui/input";

/** Append-only comment thread (comments are never edited or deleted). */
export function CommentThread({ subjectType, subjectId }: { subjectType: Comment["subjectType"]; subjectId: string }) {
  const can = useCan();
  const name = useUserName();
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: qk.comments(subjectType, subjectId), queryFn: () => api.get<Comment[]>(`/comments?subjectType=${subjectType}&subjectId=${encodeURIComponent(subjectId)}`) });
  const post = useAction((body: string) => api.post<Comment>("/comments", { subjectType, subjectId, body }), {
    invalidate: [qk.comments(subjectType, subjectId)],
    onSuccess: () => setText(""),
  });
  const canComment = can("task.edit") || can("task.signoff") || can("je.approve") || can("context.propose");
  return (
    <div>
      {q.data?.length ? (
        <ul className="mb-3 space-y-2">
          {q.data.map((c) => (
            <li key={c.id} className="flex gap-2">
              <Initials name={name(c.authorId)} />
              <div className="min-w-0 flex-1 rounded-md bg-muted/60 px-3 py-2">
                <p className="text-xs">
                  <span className="font-semibold">{name(c.authorId)}</span> <span className="text-muted-foreground">· {dateTimeLabel(c.createdAt)}</span>
                </p>
                <p className="whitespace-pre-line text-sm">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MessageSquare className="size-4" /> No comments yet.
        </p>
      )}
      {canComment ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) post.mutate(text.trim());
          }}
        >
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment for your colleagues…" aria-label="Comment" className="min-h-16" />
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" loading={post.isPending} disabled={!text.trim()}>
              Post comment
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Your role is read-only.</p>
      )}
    </div>
  );
}
