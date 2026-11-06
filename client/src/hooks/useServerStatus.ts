import { useSyncExternalStore } from 'react';
import { getServerState, subscribeServerState, type ServerState } from '@/lib/serverStatus.ts';

/** Whether the server is reachable right now ("ok"), starting up ("waking") or the device is "offline". */
export function useServerStatus(): ServerState {
  return useSyncExternalStore(subscribeServerState, getServerState, getServerState);
}
