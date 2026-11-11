import useAuth from '@/hooks/useAuth.ts';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, X } from 'lucide-react';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';

type Values = Record<string, unknown> | null;

interface AuditLog {
  id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: Values;
  new_values: Values;
  ip_address: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  actor_email: string;
}

interface AuditLogsResponse {
  audit_logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
  actions: string[];
  entity_types: string[];
}

interface Filters {
  action: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { action: '', entityType: '', entityId: '', from: '', to: '' };
const PAGE_SIZE = 25;

// White controls, so they stand out from the card behind them.
const CONTROL =
  'h-9 rounded-md border border-site-border bg-white px-3 text-sm text-site-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** "grade.override" -> "Grade override". */
function humanize(value: string): string {
  const text = value.replace(/[._]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function actorName(log: AuditLog): string {
  const name = `${log.first_name ?? ''} ${log.last_name ?? ''}`.trim();
  return name || log.actor_email;
}

/** What changed: before and after side by side, or just the recorded details for a creation. */
function Changes({ log }: { log: AuditLog }) {
  const oldValues = log.old_values ?? {};
  const newValues = log.new_values ?? {};
  const keys = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])];

  if (keys.length === 0) {
    return <p className="text-sm text-site-muted">No further details were recorded for this action.</p>;
  }

