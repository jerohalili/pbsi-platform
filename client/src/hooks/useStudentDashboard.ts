import { useQuery } from 'react-query';
import api from '@/lib/api.ts';
import type { StudentDashboardData } from '@/lib/studentDashboard.ts';

/**
 * The student dashboard's data. Refreshed every minute while the tab is visible (a hidden tab does
 * not poll), and again when the tab regains focus. The previous data stays on screen while a
 * refresh runs or fails, so the page never flashes empty.
 */
export default function useStudentDashboard(userId: string | undefined) {
  return useQuery<StudentDashboardData>(
    ['dashboard', 'student', userId ?? ''],
    async () => (await api.get<StudentDashboardData>('/dashboard/student')).data,
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
