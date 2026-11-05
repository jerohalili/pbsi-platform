import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Postgres `numeric` columns reach the browser as strings (e.g. "3.50"), so accept both.
export function formatGPA(value: number | string | null | undefined): string {
  if (value == null || value === '') return 'N/A';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : 'N/A';
}

/** A grade percentage for display, e.g. "87.50%"; N/A when there is nothing to show. */
export function formatAverage(value: number | string | null | undefined): string {
  const text = formatGPA(value);
  return text === 'N/A' ? text : `${text}%`;
}

/** ISO timestamp -> value for <input type="datetime-local"> (in the browser's time zone). */
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (browser time zone) -> ISO timestamp for the API. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** A room as people type it ("204", "Room 204", "Lab 3"): "Room " is added only to a bare number or name. */
export function formatRoom(room: string): string {
  const trimmed = room.trim();
  return /^(room|rm|lab|laboratory|hall|gym|auditorium|library)\b/i.test(trimmed) ? trimmed : `Room ${trimmed}`;
}
