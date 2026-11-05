import { MapPin, Timer, CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { formatDateTime } from '@/lib/utils.ts';

/** Marks an item that is announced here but done face to face. */
export function InPersonBadge() {
  return <Badge variant="outline">In person</Badge>;
}

/** The student-facing state of an in-person item. */
export function ManualStatusBadge({ status }: { status: string | null }) {
  if (status === 'scored') return <Badge variant="success">Scored</Badge>;
  if (status === 'awaiting_score') return <Badge variant="warning">Awaiting score</Badge>;
  if (status === 'upcoming') return <Badge variant="outline">Upcoming</Badge>;
  return null;
}

/** "18 / 20" */
export const formatScore = (score: number | null, max: number): string =>
  score === null ? '—' : `${score} / ${max}`;

interface InPersonInfoProps {
  /** e.g. "Takes place", "Exam date". */
  whenLabel: string;
  when: string | null;
  room?: string | null;
  durationMinutes?: number | null;
  maxScore: number;
  details?: string | null;
}

/** When, where and what: the announcement itself. */
export function InPersonInfo({ whenLabel, when, room, durationMinutes, maxScore, details }: InPersonInfoProps) {
  return (
    <Card className="p-5 space-y-4">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div className="flex items-start gap-3">
          <CalendarClock className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <dt className="text-muted-foreground">{whenLabel}</dt>
            <dd className="font-medium">{when ? formatDateTime(when) : '—'}</dd>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <dt className="text-muted-foreground">Room</dt>
            <dd className="font-medium">{room || 'To be announced'}</dd>
          </div>
        </div>
        {durationMinutes ? (
          <div className="flex items-start gap-3">
            <Timer className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-medium">{durationMinutes} minutes</dd>
            </div>
          </div>
        ) : null}
        <div className="text-sm">
          <dt className="text-muted-foreground">Maximum score</dt>
          <dd className="font-medium">{maxScore} points</dd>
        </div>
      </dl>
      {details && <p className="text-sm whitespace-pre-wrap break-words border-t border-input pt-4">{details}</p>}
    </Card>
  );
}

interface MyScoreCardProps {
  status: string | null;
  score: number | null;
  max: number;
  percent?: number | null;
  feedback: string | null;
  gradedAt: string | null;
}

/** A student's own score on an in-person item. */
export function MyScoreCard({ status, score, max, percent, feedback, gradedAt }: MyScoreCardProps) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <ManualStatusBadge status={status} />
        {gradedAt && score !== null && (
          <span className="text-xs text-muted-foreground">Posted {formatDateTime(gradedAt)}</span>
        )}
      </div>
      {score !== null ? (
        <>
          <p className="text-3xl font-bold">
            {score} <span className="text-lg font-medium text-muted-foreground">/ {max}</span>
            {percent !== null && percent !== undefined && (
              <span className="ml-3 text-lg font-medium text-muted-foreground">{percent}%</span>
            )}
          </p>
          {feedback && (
            <div className="rounded-md border border-input p-3 text-sm whitespace-pre-wrap break-words">
              <p className="text-xs font-medium text-muted-foreground mb-1">Teacher’s comment</p>
              {feedback}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === 'awaiting_score'
            ? 'This has taken place. Your teacher has not posted your score yet.'
            : 'This is done in person. Your score will appear here after your teacher checks it.'}
        </p>
      )}
    </Card>
  );
}
