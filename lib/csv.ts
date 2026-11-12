// CSV files a spreadsheet or a bookkeeping program can open safely.
//
// RFC 4180: a cell holding a comma, a double quote or a line break goes in double quotes with its own
// quotes doubled, and every line ends in CRLF. Text that starts the way a formula does (= + - @, also
// after spaces or in their full-width forms, or a tab or line break) gets a leading apostrophe, so a
// client name someone typed can never run as a formula when the file is opened.

/**
 * One cell. Text is what people typed and gets the formula guard. A number is a figure the export
 * worked out itself, so it is written as it is: a credit keeps its minus sign and stays a number.
 */
export type CsvValue = string | number | null | undefined;

const FORMULA_START = /^\s*[=+\-@＝＋－＠]|^[\t\r\n]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : '';
  } else {
    text = String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: the header, then one line a row. Starts with a byte order mark so Excel reads accented names properly. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Sends a file made by toCsv as a download. The name is the export's own, kept to safe characters. */
export function csvResponse(csv: string, filename: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '-');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}"`,
      'Cache-Control': 'no-store',
    },
  });
}
