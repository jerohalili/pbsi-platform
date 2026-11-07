import React from 'react';
import {
  Routes,
  Route,
  Outlet,
  Navigate,
  useLocation,
} from 'react-router-dom';
import useAuth from '@/hooks/useAuth.ts';
import {
  AdminLayout,
  TeacherLayout,
  StudentLayout,
  SidebarProvider,
} from '@/components/layout/Sidebar.tsx';
import Dashboard from '@/pages/Dashboard.tsx';
import Login from '@/pages/Login.tsx';
import Home from '@/pages/Home.tsx';
import NotFound from '@/pages/NotFound.tsx';
import Users from '@/pages/Users.tsx';
import Students from '@/pages/Students.tsx';
import StudentDetail from '@/pages/StudentDetail.tsx';
import Courses from '@/pages/Courses.tsx';
import CourseDetail from '@/pages/CourseDetail.tsx';
import ModuleEdit from '@/pages/ModuleEdit.tsx';
import Coursework from '@/pages/Coursework.tsx';
import ExamDetail from '@/pages/ExamDetail.tsx';
import AssignmentDetail from '@/pages/AssignmentDetail.tsx';
import QuizDetail from '@/pages/QuizDetail.tsx';
import QuizTake from '@/pages/QuizTake.tsx';
import QuizResult from '@/pages/QuizResult.tsx';
import Attendance from '@/pages/Attendance.tsx';
import Timetable from '@/pages/Timetable.tsx';
import Grades from '@/pages/Grades.tsx';
import Discussions from '@/pages/Discussions.tsx';
import DiscussionThread from '@/pages/DiscussionThread.tsx';
import Notifications from '@/pages/Notifications.tsx';
import AuditLogs from '@/pages/AuditLogs.tsx';
import Settings from '@/pages/Settings.tsx';
import Announcements from '@/pages/Announcements.tsx';

type Role = 'admin' | 'teacher' | 'student';

const LayoutByRole: Record<Role, React.ComponentType<{ children: React.ReactNode }>> = {
  admin: AdminLayout,
  teacher: TeacherLayout,
  student: StudentLayout,
};

function RoleLayout({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth();
  const Layout =
    user && LayoutByRole[user.role as Role] ? LayoutByRole[user.role as Role] : StudentLayout;
  return <Layout>{children ?? <Outlet />}</Layout>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (!user || !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

const App = () => {
  return (
    <SidebarProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route element={<RoleLayout />}>
          <Route path="dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="announcements" element={<ProtectedRoute><Announcements /></ProtectedRoute>} />
          <Route path="users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
          <Route path="students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
          <Route path="students/:id" element={<ProtectedRoute><StudentDetail /></ProtectedRoute>} />
          <Route path="courses" element={<ProtectedRoute><Courses /></ProtectedRoute>} />
          <Route path="courses/:id" element={<ProtectedRoute><CourseDetail /></ProtectedRoute>} />
          <Route path="courses/:courseId/modules/:moduleId/edit" element={<ProtectedRoute><ModuleEdit /></ProtectedRoute>} />
          <Route path="coursework" element={<ProtectedRoute><Coursework /></ProtectedRoute>} />
          {/* The three lists became one page; old links and bookmarks still arrive in the right tab. */}
          <Route path="assignments" element={<Navigate to="/coursework?type=assignment" replace />} />
          <Route path="quizzes" element={<Navigate to="/coursework?type=quiz" replace />} />
          <Route path="exams" element={<Navigate to="/coursework?type=exam" replace />} />
          <Route path="exams/:id" element={<ProtectedRoute><ExamDetail /></ProtectedRoute>} />
          <Route path="assignments/:id" element={<ProtectedRoute><AssignmentDetail /></ProtectedRoute>} />
          <Route path="quizzes/:id" element={<ProtectedRoute><QuizDetail /></ProtectedRoute>} />
          <Route path="quizzes/:id/take" element={<ProtectedRoute><QuizTake /></ProtectedRoute>} />
          <Route path="quiz-results/:attemptId" element={<ProtectedRoute><QuizResult /></ProtectedRoute>} />
          <Route path="attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
          <Route path="timetable" element={<ProtectedRoute><Timetable /></ProtectedRoute>} />
          <Route path="grades" element={<ProtectedRoute><Grades /></ProtectedRoute>} />
          <Route path="discussions" element={<ProtectedRoute><Discussions /></ProtectedRoute>} />
          <Route path="discussions/:id" element={<ProtectedRoute><DiscussionThread /></ProtectedRoute>} />
          <Route path="notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="audit-logs" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SidebarProvider>
  );
};

export default App;
