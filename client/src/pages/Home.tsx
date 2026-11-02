import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '@/hooks/useAuth.ts';
import { Button } from '@/components/ui/button.tsx';
import {
  GraduationCap,
  Users,
  BookOpen,
  Shield,
} from 'lucide-react';

const roleCards = [
  {
    title: 'Administrator',
    icon: Shield,
    description:
      'Manage students, courses, teachers, and school-wide settings from one dashboard.',
  },
  {
    title: 'Teacher',
    icon: BookOpen,
    description:
      'Create courses, post assignments, track attendance, and record grades.',
  },
  {
    title: 'Student',
    icon: Users,
    description:
      'Enroll in courses, view assignments, check grades, and manage your timetable.',
  },
];

export default function Home() {
  const [searchParams] = useSearchParams();
  const forceLoading = searchParams.get('loading') === 'true';
  const { user, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  // Hooks must be called in the same order on every render, before any early returns.
  useEffect(() => {
    if (isAuthenticated && user) {
      navigate('/dashboard');
    }
  }, [user, isAuthenticated, navigate]);
  if (forceLoading || isLoading) {
    return (
      <div className="min-h-screen w-full bg-site-bg flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-primary/10 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-site-text">PBSI is waking up</h2>
          <p className="text-site-muted text-sm">
            Our school management system is starting up. <br /> Please wait a moment…
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full bg-site-bg px-4 py-10">
        <div className="max-w-[1200px] mx-auto">
          {/* Hero section */}
          <section className="relative text-center pt-24 pb-16 md:pt-32 md:pb-24">
            <div className="inline-flex items-center gap-2 bg-primary/10 px-6 py-2.5 rounded-2xl border border-primary/10 text-primary font-bold text-xs uppercase tracking-widest mb-10 inline-block">
              <GraduationCap className="w-4 h-4" />
              <span>PBSI School Portal</span>
            </div>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-site-text leading-[0.95] tracking-tighter mb-8">
              Presbyterian Bible <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0033A0] to-[#407BFF] dark:from-[#3B82F6] dark:to-[#407BFF] pr-[0.1em] selection:bg-primary/30">
                Seminary Inc.
              </span>
            </h1>
            <p className="text-xl text-site-muted max-w-2xl mx-auto leading-relaxed mb-12 font-medium">
              The school management system for students, teachers, and
              administrators in PBSI.
            </p>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row justify-center items-center gap-5">
              <Button
                onClick={() => {
                  window.location.href = 'https://pbsi1992.github.io';
                }}
                className="w-full sm:w-auto !h-auto !bg-site-card/60 backdrop-blur-sm !text-site-text !border-2 !border-site-border !px-12 !py-4 rounded-2xl font-bold text-xl transition-all duration-300 hover:-translate-y-1 hover:bg-site-card hover:border-primary/20 hover:shadow-xl hover:shadow-primary/10 active:scale-95"
              >
                Website
              </Button>

              <Button
                onClick={() => navigate('/login')}
                className="w-full sm:w-auto !h-auto !bg-primary !text-primary-foreground !px-12 !py-4 rounded-2xl font-bold text-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/40 active:scale-95"
              >
                Sign in
              </Button>
            </div>
          </section>

          {/* Role cards */}
          <section className="mt-24 md:mt-32">
            <div className="text-center mb-16">
              <h3 className="text-3xl md:text-5xl font-extrabold text-site-text leading-tight">
                Built for every role in PBSI
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 mb-16">
              {roleCards.map((role) => (
                <div
                  key={role.title}
                  className="bg-site-card border border-site-border rounded-[32px] p-8 md:p-10 overflow-hidden group transition-all duration-300 hover:border-primary/20 flex flex-col h-full"
                >
                  <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center shrink-0 mb-6 group-hover:scale-110 transition-transform duration-500">
                    <role.icon className="w-7 h-7" />
                  </div>
                  <h4 className="text-xl md:text-2xl font-bold text-site-text mb-3 leading-tight">
                    {role.title}
                  </h4>
                  <p className="text-site-muted text-base leading-relaxed font-medium flex-grow">
                    {role.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return null;
}
