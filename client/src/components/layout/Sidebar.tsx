import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth.ts';
import useUnreadNotifications from '@/hooks/useUnreadNotifications.ts';
import { UserAvatar } from '@/components/common/UserAvatar.tsx';
import { AnnouncementBanner } from '@/components/announcements/AnnouncementBanner.tsx';
import WalkthroughButton from '@/components/walkthrough/WalkthroughButton.tsx';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet.tsx';
import {
  LayoutDashboard,
  Users,
  UserCog,
  Calendar,
  ClipboardList,
  CalendarDays,
  MessageCircle,
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  X,
  ShieldAlert,
  BookOpen,
  Award,
  Settings,
  Megaphone,
} from 'lucide-react';

const SidebarCollapsedContext = createContext<{
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
} | undefined>(undefined);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarCollapsedContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarCollapsedContext.Provider>
  );
}

export function useSidebarCollapsed() {
  const ctx = useContext(SidebarCollapsedContext);
  if (ctx === undefined) {
    throw new Error('useSidebarCollapsed must be used within SidebarProvider');
  }
  return ctx;
}

const navItems: Array<{
  label: string;
  href: string;
  icon: React.ReactNode;
  roles: ('admin' | 'teacher' | 'student')[];
  also?: string[];
}> = [
  { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard size={18} />, roles: ['admin', 'teacher', 'student'] },
  { label: 'Announcements', href: '/announcements', icon: <Megaphone size={18} />, roles: ['admin', 'teacher'] },
  { label: 'Users', href: '/users', icon: <UserCog size={18} />, roles: ['admin'] },
  { label: 'Students', href: '/students', icon: <Users size={18} />, roles: ['admin', 'teacher'] },
  { label: 'Courses', href: '/courses', icon: <BookOpen size={18} />, roles: ['admin', 'teacher', 'student'] },
  {
    label: 'Coursework',
    href: '/coursework',
    icon: <ClipboardList size={18} />,
    roles: ['admin', 'teacher', 'student'],
    // Assignments, quizzes and exams are pages of the same section, so it stays highlighted on them.
    also: ['/assignments', '/quizzes', '/exams', '/quiz-results'],
  },
  { label: 'Attendance', href: '/attendance', icon: <Calendar size={18} />, roles: ['admin', 'teacher', 'student'] },
  { label: 'Timetable', href: '/timetable', icon: <CalendarDays size={18} />, roles: ['admin', 'teacher', 'student'] },
  { label: 'Grades', href: '/grades', icon: <Award size={18} />, roles: ['admin', 'teacher', 'student'] },
  { label: 'Discussions', href: '/discussions', icon: <MessageCircle size={18} />, roles: ['admin', 'teacher', 'student'] },
  { label: 'Notifications', href: '/notifications', icon: <Bell size={18} />, roles: ['admin', 'teacher', 'student'] },
  { label: 'Settings', href: '/settings', icon: <Settings size={18} />, roles: ['admin', 'teacher', 'student'] },
  { label: 'Audit Logs', href: '/audit-logs', icon: <ShieldAlert size={18} />, roles: ['admin'] },
];

