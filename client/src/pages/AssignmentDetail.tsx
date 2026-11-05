import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { ArrowLeft, Download, ExternalLink, FileText, Pencil, Trash2 } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { formatDateTime, formatRoom } from '@/lib/utils.ts';
import { FILE_RULES, checkFile, downloadPrivateFile, sendFile } from '@/lib/upload.ts';
import { FilePicker } from '@/components/common/FilePicker.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { AssignmentStatusBadge } from '@/components/assignments/AssignmentStatusBadge.tsx';
import { AssignmentFormDialog } from '@/components/assignments/AssignmentFormDialog.tsx';
import { GradeDialog, GradeTarget } from '@/components/assignments/GradeDialog.tsx';
import { isWebUrl, type AssignmentItem, type AssignmentStatus } from '@/components/assignments/types.ts';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { InPersonBadge, MyScoreCard } from '@/components/coursework/shared.tsx';
import { ScoreSheet } from '@/components/coursework/ScoreSheet.tsx';

interface SubmissionRow {
  student_id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  submission_id: string | null;
  file_url: string | null;
  file_name: string | null;
  is_file: boolean;
  submitted_at: string | null;
  grade: number | null;
  feedback: string | null;
  graded_at: string | null;
  is_late: boolean;
}

function rowStatus(row: SubmissionRow): AssignmentStatus | 'missing' {
  if (!row.submission_id) return 'missing';
  return row.grade !== null ? 'graded' : 'submitted';
}

