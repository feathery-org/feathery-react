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

// Mapping: target field key -> source column index (unmapped = absent).
export type FieldColumnMapping = Record<string, number>;

/**
 * Build field values from a field->column mapping: for each mapped field,
 * collect every data row's value (trimmed) from its source column into an
 * array, preserving row order. Returns a map of fieldKey -> string[].
 */
export function buildReversedFieldValues(
  rows: string[][],
  mapping: FieldColumnMapping
): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  if (rows.length === 0) return values;
  Object.entries(mapping).forEach(([fieldKey, colIndex]) => {
    if (colIndex == null || colIndex < 0) return;
    values[fieldKey] = rows.map((row) => (row[colIndex] ?? '').trim());
  });
  return values;
}
