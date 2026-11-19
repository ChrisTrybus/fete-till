/** Quotes a CSV cell and keeps formula-like text literal in spreadsheet imports. */
export function csvCell(value: string): string {
  // A typographic apostrophe is ordinary text, even when a spreadsheet saves the CSV again.
  const text = /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(value) ? '’' + value : value;
  return '"' + text.replace(/"/g, '""') + '"';
}
