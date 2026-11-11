import { useParams } from 'react-router-dom';
import { useGet } from '@/hooks/useApi.ts';
import { formatAverage } from '@/lib/utils.ts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { UserAvatar } from '@/components/common/UserAvatar.tsx';
import { Phone, MapPin, Calendar, GraduationCap } from 'lucide-react';

interface Student {
  id: string;
  student_id: string;
  enrollment_date: string | null;
  average_grade: number | string | null;
  subjects_assigned: string[] | null;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address: string | null;
  avatar_url: string | null;
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <div className="p-8 text-center">Invalid student.</div>;

  const { data, isLoading } = useGet<{ student: Student }>(
    ['student', id],
    `/students/${id}`,
  );

  const s = data?.student;
  if (isLoading) return <div className="p-8 text-center">Loading student...</div>;
  if (!s) return <div className="p-8 text-center">Student not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div data-tour="sd-header">
          <h1 className="text-2xl font-bold">Student Profile</h1>
          <p className="text-muted-foreground">{s.student_id}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card data-tour="sd-profile">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <UserAvatar
                  src={s.avatar_url}
                  name={`${s.first_name} ${s.last_name}`}
                  className="h-10 w-10 text-sm"
                />
                <div>
                  <div className="font-semibold">{s.first_name} {s.last_name}</div>
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </div>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Enrolled {new Date(s.enrollment_date || 0).toLocaleDateString()}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center gap-3 p-3 rounded-lg border border-input">
                  <Phone className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Phone</div>
                    <div className="text-sm">{s.phone ?? '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-input">
                  <MapPin className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Address</div>
                    <div className="text-sm">{s.address ?? '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-input">
                  <Calendar className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Date of Birth</div>
                    <div className="text-sm">{s.date_of_birth ?? '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg border border-input">
                  <div className="w-5 h-5 text-muted-foreground shrink-0">{s.gender ? s.gender.charAt(0) : '—'}</div>
                  <div>
                    <div className="text-xs text-muted-foreground">Gender</div>
                    <div className="text-sm">{s.gender ?? '—'}</div>
                  </div>
                </div>
              </div>
              <div data-tour="sd-subjects">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Subjects Assigned
                </div>
                <div className="flex flex-wrap gap-2">
                  {(s.subjects_assigned ?? []).map((subj, i) => (
                    <Badge key={i} variant="outline">{subj}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="col-span-1 md:col-span-2 lg:col-span-1">
          <Card data-tour="sd-average">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="w-5 h-5" /> Average grade
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <div className="text-5xl font-bold">
                {formatAverage(s.average_grade)}
              </div>
              <p className="text-muted-foreground text-sm mt-2">
                Average of all graded assignments and quizzes.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


