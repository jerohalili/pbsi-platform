import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from 'react-query';
import { useServerStatus } from '@/hooks/useServerStatus.ts';
import { retryNow, type ServerStatus } from '@/lib/serverStatus.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { WakingScreen } from '@/components/common/WakingScreen.tsx';

/**
 * Mounted once for the whole app. When the server cannot answer (asleep, starting up, or the device
 * is offline) it covers the current page with the "waking up" screen; the page underneath is left
 * exactly as it was, so nothing the person was doing is lost. When the server answers again the
 * screen goes away and everything that failed or was waiting is loaded again by itself.
 */
export function ServerStatusOverlay() {
  const { status, since } = useServerStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const previous = useRef<ServerStatus>('ok');
  const [now, setNow] = useState(() => Date.now());

  // Seconds since it began.
  useEffect(() => {
    if (status === 'ok') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (previous.current !== 'ok' && status === 'ok') {
      void queryClient.invalidateQueries();
      toast({ title: 'Connected', description: 'The server is awake again.', variant: 'success' });
    }
    previous.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, queryClient]);

  if (status === 'ok') return null;

  const elapsed = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return <WakingScreen overlay variant={status} elapsedSeconds={elapsed} onRetry={retryNow} />;
}
