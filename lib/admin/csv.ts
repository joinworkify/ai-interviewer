/**
 * CSV for the interviews export. Cells that start with =, +, - or @ (or a tab
 * or carriage return) are prefixed with an apostrophe so a spreadsheet never
 * runs them as a formula: names and emails are typed by candidates.
 */

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
