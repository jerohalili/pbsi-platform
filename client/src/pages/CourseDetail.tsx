import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  HelpCircle,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { CourseFormDialog, CourseFormValues } from '@/components/courses/CourseFormDialog.tsx';
import { ModuleFormDialog, ModuleFormValues } from '@/components/courses/ModuleFormDialog.tsx';
import { ModuleContentViewer } from '@/components/courses/ModuleContentViewer.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { AssignmentFormDialog } from '@/components/assignments/AssignmentFormDialog.tsx';
import { AssignmentStatusBadge } from '@/components/assignments/AssignmentStatusBadge.tsx';
import type { AssignmentItem } from '@/components/assignments/types.ts';
import { QuizFormDialog } from '@/components/quizzes/QuizFormDialog.tsx';
import { formatTimeLimit, type QuizItem } from '@/components/quizzes/types.ts';
import { formatDateTime } from '@/lib/utils.ts';

interface Course extends CourseFormValues {
  teacher_first_name: string | null;
  teacher_last_name: string | null;
  is_mine: boolean;
}

interface Module extends ModuleFormValues {
  course_id: string;
}

interface ModuleContent {
  id: string;
  module_id: string;
  type: 'text' | 'video' | 'image' | 'file' | 'link';
  title: string | null;
  content: string | null;
  url: string | null;
  cloudinary_public_id: string | null;
  resource_type: string | null;
  order_index: number;
  created_at: string;
}

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingCourse, setEditingCourse] = useState(false);
  const [assignmentModuleId, setAssignmentModuleId] = useState<string | null>(null);
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [creatingQuiz, setCreatingQuiz] = useState(false);
  const [creatingModule, setCreatingModule] = useState(false);
  // Collapsed modules show only their title and lesson notes. Everything starts expanded.
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());
  const [reordering, setReordering] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'course' }
    | { kind: 'module'; module: Module }
    | { kind: 'assignment'; assignment: AssignmentItem }
    | { kind: 'quiz'; quiz: QuizItem }
    | null
  >(null);

  const { data, isLoading, isError, refetch } = useGet<{ course: Course; modules: Module[] }>(
    ['course', id ?? ''],
    `/courses/${id}`,
    { enabled: !!id },
  );

  const { data: assignmentData } = useGet<{ assignments: AssignmentItem[] }>(
    ['assignments', 'course', id ?? ''],
    `/assignments?course_id=${id}`,
    { enabled: !!id },
  );
  const assignmentsByModule = (assignmentData?.assignments ?? []).reduce<Record<string, AssignmentItem[]>>(
    (acc, a) => {
      (acc[a.module_id] ||= []).push(a);
      return acc;
    },
    {},
  );
  const allAssignments = Object.values(assignmentsByModule).flat();

  const { data: quizData } = useGet<{ quizzes: QuizItem[] }>(
    ['quizzes', 'course', id ?? ''],
    `/quizzes?course_id=${id}`,
    { enabled: !!id },
  );
  const quizzes = quizData?.quizzes ?? [];

  const isAdmin = user?.role === 'admin';
  const isStudent = user?.role === 'student';
  const course = data?.course;
  const modules = data?.modules ?? [];
  const canEdit = !!course && (isAdmin || (user?.role === 'teacher' && course.is_mine));

  // Fetch contents for every module so students can read them and teachers can manage them.
  const [allContents, setAllContents] = useState<Record<string, ModuleContent[]>>({});

  const fetchModuleContents = async () => {
    if (!modules.length) return;
    try {
      const results = await Promise.all(
        modules.map((m) =>
          api.get<{ contents: ModuleContent[] }>(`/modules/${m.id}/contents`),
        ),
      );
      const next: Record<string, ModuleContent[]> = {};
      modules.forEach((m, i) => {
        next[m.id] = results[i]?.data?.contents ?? [];
      });
      setAllContents(next);
    } catch {
      // Contents are optional; don't block the page if this fails.
    }
  };

  // Fetch contents whenever the module list changes.
  useEffect(() => {
    fetchModuleContents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules.length, id]);

  const refresh = async () => {
    queryClient.invalidateQueries('course');
    queryClient.invalidateQueries('courses');
    queryClient.invalidateQueries('assignments');
    queryClient.invalidateQueries('quizzes');
    await fetchModuleContents();
  };

  const allCollapsed = modules.length > 0 && modules.every((m) => collapsedModules.has(m.id));

  const toggleModule = (moduleId: string) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  const toggleAllModules = () => {
    setCollapsedModules(allCollapsed ? new Set() : new Set(modules.map((m) => m.id)));
  };

  // Swaps a module with its neighbour. The list updates right away and rolls back if saving fails.
  const moveModule = async (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (!data || !course || reordering || target < 0 || target >= modules.length) return;

    const reordered = [...modules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    const queryKey = ['course', id ?? ''];
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, {
      ...data,
      modules: reordered.map((m, i) => ({ ...m, order_index: i })),
    });

    setReordering(true);
    try {
      await api.patch(`/modules/course/${course.id}/reorder`, { module_ids: reordered.map((m) => m.id) });
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      toast({ title: 'Couldn’t reorder modules', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setReordering(false);
      queryClient.invalidateQueries('course');
    }
  };

  const deleteCourse = async () => {
    setDeleteTarget({ kind: 'course' });
  };

  const deleteModule = async (module: Module) => {
    setDeleteTarget({ kind: 'module', module });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'course') {
      await api.delete(`/courses/${id}`);
      toast({ title: 'Course deleted', variant: 'success' });
      queryClient.invalidateQueries('courses');
      navigate('/courses');
    } else if (deleteTarget.kind === 'module') {
      await api.delete(`/modules/${deleteTarget.module.id}`);
      toast({ title: 'Module deleted', variant: 'success' });
      refresh();
    } else if (deleteTarget.kind === 'assignment') {
      await api.delete(`/assignments/${deleteTarget.assignment.id}`);
      toast({ title: 'Assignment deleted', variant: 'success' });
      queryClient.invalidateQueries('assignments');
      refresh();
    } else if (deleteTarget.kind === 'quiz') {
      await api.delete(`/quizzes/${deleteTarget.quiz.id}`);
      toast({ title: 'Quiz deleted', variant: 'success' });
      queryClient.invalidateQueries('quizzes');
      refresh();
    }
    setDeleteTarget(null);
  };

  const back = (
    <Link to="/courses" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-4 h-4 mr-1" /> Courses
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !course) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load this course. It may no longer exist.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const teacherName = `${course.teacher_first_name ?? ''} ${course.teacher_last_name ?? ''}`.trim() || '—';

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {back}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{course.code}</Badge>
              {course.is_mine && <Badge variant="success">Your course</Badge>}
            </div>
            <h1 className="text-2xl font-bold">{course.name}</h1>
            <p className="text-sm text-muted-foreground">
              Teacher: {teacherName} · {course.credits} {course.credits === 1 ? 'credit' : 'credits'}
            </p>
            {course.description && <p className="text-sm max-w-2xl whitespace-pre-wrap">{course.description}</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" asChild>
              <Link to={`/discussions?course=${course.id}`}>
                <MessageCircle className="w-4 h-4 mr-2" /> Discussions
              </Link>
            </Button>
            {canEdit && (
              <Button onClick={() => setEditingCourse(true)}>
                <Pencil className="w-4 h-4 mr-2" /> Edit course
              </Button>
            )}
            {canEdit && (
              <Button variant="destructive" onClick={deleteCourse}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Modules</h2>
          <div className="flex items-center gap-2">
            {modules.length > 0 && (
              <Button variant="outline" onClick={toggleAllModules}>
                {allCollapsed ? (
                  <ChevronsUpDown className="w-4 h-4 mr-2" />
                ) : (
                  <ChevronsDownUp className="w-4 h-4 mr-2" />
                )}
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </Button>
            )}
            {canEdit && (
              <Button onClick={() => setCreatingModule(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add module
              </Button>
            )}
          </div>
        </div>

        {modules.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <p>No modules yet.</p>
            {canEdit && <p className="text-sm mt-1">Add the first module to start building this course.</p>}
          </Card>
        ) : (
          <div className="space-y-3">
            {modules.map((m, index) => {
              const isCollapsed = collapsedModules.has(m.id);
              return (
                <Card key={m.id} className="space-y-4 p-5">
                  {/* Header: always visible, even when collapsed. The buttons live here, so the
                      content below can use the full width of the card. */}
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="flex min-w-[14rem] flex-1 items-start gap-2">
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} module ${m.title}`}
                        title={isCollapsed ? 'Expand' : 'Collapse'}
                        onClick={() => toggleModule(m.id)}
                      >
                        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className="font-bold">
                          <span className="text-muted-foreground mr-2">{index + 1}.</span>
                          {m.title}
                        </h3>
                        {m.rich_description && (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{m.rich_description}</p>
                        )}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move module ${m.title} up`}
                          title="Move up"
                          disabled={index === 0 || reordering}
                          onClick={() => moveModule(index, 'up')}
                        >
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Move module ${m.title} down`}
                          title="Move down"
                          disabled={index === modules.length - 1 || reordering}
                          onClick={() => moveModule(index, 'down')}
                        >
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        <Button asChild size="sm" aria-label={`Edit module ${m.title}`}>
                          <Link to={`/courses/${course.id}/modules/${m.id}/edit`}>
                            <Pencil className="w-4 h-4 mr-2" /> Edit
                          </Link>
                        </Button>
                        <Button variant="destructive" size="icon" aria-label={`Delete module ${m.title}`} title="Delete" onClick={() => deleteModule(m)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Body: module content blocks, full width of the card. */}
                  {!isCollapsed && <ModuleContentViewer contents={allContents[m.id] ?? []} />}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Quizzes</h2>
          {canEdit && (
            <Button onClick={() => setCreatingQuiz(true)}>
              <Plus className="w-4 h-4 mr-2" /> New quiz
            </Button>
          )}
        </div>

        {quizzes.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <p>No quizzes yet.</p>
            {canEdit && <p className="text-sm mt-1">Create a quiz, add questions, then publish it for students.</p>}
          </Card>
        ) : (
          <div className="space-y-3">
            {quizzes.map((q) => (
              <Card key={q.id} className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <HelpCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                      {(!isStudent && q.can_manage) ? (
                        <span className="font-medium">{q.title}</span>
                      ) : (
                        <Link to={`/quizzes/${q.id}`} className="font-medium hover:underline">
                          {q.title}
                        </Link>
                      )}
                      {(!isStudent && q.can_manage) && (
                        <Badge variant={q.is_published ? 'success' : 'warning'}>{q.is_published ? 'Published' : 'Draft'}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {q.question_count} {q.question_count === 1 ? 'question' : 'questions'} · {q.total_points} points ·{' '}
                      {formatTimeLimit(q.time_limit_minutes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {q.status === 'completed' && q.attempt_id ? (
                      <Link to={`/quiz-results/${q.attempt_id}`} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                        <Badge variant="success">Completed</Badge> {q.my_score}%
                      </Link>
                    ) : q.status === 'not_taken' ? (
                      <Button asChild size="sm">
                        <Link to={`/quizzes/${q.id}`}>Take quiz</Link>
                      </Button>
                    ) : null}
                    {(!isStudent && q.can_manage) && (
                      <Button asChild size="sm" aria-label={`Open quiz ${q.title}`}>
                        <Link to={`/quizzes/${q.id}`}>
                          Open <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                      </Button>
                    )}
                    {(!isStudent && q.can_manage) && (
                      <Button
                        variant="destructive"
                        size="icon"
                        aria-label={`Delete quiz ${q.title}`}
                        title="Delete"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          setDeleteTarget({ kind: 'quiz', quiz: q });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Assignments</h2>
          {canEdit && (
            <Button onClick={() => {
              setCreatingAssignment(true);
              setAssignmentModuleId(null);
            }}>
              <Plus className="w-4 h-4 mr-2" /> New assignment
            </Button>
          )}
        </div>

        {/* Flatten all assignments across modules */}
        {allAssignments.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <p>No assignments yet.</p>
            {canEdit && <p className="text-sm mt-1">Create assignments to give students work to hand in.</p>}
          </Card>
        ) : (
          <div className="space-y-3">
            {allAssignments.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />
                      {(!isStudent && a.can_manage) ? (
                        <span className="font-medium truncate">{a.title}</span>
                      ) : (
                        <Link to={`/assignments/${a.id}`} className="font-medium hover:underline truncate">
                          {a.title}
                        </Link>
                      )}
                      <span className="text-xs text-muted-foreground truncate">Module: {a.module_title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Due {formatDateTime(a.due_date)} · Max {a.max_score}
                      {a.grade !== null && ` · Your grade: ${a.grade}`}
                    </p>
                    {a.status && <AssignmentStatusBadge status={a.status} isLate={a.is_late} />}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {isStudent && (
                      <Button asChild size="sm" variant="outline" aria-label={`Open assignment ${a.title}`}>
                        <Link to={`/assignments/${a.id}`}>
                          {a.status === 'not_submitted' || a.status === 'overdue' ? 'Submit' : 'View'}
                        </Link>
                      </Button>
                    )}
                    {(!isStudent && a.can_manage) && (
                      <Button asChild size="sm" aria-label={`Open assignment ${a.title}`}>
                        <Link to={`/assignments/${a.id}`}>
                          Open <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        variant="destructive"
                        size="icon"
                        aria-label={`Delete assignment ${a.title}`}
                        title="Delete"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          setDeleteTarget({ kind: 'assignment', assignment: a });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <CourseFormDialog
        open={editingCourse}
        onOpenChange={setEditingCourse}
        mode="edit"
        isAdmin={isAdmin}
        course={course}
        onSaved={() => {
          refresh();
          toast({ title: 'Course updated', variant: 'success' });
        }}
      />

      <QuizFormDialog
        open={creatingQuiz}
        onOpenChange={setCreatingQuiz}
        mode="create"
        courseId={course.id}
        onSaved={(quiz) => {
          refresh();
          toast({ title: 'Quiz created', variant: 'success' });
          navigate(`/quizzes/${quiz.id}`);
        }}
      />

      <AssignmentFormDialog
        open={assignmentModuleId !== null || creatingAssignment}
        onOpenChange={(open) => {
          if (!open) {
            setAssignmentModuleId(null);
            setCreatingAssignment(false);
          }
        }}
        mode="create"
        moduleId={assignmentModuleId ?? undefined}
        modules={modules.map((m) => ({ id: m.id, title: m.title }))}
        onSaved={() => {
          refresh();
          toast({ title: 'Assignment created', variant: 'success' });
        }}
      />

      <ModuleFormDialog
        open={creatingModule}
        onOpenChange={setCreatingModule}
        courseId={course.id}
        nextOrderIndex={modules.length > 0 ? Math.max(...modules.map((m) => m.order_index)) + 1 : 0}
        onSaved={() => {
          refresh();
          toast({ title: 'Module added', variant: 'success' });
        }}
      />

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title={
            deleteTarget.kind === 'course'
              ? 'Delete this course?'
              : deleteTarget.kind === 'module'
                ? 'Delete this module?'
                : deleteTarget.kind === 'assignment'
                  ? 'Delete this assignment?'
                  : 'Delete this quiz?'
          }
          description={
            deleteTarget.kind === 'course'
              ? `“${course.name}” and all its modules, assignments, quizzes, and related records will be removed permanently.`
              : deleteTarget.kind === 'module'
                ? `“${deleteTarget.module.title}” and all its assignments and submissions will be removed permanently.`
                : deleteTarget.kind === 'assignment'
                  ? `“${deleteTarget.assignment.title}” and all its submissions will be removed permanently.`
                  : `“${deleteTarget.quiz.title}” and all its questions and attempts will be removed permanently.`
          }
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