/** Active on its own page, and on the pages that belong to it (an item's detail page). */
function isActiveItem(item: { href: string; also?: string[] }, pathname: string): boolean {
  if (pathname === item.href) return true;
  return (item.also ?? []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}


export function Sidebar() {
  const { user, logout } = useAuth();
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useUnreadNotifications(Boolean(user));

  const items = navItems.filter((i) => i.roles.includes(user?.role as any));

  const handleLogout = () => {
    logout();
  };

  return (
    <aside
      className={`hidden md:block fixed left-0 top-0 h-full border-r border-input bg-background z-20 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-16 items-center justify-between border-b border-input px-4">
        {!collapsed && (
          <>
            <span className="font-bold text-lg tracking-tight">PBSI</span>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="ml-auto p-1 hover:bg-accent rounded-md"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </>
        )}
        {collapsed && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 hover:bg-accent rounded-md"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav data-tour="sidebar-nav" className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive = isActiveItem(item, location.pathname);
          const badge = item.href === '/notifications' ? unread : 0;
          return (
            <button
              key={item.href}
              data-tour={`nav-${item.href.slice(1)}`}
              onClick={() => navigate(item.href)}
              aria-label={badge > 0 ? `${item.label}, ${badge} unread` : item.label}
              className={`relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-accent'
              } ${collapsed ? 'px-1' : ''}`}
              aria-pressed={isActive}
            >
              <span className={collapsed ? 'w-6' : 'w-5 h-5'}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
              {badge > 0 && (
                <span
                  className={
                    collapsed
                      ? 'absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-destructive'
                      : 'ml-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-xs font-semibold leading-none text-destructive-foreground'
                  }
                >
                  {!collapsed && (badge > 99 ? '99+' : badge)}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-input">
        <div data-tour="sidebar-profile" className="flex items-center gap-3 p-2">
          <AvatarBadge />
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">
                {user?.first_name} {user?.last_name}
              </span>
              <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
              <span className="text-xs text-muted-foreground truncate capitalize">
                {user?.role}
              </span>
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

export function TopNav() {
  const { user } = useAuth();

  return (
    <>
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-input bg-background/95 backdrop-blur px-4">
        <div className="flex items-center gap-3 md:gap-4">
          <MobileNav />
          <span className="font-bold text-lg tracking-tight md:hidden">PBSI</span>
          <span className="hidden sm:block text-sm text-muted-foreground">
            {(user?.role ?? '').charAt(0).toUpperCase() + (user?.role ?? '').slice(1)} Portal
          </span>
        </div>
        <div className="flex items-center gap-1">
          <WalkthroughButton />
        </div>
      </header>
      <AnnouncementBanner />
    </>
  );
}

/** Phone navigation: a slide-in drawer opened from the top bar (the fixed sidebar is desktop-only). */
export function MobileNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useUnreadNotifications(Boolean(user));
  const [open, setOpen] = useState(false);

  const items = navItems.filter((i) => i.roles.includes(user?.role as any));

  // Close after any navigation (including the browser Back button).
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Close if the screen grows past the phone breakpoint (e.g. rotating a tablet).
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const go = (href: string) => {
    navigate(href);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          data-tour="mobile-menu"
          aria-label={unread > 0 ? `Open menu, ${unread} unread notifications` : 'Open menu'}
          className="relative -ml-2 flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent md:hidden"
        >
          <Menu className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-destructive" />}
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        aria-describedby={undefined}
        className="flex w-72 max-w-[85vw] flex-col gap-0 rounded-none p-0 sm:max-w-[85vw] sm:rounded-none"
      >
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-input px-4">
          <span className="font-bold text-lg tracking-tight">PBSI</span>
          <SheetClose asChild>
            <button type="button" aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent -mr-2">
              <X className="h-5 w-5" />
            </button>
          </SheetClose>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            const isActive = isActiveItem(item, location.pathname);
            const badge = item.href === '/notifications' ? unread : 0;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => go(item.href)}
                aria-label={badge > 0 ? `${item.label}, ${badge} unread` : item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
                }`}
              >
                <span className="h-5 w-5">{item.icon}</span>
                <span>{item.label}</span>
                {badge > 0 && (
                  <span className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-xs font-semibold leading-none text-destructive-foreground">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-input p-3">
          <div className="flex items-center gap-3 p-2">
            <UserAvatar
              src={user?.avatar_url}
              name={`${user?.first_name ?? ''} ${user?.last_name ?? ''}`}
              fallback={user?.email}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {user?.first_name} {user?.last_name}
              </span>
              <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              <span className="truncate text-xs capitalize text-muted-foreground">{user?.role}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AvatarBadge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/settings')}
      aria-label="Open settings"
      title="Settings"
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <UserAvatar
        src={user?.avatar_url}
        name={`${user?.first_name ?? ''} ${user?.last_name ?? ''}`}
        fallback={user?.email}
      />
    </button>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarCollapsed();
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className={`transition-all duration-300 ${
          collapsed ? 'md:pl-16' : 'md:pl-64'
        }`}
      >
        <TopNav />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function TeacherLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarCollapsed();
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className={`transition-all duration-300 ${
          collapsed ? 'md:pl-16' : 'md:pl-64'
        }`}
      >
        <TopNav />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function StudentLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarCollapsed();
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className={`transition-all duration-300 ${
          collapsed ? 'md:pl-16' : 'md:pl-64'
        }`}
      >
        <TopNav />
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}


