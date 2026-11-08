import { useQuery } from 'react-query';
import api from '@/lib/api.ts';
import type { AdminDashboardData } from '@/lib/adminDashboard.ts';

/**
 * The admin dashboard's data. Refreshed every minute while the tab is visible (a hidden tab does
 * not poll) and again when the tab regains focus. The previous data stays on screen while a
 * refresh runs or fails, so the page never flashes empty.
 */
export default function useAdminDashboard(userId: string | undefined) {
  return useQuery<AdminDashboardData>(
    ['dashboard', 'admin', userId ?? ''],
    async () => (await api.get<AdminDashboardData>('/dashboard/admin')).data,
    {
      enabled: Boolean(userId),
      retry: 1,
      staleTime: 15_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnMount: 'always',
    },
  );
}
