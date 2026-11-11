import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import useAuth from '@/hooks/useAuth.ts';
import type { AuthUser } from '@/contexts/AuthContext.tsx';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';

interface Form {
  first_name: string;
  last_name: string;
  phone: string;
  date_of_birth: string;
  address: string;
}

const fromUser = (user: AuthUser | null): Form => ({
  first_name: user?.first_name ?? '',
  last_name: user?.last_name ?? '',
  phone: user?.phone ?? '',
  date_of_birth: user?.date_of_birth ? user.date_of_birth.slice(0, 10) : '',
  address: user?.address ?? '',
});

/** Your name and contact details. Email and role identify the account, so an administrator manages those. */
export function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => fromUser(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Start over from the saved values whenever they change (for example right after saving).
  useEffect(() => setForm(fromUser(user)), [user]);

  const saved = fromUser(user);
  const dirty = (Object.keys(form) as (keyof Form)[]).some((key) => form[key] !== saved[key]);
  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First and last name are required.');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/auth/me', form);
      await refreshUser();
      toast({ title: 'Profile updated', variant: 'success' });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-tour="st-profile">
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Personal details
            {user && <Badge variant="secondary" className="capitalize">{user.role}</Badge>}
          </CardTitle>
          <CardDescription>This is how your name appears across the school platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="st-first">First name</Label>
              <Input id="st-first" value={form.first_name} maxLength={100} required onChange={(e) => set('first_name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-last">Last name</Label>
              <Input id="st-last" value={form.last_name} maxLength={100} required onChange={(e) => set('last_name', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="st-email">Email</Label>
            <Input id="st-email" type="email" value={user?.email ?? ''} disabled readOnly />
            <p className="text-xs text-muted-foreground">You sign in with this address. Ask an administrator if it needs to change.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="st-phone">Phone</Label>
              <Input id="st-phone" type="tel" value={form.phone} maxLength={30} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-dob">Date of birth</Label>
              <Input id="st-dob" type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="st-address">Address</Label>
            <Textarea id="st-address" rows={2} value={form.address} maxLength={300} onChange={(e) => set('address', e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</Button>
          {dirty && !busy && (
            <Button type="button" variant="ghost" onClick={() => { setForm(saved); setError(''); }}>
              Discard
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
