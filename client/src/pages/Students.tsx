import { useEffect, useState } from 'react';
import { useQueryClient } from 'react-query';
import { KeyRound, Pencil, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGet } from '@/hooks/useApi.ts';
import { formatAverage } from '@/lib/utils.ts';
import api from '@/lib/api.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { UserFormDialog, ManagedUser } from '@/components/users/UserFormDialog.tsx';
import { ResetPasswordDialog } from '@/components/users/ResetPasswordDialog.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { DeleteUserDialog } from '@/components/users/DeleteUserDialog.tsx';

// Average grade (percent) at or above which the badge turns green.
const PASSING_AVERAGE = 75;

interface Student {
  id: string;
  user_id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  address: string | null;
  is_active: boolean;
  can_delete: boolean;
  average_grade: number | string | null;
  subjects_assigned: string[] | null;
}

export default function StudentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; user?: ManagedUser } | null>(null);
  const [resetTarget, setResetTarget] = useState<Student | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Student | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, refetch } = useGet<{ students: Student[] }>(
    ['students', search],
    `/students?search=${encodeURIComponent(search)}`,
    { keepPreviousData: true },
  );

  const students = data?.students ?? [];

  const refreshEverywhere = () => {
    queryClient.invalidateQueries('students');
    queryClient.invalidateQueries('users');
    queryClient.invalidateQueries('dashboard-stats');
  };

  const toggleActive = async () => {
    if (!toggleTarget) return;
    const action = toggleTarget.is_active ? 'deactivate' : 'reactivate';
    await api.patch(`/users/${toggleTarget.user_id}/${action}`);
    toast({
      title: toggleTarget.is_active ? 'Student deactivated' : 'Student reactivated',
      description: `${toggleTarget.first_name} ${toggleTarget.last_name}`,
      variant: 'success',
    });
    refreshEverywhere();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div data-tour="stu-header">
          <h1 className="text-2xl font-bold">Student Directory</h1>
          <p className="text-muted-foreground">Manage and view student records.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            data-tour="stu-search"
            type="text"
            placeholder="Search by name or student ID..."
            className="w-64 bg-card"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button data-tour="stu-add" onClick={() => setForm({ mode: 'create' })}>
            <UserPlus className="w-4 h-4 mr-2" /> Add Student
          </Button>
        </div>
      </div>

      <div data-tour="stu-table" className="rounded-xl border border-input bg-card overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading students...</div>
        ) : isError ? (
          <div className="p-8 text-center text-muted-foreground space-y-3">
            <p>Couldn’t load students.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : students.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No students found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-28">Average grade</TableHead>
                <TableHead className="w-32">Subjects</TableHead>
                <TableHead className="w-60 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s, i) => {
                const name = `${s.first_name} ${s.last_name}`;
                return (
                  <TableRow key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                    <TableCell className="font-medium">{s.student_id}</TableCell>
                    <TableCell>
                      <Link to={`/students/${s.id}`} className="font-medium hover:underline">
                        {name}
                      </Link>
                      {!s.is_active && (
                        <Badge variant="warning" className="ml-2">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.email}</TableCell>
                    <TableCell>
                      <Badge variant={Number(s.average_grade ?? 0) >= PASSING_AVERAGE ? 'success' : 'default'}>
                        {formatAverage(s.average_grade)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {(Array.isArray(s.subjects_assigned) ? s.subjects_assigned.join(', ') : '') || '—'}
                    </TableCell>
                    <TableCell data-tour={i === 0 ? 'stu-actions' : undefined} className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/students/${s.id}`}>View</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${name}`}
                        title="Edit"
                        onClick={() =>
                          setForm({
                            mode: 'edit',
                            user: {
                              id: s.user_id,
                              email: s.email,
                              role: 'student',
                              first_name: s.first_name,
                              last_name: s.last_name,
                              phone: s.phone,
                              date_of_birth: s.date_of_birth,
                              address: s.address,
                              student_id: s.student_id,
                            },
                          })
                        }
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Reset password for ${name}`} title="Reset password" onClick={() => setResetTarget(s)}>
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${s.is_active ? 'Deactivate' : 'Reactivate'} ${name}`}
                        title={s.is_active ? 'Deactivate' : 'Reactivate'}
                        onClick={() => setToggleTarget(s)}
                      >
                        {s.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </Button>
                      {s.can_delete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${name}`}
                          title="Delete permanently"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <UserFormDialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        mode={form?.mode ?? 'create'}
        allowedRoles={['student']}
        user={form?.user}
        onSaved={() => {
          refreshEverywhere();
          if (form?.mode === 'edit') toast({ title: 'Student updated', variant: 'success' });
        }}
      />

      <ResetPasswordDialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        target={
          resetTarget && {
            id: resetTarget.user_id,
            email: resetTarget.email,
            name: `${resetTarget.first_name} ${resetTarget.last_name}`,
          }
        }
      />

      {toggleTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setToggleTarget(null)}
          title={toggleTarget.is_active ? 'Deactivate student?' : 'Reactivate student?'}
          description={
            toggleTarget.is_active
              ? `${toggleTarget.first_name} ${toggleTarget.last_name} will no longer be able to sign in. Their records are kept and you can reactivate them at any time.`
              : `${toggleTarget.first_name} ${toggleTarget.last_name} will be able to sign in again.`
          }
          confirmLabel={toggleTarget.is_active ? 'Deactivate' : 'Reactivate'}
          onConfirm={toggleActive}
        />
      )}

      <DeleteUserDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        target={
          deleteTarget && {
            id: deleteTarget.user_id,
            name: `${deleteTarget.first_name} ${deleteTarget.last_name}`,
            email: deleteTarget.email,
          }
        }
        onDeleted={() => {
          if (deleteTarget) {
            toast({
              title: 'Student deleted',
              description: `${deleteTarget.first_name} ${deleteTarget.last_name}`,
              variant: 'success',
            });
          }
          refreshEverywhere();
        }}
      />
    </div>
  );
}
