import * as XLSX from 'xlsx';

/**
 * Server-side spreadsheet → text converter. Accepts .csv, .tsv, .xlsx, .xls.
 * Returns a CSV-formatted string (sheet-by-sheet for multi-sheet workbooks)
 * that Claude can read as plain text.
 */
export function parseSpreadsheet(
  buffer: Uint8Array,
  filename: string,
): string {
  const ext = filename.toLowerCase().split('.').pop() || '';

  // CSV / TSV: just decode bytes as UTF-8. No library needed.
  if (ext === 'csv' || ext === 'tsv') {
    try {
      return new TextDecoder('utf-8').decode(buffer);
    } catch {
      return '';
    }
  }

  // xlsx / xls / xlsm / ods → use SheetJS to extract every sheet as CSV.
  try {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        parts.push(`# Sheet: ${sheetName}\n${csv}`);
      }
    }
    return parts.join('\n\n');
  } catch (e) {
    console.error('spreadsheet parse failed', e);
    return '';
  }
}
