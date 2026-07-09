// Parsing helpers for spreadsheet uploads (CSV + Excel). CSV is parsed natively
// so no dependency is needed for the common case; Excel parsing dynamically
// imports the (heavier) `xlsx` library only when an Excel file is uploaded, so
// it stays out of the main bundle.

export const SPREADSHEET_EXTENSIONS = ['csv', 'xlsx', 'xls', 'xlsm'];

export const isSpreadsheetFile = (file: File): boolean => {
  const ext = (file.name || '').split('.').pop()?.toLowerCase() ?? '';
  return SPREADSHEET_EXTENSIONS.includes(ext);
};

const isExcelFile = (file: File): boolean =>
  /\.(xlsx|xls|xlsm)$/i.test(file.name || '');

export function parseCSV(csv: string): string[][] {
  if (csv.charCodeAt(0) === 0xfeff) csv = csv.slice(1);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let insideQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      currentValue += '"';
      i++; // skip escaped quote
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (currentValue || currentRow.length) {
        currentRow.push(currentValue);
        rows.push(currentRow);
        currentRow = [];
        currentValue = '';
      }
      if (char === '\r' && nextChar === '\n') i++; // handle CRLF
    } else {
      currentValue += char;
    }
  }

  if (currentValue || currentRow.length) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

const readArrayBuffer = (file: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });

const readText = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) ?? '');
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });

export interface SpreadsheetSheet {
  name: string;
  rows: string[][];
}

/**
 * Build the list of importable sheets from an xlsx workbook: skip hidden sheets
 * (`Hidden` is 1 = hidden, 2 = very hidden) and stringify every cell. Pure +
 * testable; the row extractor is injected so this needs no file IO.
 */
export function collectVisibleSheets(
  workbook: any,
  sheetToRows: (sheet: any) => any[][]
): SpreadsheetSheet[] {
  const wbSheets = workbook?.Workbook?.Sheets;
  const sheets: SpreadsheetSheet[] = [];
  (workbook?.SheetNames ?? []).forEach((name: string, i: number) => {
    if (wbSheets?.[i]?.Hidden) return; // skip hidden / very hidden sheets
    const rawRows = sheetToRows(workbook.Sheets[name]) || [];
    const rows = rawRows.map((row) =>
      (row || []).map((cell) => (cell == null ? '' : String(cell)))
    );
    sheets.push({ name, rows });
  });
  return sheets;
}

/**
 * Parse a CSV or Excel file into its sheets. CSV yields a single implicit sheet;
 * Excel yields all visible sheets (caller decides which are non-empty).
 */
export async function parseWorkbook(file: File): Promise<SpreadsheetSheet[]> {
  if (isExcelFile(file)) {
    const XLSX = await import('xlsx');
    const buffer = await readArrayBuffer(file);
    const workbook = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      cellDates: true
    });
    return collectVisibleSheets(workbook, (sheet) =>
      XLSX.utils.sheet_to_json<any[]>(sheet, {
        header: 1,
        raw: false,
        defval: ''
      })
    );
  }

  const text = await readText(file);
  return [{ name: 'Sheet1', rows: parseCSV(text) }];
}

export interface ParsedSpreadsheet {
  headers: string[];
  rows: string[][];
}

/**
 * Normalize parsed output into trimmed headers (blank headers become
 * "Column N") and non-empty data rows. Columns whose data cells are blank in
 * EVERY row are dropped entirely (a single non-blank value anywhere in the
 * column, at any row, keeps it). Headers and row cells stay index-aligned.
 */
export function normalizeSpreadsheet(parsed: string[][]): ParsedSpreadsheet {
  if (parsed.length === 0) return { headers: [], rows: [] };

  const rawHeaders = parsed[0];
  const dataRows = parsed
    .slice(1)
    .filter((row) => row.some((col) => col && col.trim() !== ''));

  // A column is kept only if at least one data row has a non-blank value in it.
  const keptIndexes = rawHeaders
    .map((_h, colIndex) => colIndex)
    .filter((colIndex) =>
      dataRows.some((row) => (row[colIndex] ?? '').trim() !== '')
    );

  const headers = keptIndexes.map((colIndex) => {
    const h = (rawHeaders[colIndex] ?? '').trim();
    return h || `Column ${colIndex + 1}`;
  });
  const rows = dataRows.map((row) =>
    keptIndexes.map((colIndex) => row[colIndex] ?? '')
  );

  return { headers, rows };
}

export type ColumnRef = { sheetIndex: number; header: string };
export type FieldMapping = Record<string, ColumnRef>;

export interface NormalizedSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

/**
 * Build hub-entry-shaped rows from a field->column mapping. Each field pulls
 * from the sheet recorded at selection time; rows are zipped by index across
 * sheets. Fields with no value at a row index are omitted from that row.
 * Rows that end up empty are dropped.
 */
export function buildMappedRows(
  sheets: NormalizedSheet[],
  mapping: FieldMapping,
  coerce: (fieldKey: string, raw: string) => any
): Record<string, any>[] {
  const columns: { fieldKey: string; sheet: NormalizedSheet; col: number }[] =
    [];
  Object.entries(mapping).forEach(([fieldKey, ref]) => {
    const sheet = sheets[ref.sheetIndex];
    const col = sheet ? sheet.headers.indexOf(ref.header) : -1;
    if (sheet && col >= 0) columns.push({ fieldKey, sheet, col });
  });
  const rowCount = Math.max(
    0,
    ...columns.map(({ sheet }) => sheet.rows.length)
  );
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, any> = {};
    columns.forEach(({ fieldKey, sheet, col }) => {
      const raw = sheet.rows[i]?.[col];
      if (raw === undefined) return;
      const value = coerce(fieldKey, raw);
      if (value !== null) row[fieldKey] = value;
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);

/**
 * Best-effort coercion of a spreadsheet cell (always a string) to the hub
 * field's type. Uncoercible values are returned as-is so server validation
 * flags them with a real message. Blank cells become null (treated as unset).
 */
export function coerceToHubType(raw: string, fieldType: string): any {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  if (fieldType === 'number') {
    const num = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(num) ? num : trimmed;
  }
  if (fieldType === 'boolean') {
    const word = trimmed.toLowerCase();
    if (TRUE_WORDS.has(word)) return true;
    if (FALSE_WORDS.has(word)) return false;
    return trimmed;
  }
  return trimmed;
}
