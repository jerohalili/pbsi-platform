/**
 * Spreadsheet programs run a cell that starts with = + - @ (or a tab / carriage return) as a formula,
 * so a student named "=HYPERLINK(...)" would execute something when an admin opens the export
 * (CSV injection). Names, emails and phones are typed by other people, so such a cell gets a leading
 * apostrophe and is read as text. A plain number or phone such as +639171234567 is left alone.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?[\d\s().-]+$/;

/** One CSV cell: always quoted, quotes doubled, and never a live formula. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Makes Excel read the file as UTF-8, so names such as "Peña" or "Muñoz" are not garbled. */
export const CSV_BOM = '\uFEFF';
