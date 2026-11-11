import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import useAuth from '@/hooks/useAuth.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';

/** Change your password. Every session ends afterwards (this one too), so you sign in again. */
export function PasswordSection() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('The new password must be at least 8 characters.');
    if (next !== confirm) return setError('The new password and its confirmation don’t match.');
    if (next === current) return setError('Choose a password that is different from your current one.');

    setBusy(true);
    try {
      await api.put('/auth/me/password', { current_password: current, new_password: next });
      toast({ title: 'Password changed', description: 'Please sign in again with your new password.', variant: 'success' });
      logout();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card data-tour="st-password">
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Use at least 8 characters. For your safety, changing it signs you out everywhere.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pw-new">New password</Label>
              <Input id="pw-new" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input id="pw-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={busy || !current || !next || !confirm}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