  const hasBefore = log.old_values !== null;
  const hasAfter = log.new_values !== null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-site-muted">
            <th className="py-1 pr-6 font-semibold">Field</th>
            {hasBefore && <th className="py-1 pr-6 font-semibold">Before</th>}
            {hasAfter && <th className="py-1 font-semibold">{hasBefore ? 'After' : 'Details'}</th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-t border-site-border/60 align-top">
              <td className="py-1.5 pr-6 font-mono text-xs text-site-muted">{key}</td>
              {hasBefore && <td className="py-1.5 pr-6 break-all text-site-text">{formatValue(oldValues[key])}</td>}
              {hasAfter && <td className="py-1.5 break-all text-site-text">{formatValue(newValues[key])}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditLogsPage() {
  const { isAuthenticated, isLoading } = useAuth();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [actions, setActions] = useState<string[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // Ignores the answer of a request that was overtaken by a newer one.
  const requestId = useRef(0);

  const load = useCallback(async (nextPage: number, nextFilters: Filters) => {
    const id = ++requestId.current;
    setStatus('loading');
    try {
      const res = await api.get<AuditLogsResponse>('/audit-logs', {
        params: {
          page: nextPage,
          limit: PAGE_SIZE,
          action: nextFilters.action || undefined,
          entity_type: nextFilters.entityType || undefined,
          entity_id: nextFilters.entityId || undefined,
          from: nextFilters.from || undefined,
          to: nextFilters.to || undefined,
        },
      });
      if (id !== requestId.current) return;
      setLogs(res.data.audit_logs);
      setTotal(res.data.total);
      setActions(res.data.actions);
      setEntityTypes(res.data.entity_types);
      setExpanded(null);
      setStatus('ready');
    } catch (err) {
      if (id !== requestId.current) return;
      setErrorMessage(getErrorMessage(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void load(page, filters);
  }, [isAuthenticated, page, filters, load]);

  function changeFilter(patch: Partial<Filters>) {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-site-bg flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-2 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-site-border"></div>
          <p className="text-site-muted text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="w-full bg-site-bg px-0 py-6 md:min-h-screen md:px-4 md:py-12">
      <div className="max-w-5xl mx-auto">
        <div data-tour="al-header" className="flex items-center gap-2 mb-4">
          <ShieldAlert className="w-5 h-5 text-site-muted" />
          <h1 className="text-2xl font-bold text-site-text">Audit Logs</h1>
        </div>
        <p className="text-site-muted mb-6">
          A permanent record of sensitive actions: who did what, to which record, and what changed.
          Times are shown in Philippine time.
        </p>

        <div data-tour="al-filters" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-site-muted">
            Action
            <select
              className={CONTROL}
              value={filters.action}
              onChange={(e) => changeFilter({ action: e.target.value })}
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {humanize(a)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-site-muted">
            Record type
            <select
              className={CONTROL}
              value={filters.entityType}
              onChange={(e) => changeFilter({ entityType: e.target.value })}
            >
              <option value="">All records</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-site-muted">
            From
            <input
              type="date"
              className={CONTROL}
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => changeFilter({ from: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-site-muted">
            To
            <input
              type="date"
              className={CONTROL}
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => changeFilter({ to: e.target.value })}
            />
          </label>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => changeFilter({ ...EMPTY_FILTERS })}>
              <X className="mr-1 h-4 w-4" />
              Clear filters
            </Button>
          )}
        </div>

        {filters.entityId && (
          <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-site-muted">
            Showing only the history of one record
            <code className="rounded bg-white px-1.5 py-0.5 text-xs text-site-text">{filters.entityId}</code>
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => changeFilter({ entityId: '' })}
            >
              Show all records
            </button>
          </p>
        )}

        {status === 'error' ? (
          <div className="rounded-xl border border-site-border bg-site-card px-6 py-12 text-center">
            <p className="font-medium text-site-text">We couldn’t load the audit logs.</p>
            <p className="mb-4 text-sm text-site-muted">{errorMessage}</p>
            <Button variant="outline" onClick={() => load(page, filters)}>
              Try again
            </Button>
          </div>
        ) : (
          <div data-tour="al-table" className="rounded-xl border border-site-border bg-site-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-site-border">
                    <th className="w-10 px-3 py-4" aria-label="Details"></th>
                    <th className="px-4 py-4 text-sm font-bold text-site-muted">Time</th>
                    <th className="px-4 py-4 text-sm font-bold text-site-muted">Actor</th>
                    <th className="px-4 py-4 text-sm font-bold text-site-muted">Action</th>
                    <th className="px-4 py-4 text-sm font-bold text-site-muted">Record</th>
                    <th className="px-4 py-4 text-sm font-bold text-site-muted">IP address</th>
                  </tr>
                </thead>
                <tbody>
                  {status === 'loading' ? (
                    [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i} className="border-b border-site-border">
                        <td colSpan={6} className="px-4 py-3">
                          <Skeleton className="h-6 w-full" />
                        </td>
                      </tr>
                    ))
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-site-muted">
                        {filtered ? 'No entries match these filters.' : 'No audit logs recorded yet.'}
                      </td>
                    </tr>
                  ) : (
                    logs.map((l, i) => {
                      const isOpen = expanded === l.id;
                      return (
                        <Fragment key={l.id}>
                          <tr className={`border-b border-site-border ${isOpen ? 'bg-primary/5' : ''}`}>
                            <td className="px-3 py-3">
                              <button
                                data-tour={i === 0 ? 'al-details' : undefined}
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : l.id)}
                                aria-expanded={isOpen}
                                aria-label={isOpen ? 'Hide details' : 'Show details'}
                                className="rounded-md p-1 text-site-muted hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-site-muted">{formatWhen(l.created_at)}</td>
                            <td className="px-4 py-3 text-sm">
                              <div className="font-medium text-site-text">{actorName(l)}</div>
                              {actorName(l) !== l.actor_email && (
                                <div className="text-xs text-site-muted">{l.actor_email}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-site-text" title={l.action}>
                              {humanize(l.action)}
                            </td>
                            <td className="px-4 py-3 text-sm text-site-muted">
                              <div>{humanize(l.entity_type)}</div>
                              <button
                                data-tour={i === 0 ? 'al-record' : undefined}
                                type="button"
                                title="Show the history of this record"
                                onClick={() => changeFilter({ entityId: l.entity_id })}
                                className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                              >
                                {l.entity_id.slice(0, 8)}…
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm text-site-muted">{l.ip_address ?? '—'}</td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-site-border bg-primary/5">
                              <td></td>
                              <td colSpan={5} className="px-4 pb-4 pt-1">
                                <Changes log={l} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status !== 'error' && (
          <div data-tour="al-pager" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-site-muted">
            <span>{total === 0 ? 'No entries' : `Showing ${firstShown}–${lastShown} of ${total}`}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || status === 'loading'}
              >
                Previous
              </Button>
              <span>
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount || status === 'loading'}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
