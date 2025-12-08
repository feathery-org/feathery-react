import { stringifyWithNull } from '../../../utils/primitives';

export type SortableValue = {
  original: any;
  asNumber: number | null;
  asDate: Date | null;
  asString: string;
};

// Utility functions for sorting strings as numbers and dates
export function tryParseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;

  const stringValue = String(value).trim();

  // Remove common number formatting characters
  const cleaned = stringValue
    .replace(/[$€£¥]/g, '') // Currency symbols
    .replace(/[,%]/g, '') // Commas and percent
    .replace(/\s/g, ''); // Spaces

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

export function tryParseDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const stringValue = String(value).trim();

  // Try standard Date constructor first
  const standardDate = new Date(stringValue);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  const formats = [
    // US format: MM/DD/YYYY or M/D/YY
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/,
    // ISO-ish: YYYY/MM/DD or YYYY-MM-DD
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/
  ];

  for (const format of formats) {
    const match = stringValue.match(format);
    if (match) {
      let year, month, day;

      if (match[1].length === 4) {
        // YYYY-MM-DD format
        [, year, month, day] = match;
      } else {
        // MM/DD/YYYY format
        [, month, day, year] = match;
      }

      // Handle 2-digit years
      if (year.length === 2) {
        const yearNum = parseInt(year);
        year = yearNum < 50 ? `20${year}` : `19${year}`;
      }

      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return null;
}

export function parseSortableValue(value: any): SortableValue {
  const asNumber = tryParseNumber(value);
  const asDate = tryParseDate(value);
  const asString = stringifyWithNull(value) ?? '';

  return {
    original: value,
    asNumber,
    asDate,
    asString
  };
}

export function compareSortableValues(
  a: SortableValue,
  b: SortableValue
): number {
  // Try number comparison first
  if (a.asNumber !== null && b.asNumber !== null) {
    return a.asNumber - b.asNumber;
  }

  // Try date comparison
  if (a.asDate !== null && b.asDate !== null) {
    return a.asDate.getTime() - b.asDate.getTime();
  }

  // Fall back to string comparison
  return a.asString.localeCompare(b.asString);
}