export default function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [gradeTarget, setGradeTarget] = useState<GradeTarget | null>(null);
  const [deletingAssignment, setDeletingAssignment] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  // Student hand-in form: either an uploaded file or a link
  const [handInMode, setHandInMode] = useState<'file' | 'link'>('file');
  const [link, setLink] = useState('');
  const [handInFile, setHandInFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isStudent = user?.role === 'student';

  const { data, isLoading, isError, refetch } = useGet<{ assignment: AssignmentItem }>(
    ['assignment', id ?? ''],
    `/assignments/${id}`,
    { enabled: !!id },
  );
  const assignment = data?.assignment;
  const canManage = !isStudent && !!assignment?.can_manage;
  // Announced only: nothing is handed in online, the teacher types in the scores.
  const inPerson = assignment?.delivery === 'in_person';

  const { data: subData, isLoading: subsLoading } = useGet<{ submissions: SubmissionRow[] }>(
    ['submissions', id ?? ''],
    `/submissions?assignment_id=${id}`,
    { enabled: !!id && canManage && !inPerson },
  );
  const rows = subData?.submissions ?? [];

  const refreshAll = () => {
    queryClient.invalidateQueries('assignment');
    queryClient.invalidateQueries('assignments');
    queryClient.invalidateQueries('submissions');
    queryClient.invalidateQueries('scores');
    queryClient.invalidateQueries('grades');
    queryClient.invalidateQueries('dashboard-stats');
  };

  const back = (
    <Link to="/coursework?type=assignment" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-4 h-4 mr-1" /> Coursework
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !assignment) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load this assignment. It may no longer exist.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const handIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    if (handInMode === 'file') {
      if (!handInFile) {
        setSubmitError('Choose a file to hand in.');
        return;
      }
      const problem = checkFile(handInFile, FILE_RULES.document);
      if (problem) {
        setSubmitError(problem);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (handInMode === 'file' && handInFile) {
        await sendFile('post', '/submissions/file', handInFile, { assignment_id: assignment.id }, setProgress);
      } else {
        await api.post('/submissions', { assignment_id: assignment.id, file_url: link.trim() });
      }
      toast({ title: assignment.submission_id ? 'Submission updated' : 'Submitted', variant: 'success' });
      setLink('');
      setHandInFile(null);
      setProgress(0);
      refreshAll();
    } catch (err) {
      setSubmitError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const download = (endpoint: string) =>
    downloadPrivateFile(endpoint).catch((err) =>
      toast({ title: 'Couldn’t download the file', description: getErrorMessage(err), variant: 'destructive' }),
    );

  const togglePublish = async () => {
    setPublishing(true);
    setPublishError('');
    try {
      await api.patch(`/assignments/${assignment.id}`, { is_published: !assignment.is_published });
      toast({ title: assignment.is_published ? 'Assignment unpublished' : 'Assignment published', variant: 'success' });
      refreshAll();
    } catch (err) {
      setPublishError(getErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const confirmDeleteAssignment = async () => {
    await api.delete(`/assignments/${assignment.id}`);
    toast({ title: 'Assignment deleted', variant: 'success' });
    queryClient.invalidateQueries('assignments');
    navigate('/assignments');
    setDeletingAssignment(false);
  };

  const missingCount = rows.filter((r) => !r.submission_id).length;
  const gradedCount = rows.filter((r) => r.grade !== null).length;
  const handedInCount = rows.length - missingCount;
  const isGraded = assignment.status === 'graded';
  const pastDue = new Date(assignment.due_date).getTime() < Date.now();

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {back}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{assignment.course_code}</Badge>
              {inPerson && <InPersonBadge />}
              {canManage && (
                <Badge variant={assignment.is_published ? 'success' : 'warning'}>
                  {assignment.is_published ? 'Published' : 'Draft'}
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">{assignment.module_title}</span>
            </div>
            <h1 className="text-2xl font-bold">{assignment.title}</h1>
            <p className="text-sm text-muted-foreground">
              {inPerson
                ? `${formatDateTime(assignment.due_date)}${assignment.room ? ` · ${formatRoom(assignment.room)}` : ''} · ${assignment.max_score} points`
                : `Due ${formatDateTime(assignment.due_date)} · ${assignment.max_score} points`}
            </p>
            {assignment.instructions && (
              <p className="text-sm max-w-2xl whitespace-pre-wrap break-words">{assignment.instructions}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {assignment.has_attachment_file && (
                <button
                  type="button"
                  onClick={() => download(`/assignments/${assignment.id}/attachment`)}
                  className="inline-flex items-center text-sm text-primary hover:underline"
                >
                  <Download className="w-4 h-4 mr-1" /> {assignment.attachment_name ?? 'Download material'}
                </button>
              )}
              {isWebUrl(assignment.attachment_url) && (
                <a href={assignment.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-sm text-primary hover:underline">
                  <FileText className="w-4 h-4 mr-1" /> Open material <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              )}
            </div>
          </div>
          {canManage && (
            <div className="flex gap-2 shrink-0 flex-wrap">
              <Button
                onClick={togglePublish}
                disabled={publishing || (assignment.is_published && (assignment.submitted_count ?? 0) > 0)}
                variant={assignment.is_published ? 'outline' : 'default'}
                title={
                  assignment.is_published && (assignment.submitted_count ?? 0) > 0
                    ? 'Students have already handed in work, so it can no longer be unpublished.'
                    : undefined
                }
              >
                {assignment.is_published ? 'Unpublish' : 'Publish'}
              </Button>
              <Button onClick={() => setEditing(true)}>
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
              {canManage && (
                <Button variant="destructive" onClick={() => setDeletingAssignment(true)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </Button>
              )}
            </div>
          )}
        </div>
        {publishError && <p className="text-sm text-destructive">{publishError}</p>}
        {canManage && !assignment.is_published && (
          <p className="text-sm text-muted-foreground">
            This assignment is a draft. Students can’t see it, and won’t be notified, until you publish it.
          </p>
        )}
      </div>

      {isStudent && inPerson && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Your score</h2>
          <MyScoreCard
            status={assignment.status}
            score={assignment.manual_score}
            max={assignment.max_score}
            percent={assignment.manual_percent}
            feedback={assignment.manual_feedback}
            gradedAt={assignment.manual_graded_at}
          />
        </section>
      )}

      {canManage && inPerson && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Scores</h2>
          <p className="text-sm text-muted-foreground">
            This assignment is checked face to face. Enter each student’s score afterwards; students see their own
            score and comment, and are notified when it appears.
          </p>
          <ScoreSheet type="assignment" itemId={assignment.id} />
        </section>
      )}

      {isStudent && !inPerson && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Your work</h2>
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <AssignmentStatusBadge status={assignment.status} isLate={assignment.is_late} />
              {assignment.submitted_at && (
                <span className="text-sm text-muted-foreground">Handed in {formatDateTime(assignment.submitted_at)}</span>
              )}
            </div>

            {assignment.submission_is_file && assignment.submission_id ? (
              <button
                type="button"
                onClick={() => download(`/submissions/${assignment.submission_id}/download`)}
                className="inline-flex items-center text-sm text-primary hover:underline break-all text-left"
              >
                <Download className="w-4 h-4 mr-1 shrink-0" /> {assignment.submission_file_name ?? 'Your file'}
              </button>
            ) : (
              isWebUrl(assignment.submission_url) && (
                <a href={assignment.submission_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-sm text-primary hover:underline break-all">
                  {assignment.submission_url} <ExternalLink className="w-3 h-3 ml-1 shrink-0" />
                </a>
              )
            )}

            {isGraded && (
              <div className="rounded-lg border border-input bg-muted/40 p-4 space-y-1">
                <p className="font-semibold">
                  Grade: {assignment.grade} / {assignment.max_score}
                </p>
                {assignment.feedback && <p className="text-sm whitespace-pre-wrap">{assignment.feedback}</p>}
                <p className="text-xs text-muted-foreground">This work has been graded and can no longer be changed.</p>
              </div>
            )}

            {!isGraded && (
              <form onSubmit={handIn} className="space-y-3">
                <div className="inline-flex rounded-md border border-input p-0.5 text-sm" role="tablist" aria-label="How to hand in">
                  {(['file', 'link'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={handInMode === m}
                      onClick={() => setHandInMode(m)}
                      disabled={submitting}
                      className={`rounded px-3 py-1 ${handInMode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                    >
                      {m === 'file' ? 'Upload a file' : 'Paste a link'}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {handInMode === 'file' ? (
                    <>
                      <FilePicker
                        label={assignment.submission_id ? 'Replace your work' : 'Your file'}
                        rule={FILE_RULES.document}
                        file={handInFile}
                        onChange={setHandInFile}
                        disabled={submitting}
                      />
                      {submitting && <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>}
                    </>
                  ) : (
                    <>
                      <Label htmlFor="hand-in-link">
                        {assignment.submission_id ? 'Replace your link' : 'Link to your work'}
                      </Label>
                      <Input
                        id="hand-in-link"
                        type="url"
                        required
                        placeholder="https://docs.google.com/…"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                      />
                    </>
                  )}
                  {pastDue && (
                    <p className="text-xs text-amber-600">
                      This assignment is past due. You can still hand it in, but it will be marked late.
                    </p>
                  )}
                </div>
                {submitError && <p className="text-sm text-destructive">{submitError}</p>}
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Submitting…' : assignment.submission_id ? 'Resubmit' : 'Submit'}
                </Button>
              </form>
            )}
          </Card>
        </section>
      )}

      {!isStudent && !inPerson && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Submissions</h2>
          {!canManage ? (
            <Card className="p-6 text-sm text-muted-foreground">
              Only this course’s teacher (or an administrator) can see and grade submissions.
            </Card>
          ) : subsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {handedInCount} handed in · {gradedCount} graded · {missingCount} missing
              </p>
              <div className="rounded-xl border border-input bg-card overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead className="w-40">Status</TableHead>
                      <TableHead className="w-48">Handed in</TableHead>
                      <TableHead className="w-24">Grade</TableHead>
                      <TableHead className="w-28 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const status = rowStatus(r);
                      const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.student_number;
                      return (
                        <TableRow key={r.student_id}>
                          <TableCell>
                            <div className="font-medium">{name}</div>
                            <div className="text-xs text-muted-foreground">{r.student_number}</div>
                          </TableCell>
                          <TableCell>
                            {status === 'missing' ? (
                              <Badge variant="outline">Missing</Badge>
                            ) : (
                              <AssignmentStatusBadge status={status} isLate={r.is_late} />
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.submitted_at ? formatDateTime(r.submitted_at) : '—'}
                            {r.is_file && r.submission_id ? (
                              <button
                                type="button"
                                onClick={() => download(`/submissions/${r.submission_id}/download`)}
                                className="block text-primary hover:underline text-xs text-left"
                              >
                                Download {r.file_name ?? 'file'}
                              </button>
                            ) : (
                              isWebUrl(r.file_url) && (
                                <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline text-xs">
                                  Open work
                                </a>
                              )
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.grade !== null ? `${r.grade} / ${assignment.max_score}` : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.submission_id && (
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`${r.grade !== null ? 'Edit grade for' : 'Grade'} ${name}`}
                                onClick={() =>
                                  setGradeTarget({
                                    submissionId: r.submission_id as string,
                                    studentName: name,
                                    fileUrl: r.file_url,
                                    isFile: r.is_file,
                                    fileName: r.file_name,
                                    maxScore: assignment.max_score,
                                    currentGrade: r.grade,
                                    currentFeedback: r.feedback,
                                  })
                                }
                              >
                                {r.grade !== null ? 'Edit grade' : 'Grade'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>
      )}

      <AssignmentFormDialog
        open={editing}
        onOpenChange={setEditing}
        mode="edit"
        assignment={assignment}
        onSaved={() => {
          refreshAll();
          toast({ title: 'Assignment updated', variant: 'success' });
        }}
      />

      <GradeDialog
        open={gradeTarget !== null}
        onOpenChange={(open) => !open && setGradeTarget(null)}
        target={gradeTarget}
        onSaved={() => {
          refreshAll();
          toast({ title: 'Grade saved', variant: 'success' });
        }}
      />

      {deletingAssignment && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeletingAssignment(false)}
          title="Delete this assignment?"
          description={`“${assignment.title}” and all its submissions will be removed permanently.`}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDeleteAssignment}
        />
      )}
    </div>
  );
}
