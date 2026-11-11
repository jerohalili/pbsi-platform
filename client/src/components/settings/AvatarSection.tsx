import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { UserAvatar } from '@/components/common/UserAvatar.tsx';
import { FilePicker } from '@/components/common/FilePicker.tsx';
import useAuth from '@/hooks/useAuth.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { FILE_RULES, checkFile, sendFile } from '@/lib/upload.ts';

/** Change or remove your own profile picture. */
export function AvatarSection() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Preview the chosen picture before anything is uploaded; release the blob when it changes.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const name = `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim();

  const choose = (next: File | null) => {
    setError('');
    if (next) {
      const problem = checkFile(next, FILE_RULES.avatar);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setFile(next);
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await sendFile('put', '/auth/me/avatar', file, {}, setProgress);
      await refreshUser();
      setFile(null);
      setProgress(0);
      toast({ title: 'Profile picture updated', variant: 'success' });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api.delete('/auth/me/avatar');
      await refreshUser();
      toast({ title: 'Profile picture removed', variant: 'success' });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-tour="st-avatar">
      <CardHeader>
        <CardTitle>Profile picture</CardTitle>
        <CardDescription>Shown next to your name. Square pictures work best.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <UserAvatar src={preview ?? user?.avatar_url} name={name} fallback={user?.email} className="h-28 w-28 text-3xl" />
        <div className="min-w-0 flex-1 space-y-3">
          <FilePicker label="Choose a picture" rule={FILE_RULES.avatar} file={file} onChange={choose} disabled={busy} />
          {busy && file && <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={busy || !file}>
              {busy && file ? 'Uploading…' : 'Save picture'}
            </Button>
            {user?.avatar_url && !file && (
              <Button type="button" variant="outline" onClick={remove} disabled={busy}>
                Remove picture
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
