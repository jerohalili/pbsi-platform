import { useEffect, useState } from 'react';
import { useQueryClient } from 'react-query';
import { KeyRound, Pencil, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { UserFormDialog, ManagedUser, ManagedRole } from '@/components/users/UserFormDialog.tsx';
import { ResetPasswordDialog } from '@/components/users/ResetPasswordDialog.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { DeleteUserDialog } from '@/components/users/DeleteUserDialog.tsx';

interface UserRow {
  id: string;
  email: string;
  role: ManagedRole;
  is_active: boolean;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  student_id: string | null;
  employee_id: string | null;
}

type ConfirmState = { kind: 'deactivate' | 'reactivate'; user: UserRow } | null;

const ROLE_BADGE: Record<ManagedRole, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  teacher: 'secondary',
  student: 'outline',
};

const selectClass =
  'flex h-10 items-center rounded-md border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function fullName(u: { first_name: string | null; last_name: string | null; email: string }) {
  return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [form, setForm] = useState<{ mode: 'create' | 'edit'; user?: ManagedUser } | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const isAdmin = me?.role === 'admin';
  const params = new URLSearchParams();
  if (roleFilter) params.set('role', roleFilter);
  if (statusFilter) params.set('status', statusFilter);
  if (search) params.set('search', search);

  const { data, isLoading, isError, refetch } = useGet<{ users: UserRow[] }>(
    ['users', roleFilter, statusFilter, search],
    `/users?${params.toString()}`,
    { enabled: isAdmin, keepPreviousData: true },
  );

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Only administrators can manage accounts.
      </div>
    );
  }

  const users = data?.users ?? [];

  // Anything that shows people or counts of people may have changed.
  const refreshEverywhere = () => {
    queryClient.invalidateQueries('users');
    queryClient.invalidateQueries('students');
    queryClient.invalidateQueries('dashboard-stats');
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    const { kind, user } = confirm;
    await api.patch(`/users/${user.id}/${kind}`);
    toast({
      title: kind === 'deactivate' ? 'Account deactivated' : 'Account reactivated',
      description: fullName(user),
      variant: 'success',
    });
    refreshEverywhere();
  };

  const confirmCopy = confirm && {
    deactivate: {
      title: 'Deactivate account?',
      description: `${fullName(confirm.user)} will no longer be able to sign in. Their records are kept and you can reactivate the account at any time.`,
      label: 'Deactivate',
      destructive: false,
    },
    reactivate: {
      title: 'Reactivate account?',
      description: `${fullName(confirm.user)} will be able to sign in again.`,
      label: 'Reactivate',
      destructive: false,
    },
  }[confirm.kind];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div data-tour="us-header">
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground">Create, edit and manage every account in the system.</p>
        </div>
        <Button data-tour="us-add" onClick={() => setForm({ mode: 'create' })}>
          <UserPlus className="w-4 h-4 mr-2" /> Add user
        </Button>
      </div>

      <div data-tour="us-filters" className="flex flex-col sm:flex-row gap-2">
        <Input
          className="bg-card sm:max-w-xs"
          placeholder="Search name, email or ID…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select className={selectClass} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
          <option value="">All roles</option>
          <option value="admin">Administrators</option>
          <option value="teacher">Teachers</option>
          <option value="student">Students</option>
        </select>
        <select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">Active & inactive</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div data-tour="us-table" className="rounded-xl border border-input bg-card overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading accounts…</div>
        ) : isError ? (
          <div className="p-8 text-center text-muted-foreground space-y-3">
            <p>Couldn’t load accounts.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No accounts match your filters.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Role</TableHead>
                <TableHead className="w-40">ID number</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u, i) => {
                const isSelf = u.id === me?.id;
                const name = fullName(u);
                return (
                  <TableRow key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                    <TableCell>
                      <div className="font-medium">
                        {name}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </div>
                      <div className="text-sm text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE[u.role]} className="capitalize">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {u.student_id ?? u.employee_id ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? 'success' : 'warning'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell data-tour={i === 0 ? 'us-actions' : undefined} className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${name}`}
                        title="Edit"
                        onClick={() =>
                          setForm({
                            mode: 'edit',
                            user: {
                              id: u.id,
                              email: u.email,
                              role: u.role,
                              first_name: u.first_name ?? '',
                              last_name: u.last_name ?? '',
                              phone: u.phone,
                              student_id: u.student_id,
                              employee_id: u.employee_id,
                            },
                          })
                        }
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Reset password for ${name}`} title="Reset password" onClick={() => setResetTarget(u)}>
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      {u.is_active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Deactivate ${name}`}
                          title={isSelf ? 'You can’t deactivate yourself' : 'Deactivate'}
                          disabled={isSelf}
                          onClick={() => setConfirm({ kind: 'deactivate', user: u })}
                        >
                          <UserX className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" aria-label={`Reactivate ${name}`} title="Reactivate" onClick={() => setConfirm({ kind: 'reactivate', user: u })}>
                          <UserCheck className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${name}`}
                        title={isSelf ? 'You can’t delete yourself' : 'Delete permanently'}
                        disabled={isSelf}
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(u)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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
        allowedRoles={['student', 'teacher', 'admin']}
        user={form?.user}
        onSaved={() => {
          refreshEverywhere();
          if (form?.mode === 'edit') toast({ title: 'Account updated', variant: 'success' });
        }}
      />

      <ResetPasswordDialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        target={resetTarget && { id: resetTarget.id, email: resetTarget.email, name: fullName(resetTarget) }}
      />

      {confirmCopy && (
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={confirmCopy.title}
          description={confirmCopy.description}
          confirmLabel={confirmCopy.label}
          destructive={confirmCopy.destructive}
          onConfirm={runConfirmed}
        />
      )}

      <DeleteUserDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        target={deleteTarget && { id: deleteTarget.id, name: fullName(deleteTarget), email: deleteTarget.email }}
        onDeleted={() => {
          if (deleteTarget) {
            toast({ title: 'Account deleted', description: fullName(deleteTarget), variant: 'success' });
          }
          refreshEverywhere();
        }}
      />
    </div>
  );
}
