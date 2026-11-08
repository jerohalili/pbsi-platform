import { useQuery } from 'react-query';
import api from '@/lib/api.ts';
import type { TeacherDashboardData } from '@/lib/teacherDashboard.ts';

/**
 * The teacher dashboard's data. Refreshed every minute while the tab is visible (a hidden tab does
 * not poll) and again when the tab regains focus. The previous data stays on screen while a
 * refresh runs or fails, so the page never flashes empty.
 */
export default function useTeacherDashboard(userId: string | undefined) {
  return useQuery<TeacherDashboardData>(
    ['dashboard', 'teacher', userId ?? ''],
    async () => (await api.get<TeacherDashboardData>('/dashboard/teacher')).data,
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
