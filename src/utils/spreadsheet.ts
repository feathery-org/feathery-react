import { featheryDoc, featheryWindow } from './browser';

const SPREADSHEET_EXTENSIONS = ['csv', 'xlsx', 'xls', 'xlsm'];

export const isSpreadsheetFile = (file: File): boolean => {
  const ext = (file.name || '').split('.').pop()?.toLowerCase() ?? '';
  return SPREADSHEET_EXTENSIONS.includes(ext);
};

const isExcelFile = (file: File): boolean =>
  /\.(xlsx|xls|xlsm)$/i.test(file.name || '');

const SHEETJS_CDN =
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let sheetJSPromise: Promise<any> | null = null;

function loadSheetJS(): Promise<any> {
  const win = featheryWindow() as any;
  if (win.XLSX) return Promise.resolve(win.XLSX);
  if (sheetJSPromise) return sheetJSPromise;
  sheetJSPromise = new Promise((resolve, reject) => {
    const doc = featheryDoc();
    const script = doc.createElement('script');
    script.src = SHEETJS_CDN;
    script.async = true;
    script.onload = () => resolve((featheryWindow() as any).XLSX);
    script.onerror = () => {
      sheetJSPromise = null;
      reject(new Error('Failed to load the spreadsheet parser'));
    };
    doc.head.appendChild(script);
  });
  return sheetJSPromise;
}

function parseCSV(csv: string): string[][] {
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

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

// Skips hidden sheets (`Hidden` is 1 = hidden, 2 = very hidden).
function collectVisibleSheets(
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

export async function parseWorkbook(file: File): Promise<SpreadsheetSheet[]> {
  if (isExcelFile(file)) {
    const XLSX = await loadSheetJS();
    const buffer = await readArrayBuffer(file);
    const workbook = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      cellDates: true
    });
    return collectVisibleSheets(workbook, (sheet) =>
      XLSX.utils.sheet_to_json(sheet, {
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

export function normalizeSpreadsheet(parsed: string[][]): ParsedSpreadsheet {
  if (parsed.length === 0) return { headers: [], rows: [] };

  const rawHeaders = parsed[0];
  const dataRows = parsed
    .slice(1)
    .filter((row) => row.some((col) => col && col.trim() !== ''));

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

export interface NormalizedSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

export interface ColumnRef {
  sheet: string;
  header: string;
}
export type FieldMapping = Record<string, ColumnRef>;

// Fields mapped to different sheets are zipped by row index; shorter sheets
// yield blanks on the extra rows.
export function buildUnverifiedRows(
  sheets: NormalizedSheet[],
  mapping: FieldMapping
): Record<string, string>[] {
  const byName = new Map(sheets.map((s) => [s.name, s]));
  const resolved: { fieldKey: string; values: string[] }[] = [];

  Object.entries(mapping).forEach(([fieldKey, ref]) => {
    const sheet = byName.get(ref.sheet);
    if (!sheet) return;
    const colIndex = sheet.headers.indexOf(ref.header);
    if (colIndex < 0) return;
    resolved.push({
      fieldKey,
      values: sheet.rows.map((r) => (r[colIndex] ?? '').trim())
    });
  });

  const rowCount = resolved.reduce(
    (max, r) => Math.max(max, r.values.length),
    0
  );
  const out: Record<string, string>[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, string> = {};
    resolved.forEach(({ fieldKey, values }) => {
      row[fieldKey] = values[i] ?? '';
    });
    out.push(row);
  }
  return out;
}
