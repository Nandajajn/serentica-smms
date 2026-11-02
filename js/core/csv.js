// Builds CSV text that opens safely in Excel.
// A cell that starts with = + - @ could run as a formula, so it is neutralised.
function cell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export const toCSV = (rows) => '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
