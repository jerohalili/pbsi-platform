import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Flag,
  Lock,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { AuthorLine } from '@/components/discussions/AuthorLine.tsx';
import { ReportDialog, type ReportTarget } from '@/components/discussions/ReportDialog.tsx';
import {
  personName,
  REPLY_MAX,
  THREAD_BODY_MAX,
  THREAD_TITLE_MAX,
  type ReplyItem,
  type ThreadDetail,
} from '@/components/discussions/types.ts';

type DeleteTarget = { kind: 'thread' } | { kind: 'reply'; id: string };

function snippet(text: string | null, max = 90): string {
  if (!text) return 'a removed reply';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export default function DiscussionThreadPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const threadQuery = useGet<{ thread: ThreadDetail }>(['discussions', 'thread', id], `/discussions/threads/${id}`, {
    retry: false,
  });
  const thread = threadQuery.data?.thread;
  const repliesQuery = useGet<{ replies: ReplyItem[] }>(['discussions', 'replies', id], `/discussions/${id}/replies`, {
    enabled: thread !== undefined,
  });
  const replies = repliesQuery.data?.replies ?? [];
  const repliesById = new Map(replies.map((r) => [r.id, r]));

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyItem | null>(null);
  const [posting, setPosting] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editingThread, setEditingThread] = useState(false);
  const [threadTitle, setThreadTitle] = useState('');
  const [threadBody, setThreadBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const refresh = () => queryClient.invalidateQueries('discussions');
  const fail = (title: string, err: unknown) =>
    toast({ title, description: getErrorMessage(err), variant: 'destructive' });

  const back = (
    <Link
      to={thread ? `/discussions?course=${thread.course_id}` : '/discussions'}
      className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="w-4 h-4 mr-1" /> Discussions
    </Link>
  );

  if (threadQuery.isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (threadQuery.isError || !thread) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load this discussion. It may have been removed.</p>
          <Button variant="outline" size="sm" onClick={() => threadQuery.refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const canReply = !thread.is_locked || thread.can_moderate;
  const canMarkAnswer = thread.is_mine || thread.can_moderate;
  // The first reply still on screen carries the walkthrough marker for the reply buttons.
  const firstLiveReplyId = replies.find((x) => !x.is_deleted)?.id;

  const patchThread = async (changes: Record<string, unknown>, failTitle: string) => {
    try {
      await api.patch(`/discussions/threads/${thread.id}`, changes);
      refresh();
    } catch (err) {
      fail(failTitle, err);
    }
  };

  const saveThreadEdit = async () => {
    setSaving(true);
    try {
      await api.patch(`/discussions/threads/${thread.id}`, { title: threadTitle, body: threadBody });
      setEditingThread(false);
      refresh();
    } catch (err) {
      fail('Couldn’t save your changes', err);
    } finally {
      setSaving(false);
    }
  };

  const postReply = async (e: React.FormEvent) => {
    e.preventDefault();
    setPosting(true);
    try {
      await api.post(`/discussions/${thread.id}/replies`, {
        content: draft,
        parent_reply_id: replyTo?.id ?? null,
      });
      setDraft('');
      setReplyTo(null);
      refresh();
    } catch (err) {
      fail('Couldn’t post your reply', err);
    } finally {
      setPosting(false);
    }
  };

  const saveReplyEdit = async (replyId: string) => {
    setSaving(true);
    try {
      await api.patch(`/discussions/replies/${replyId}`, { content: editText });
      setEditingReplyId(null);
      refresh();
    } catch (err) {
      fail('Couldn’t save your changes', err);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'thread') {
      await api.delete(`/discussions/threads/${thread.id}`);
      toast({ title: 'Discussion deleted', variant: 'success' });
      queryClient.invalidateQueries('discussions');
      navigate(`/discussions?course=${thread.course_id}`);
    } else {
      await api.delete(`/discussions/replies/${deleteTarget.id}`);
      toast({ title: 'Reply deleted', variant: 'success' });
      if (replyTo?.id === deleteTarget.id) setReplyTo(null);
      refresh();
    }
  };

  return (
    <div className="space-y-6">
      {back}

      <Card data-tour="dt-post" className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{thread.course_code}</Badge>
              {thread.is_pinned && (
                <Badge variant="outline">
                  <Pin className="w-3 h-3 mr-1" /> Pinned
                </Badge>
              )}
              {thread.answer_reply_id && (
                <Badge variant="success">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Answered
                </Badge>
              )}
              {thread.is_locked && (
                <Badge variant="secondary">
                  <Lock className="w-3 h-3 mr-1" /> Locked
                </Badge>
              )}
            </div>
            {editingThread ? (
              <Input
                aria-label="Title"
                maxLength={THREAD_TITLE_MAX}
                value={threadTitle}
                onChange={(e) => setThreadTitle(e.target.value)}
              />
            ) : (
              <h1 className="text-2xl font-bold break-words">{thread.title}</h1>
            )}
          </div>
          <div className="flex items-center flex-wrap gap-1">
            {thread.can_moderate && (
              <>
                <Button
                  data-tour="dt-moderate"
                  variant="outline"
                  size="sm"
                  onClick={() => patchThread({ is_pinned: !thread.is_pinned }, 'Couldn’t update the discussion')}
                >
                  {thread.is_pinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                  {thread.is_pinned ? 'Unpin' : 'Pin'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => patchThread({ is_locked: !thread.is_locked }, 'Couldn’t update the discussion')}
                >
                  {thread.is_locked ? <Unlock className="w-4 h-4 mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                  {thread.is_locked ? 'Unlock' : 'Lock'}
                </Button>
              </>
            )}
            {thread.is_mine && !editingThread && (
              <Button
                data-tour="dt-edit"
                variant="outline"
                size="sm"
                disabled={thread.is_locked && !thread.can_moderate}
                onClick={() => {
                  setThreadTitle(thread.title);
                  setThreadBody(thread.body);
                  setEditingThread(true);
                }}
              >
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
            )}
            {(thread.is_mine || thread.can_moderate) && (
              <Button variant="destructive" size="sm" onClick={() => setDeleteTarget({ kind: 'thread' })}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            )}
            {!thread.is_mine && (
              <Button data-tour="dt-report" variant="ghost" size="sm" onClick={() => setReportTarget({ kind: 'thread', id: thread.id })}>
                <Flag className="w-4 h-4 mr-2" /> Report
              </Button>
            )}
          </div>
        </div>

        <AuthorLine person={thread} createdAt={thread.created_at} editedAt={thread.edited_at} />

        {editingThread ? (
          <div className="space-y-3">
            <Textarea
              aria-label="Your post"
              rows={6}
              maxLength={THREAD_BODY_MAX}
              value={threadBody}
              onChange={(e) => setThreadBody(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={saveThreadEdit} disabled={saving || threadTitle.trim().length < 3 || !threadBody.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="destructive" onClick={() => setEditingThread(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : thread.body ? (
          <p className="whitespace-pre-wrap break-words">{thread.body}</p>
        ) : null}
      </Card>

      <section data-tour="dt-replies" className="space-y-3">
        <h2 className="text-lg font-bold">
          {replies.filter((r) => !r.is_deleted).length}{' '}
          {replies.filter((r) => !r.is_deleted).length === 1 ? 'reply' : 'replies'}
        </h2>

        {repliesQuery.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : repliesQuery.isError ? (
          <Card className="p-4 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Couldn’t load the replies.</p>
            <Button variant="outline" size="sm" onClick={() => repliesQuery.refetch()}>
              Retry
            </Button>
          </Card>
        ) : replies.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">No replies yet. Be the first to help.</Card>
        ) : (
          <ul className="space-y-3">
            {replies.map((r) => {
              const isAnswer = r.id === thread.answer_reply_id;
              const parent = r.parent_reply_id ? repliesById.get(r.parent_reply_id) : undefined;
              const mine = r.author_id === user?.id;

              if (r.is_deleted) {
                return (
                  <li key={r.id}>
                    <Card className="p-3 text-sm italic text-muted-foreground">
                      {r.removed_by_moderator ? 'This reply was removed by a moderator.' : 'This reply was deleted.'}
                    </Card>
                  </li>
                );
              }

              return (
                <li key={r.id} id={`reply-${r.id}`}>
                  <Card className={`p-4 space-y-3 ${isAnswer ? 'border-green-500' : ''}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <AuthorLine person={r} createdAt={r.created_at} editedAt={r.edited_at} />
                      {isAnswer && (
                        <Badge variant="success">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Answer
                        </Badge>
                      )}
                    </div>

                    {r.parent_reply_id && (
                      <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
                        Replying to {parent ? personName(parent) : 'a reply'}: {snippet(parent?.content ?? null)}
                      </blockquote>
                    )}

                    {editingReplyId === r.id ? (
                      <div className="space-y-3">
                        <Textarea
                          aria-label="Edit your reply"
                          rows={4}
                          maxLength={REPLY_MAX}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button onClick={() => saveReplyEdit(r.id)} disabled={saving || !editText.trim()}>
                            {saving ? 'Saving…' : 'Save'}
                          </Button>
                          <Button variant="destructive" onClick={() => setEditingReplyId(null)} disabled={saving}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{r.content}</p>
                    )}

                    <div data-tour={r.id === firstLiveReplyId ? 'dt-reply-actions' : undefined} className="flex items-center flex-wrap gap-1">
                      {canReply && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setReplyTo(r);
                            document.getElementById('reply-box')?.focus();
                          }}
                        >
                          <Reply className="w-4 h-4 mr-2" /> Reply
                        </Button>
                      )}
                      {canMarkAnswer && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            patchThread({ answer_reply_id: isAnswer ? null : r.id }, 'Couldn’t update the answer')
                          }
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" /> {isAnswer ? 'Unmark answer' : 'Mark as answer'}
                        </Button>
                      )}
                      {mine && editingReplyId !== r.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={thread.is_locked && !thread.can_moderate}
                          onClick={() => {
                            setEditingReplyId(r.id);
                            setEditText(r.content ?? '');
                          }}
                        >
                          <Pencil className="w-4 h-4 mr-2" /> Edit
                        </Button>
                      )}
                      {(mine || thread.can_moderate) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget({ kind: 'reply', id: r.id })}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </Button>
                      )}
                      {!mine && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setReportTarget({ kind: 'reply', id: r.id })}
                        >
                          <Flag className="w-4 h-4 mr-2" /> Report
                        </Button>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canReply ? (
        <form data-tour="dt-reply-form" onSubmit={postReply} className="space-y-3">
          {thread.is_locked && (
            <p className="text-sm text-muted-foreground">
              This discussion is locked. Only you (as a teacher or admin) can still reply.
            </p>
          )}
          {replyTo && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="truncate">
                Replying to {personName(replyTo)}: {snippet(replyTo.content, 60)}
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
          <Textarea
            id="reply-box"
            aria-label="Your reply"
            rows={4}
            maxLength={REPLY_MAX}
            placeholder="Write a helpful, kind reply…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {draft.length}/{REPLY_MAX}
            </span>
            <Button type="submit" disabled={posting || !draft.trim()}>
              {posting ? 'Posting…' : 'Post reply'}
            </Button>
          </div>
        </form>
      ) : (
        <Card data-tour="dt-locked" className="p-4 text-sm text-muted-foreground flex items-center gap-2">
          <Lock className="w-4 h-4" /> This discussion is locked, so new replies are turned off.
        </Card>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget?.kind === 'thread' ? 'Delete this discussion?' : 'Delete this reply?'}
        description={
          deleteTarget?.kind === 'thread'
            ? 'The discussion and its replies will no longer be visible.'
            : 'The reply will be replaced by a short note so the conversation still makes sense.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
      <ReportDialog
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onReported={(message) => toast({ title: 'Report sent', description: message, variant: 'success' })}
      />
    </div>
  );
}
