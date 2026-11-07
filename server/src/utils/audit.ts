import type { Request } from 'express';
import { sql } from '../config/db.js';

type Values = Record<string, unknown> | null;

function json(value: Values): string | null {
  return value ? JSON.stringify(value) : null;
}

/**
 * The INSERT for one audit row, not yet run. Pass it to `sql.transaction([...])` next to the change
 * it describes when the two must succeed or fail together (use for the most sensitive actions).
 * Never stores passwords.
 */
export function auditStatement(
  req: Request,
  action: string,
  entityType: string,
  entityId: string,
  oldValues: Values,
  newValues: Values,
  actorIdOverride?: string,
) {
  // Login has no signed-in user yet, so it names the account itself.
  const actorId = actorIdOverride ?? req.user?.id;
  if (!actorId) throw new Error(`Cannot audit "${action}": the request has no signed-in user`);
  return sql`
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values, ip_address)
    VALUES (${actorId}, ${action}, ${entityType}, ${entityId},
            ${json(oldValues)}::jsonb, ${json(newValues)}::jsonb, ${req.ip ?? null})
  `;
}

/**
 * Best-effort audit trail for any kind of record. A failure here is logged but does not undo the
 * (already successful) change. For changes that must never go unrecorded, use `auditStatement`
 * inside a transaction instead.
 */
export async function recordAudit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string,
  oldValues: Values,
  newValues: Values,
  actorIdOverride?: string,
): Promise<void> {
  try {
    await auditStatement(req, action, entityType, entityId, oldValues, newValues, actorIdOverride);
  } catch (err) {
    console.error(`[audit] failed to write "${action}" for ${entityType} ${entityId}:`, err);
  }
}

/**
 * Like recordAudit, but writes nothing when the same actor already has the same action recorded
 * within the last `windowMinutes`. Used for failed logins so repeated guesses against one account
 * cannot flood the table. One statement, so two simultaneous attempts cannot both slip through
 * unless they start in the same instant (an extra row then is harmless).
 */
export async function recordAuditThrottled(
  req: Request,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  newValues: Values,
  windowMinutes: number,
): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values, ip_address)
      SELECT ${actorId}, ${action}, ${entityType}, ${entityId}, NULL, ${json(newValues)}::jsonb, ${req.ip ?? null}
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_logs
        WHERE actor_id = ${actorId} AND action = ${action}
          AND created_at > now() - make_interval(mins => ${windowMinutes}::int)
      )
    `;
  } catch (err) {
    console.error(`[audit] failed to write throttled \"${action}\" for ${entityType} ${entityId}:`, err);
  }
}

/**
 * Keeps only the fields whose value actually changed, so an audit row says what changed instead
 * of repeating the whole record. Returns null when nothing changed.
 */
export function diffValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { old: Record<string, unknown>; new: Record<string, unknown> } | null {
  const old: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    if (String(before[key] ?? '') === String(after[key] ?? '')) continue;
    old[key] = before[key] ?? null;
    next[key] = after[key] ?? null;
  }
  return Object.keys(next).length > 0 ? { old, new: next } : null;
}
