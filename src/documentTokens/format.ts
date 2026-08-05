/**
 * Rendering a token's number as the text a reader sees, and reading it back.
 *
 * Distinct from `assistant/tools/numericCells.ts`, which infers a format from
 * whatever text it finds in a cell. A token declares its format in its spec,
 * so formatting here is driven by the declaration rather than guessed.
 *
 * The Python twin lives at
 * feathery-backend/apps/document/utils/tokens/format.py — a value formatted on
 * the server and reformatted here must agree, so keep the two in step.
 */

import { roundHalfAwayFromZero } from './grammar';
import { TokenFormat } from './plan';

const DEFAULT_DECIMALS: Record<string, number> = {
  currency: 2,
  percent: 2,
  number: 0,
  text: 0
};

const group = (value: number, decimals: number): string =>
  roundHalfAwayFromZero(value, decimals).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

/** Format a token value for display in the document. */
export const renderValue = (
  value: number | string | null | undefined,
  fmt?: TokenFormat
): string => {
  const kind = fmt?.kind ?? 'text';
  if (kind === 'text' || typeof value !== 'number' || !Number.isFinite(value)) {
    return value === null || value === undefined ? '' : String(value);
  }

  const decimals = fmt?.decimals ?? DEFAULT_DECIMALS[kind] ?? 0;
  const grouped = group(value, decimals);

  if (kind === 'currency') {
    return grouped.startsWith('-') ? `-$${grouped.slice(1)}` : `$${grouped}`;
  }
  if (kind === 'percent') return `${grouped}%`;
  return grouped;
};

/**
 * Read a number back out of formatted text, or null when there isn't one.
 * Everything that is not a digit, sign, or decimal point is stripped, so
 * `$1,500.00` reads as 1500 and `8.25%` as 8.25.
 */
export const parseValue = (text: string | null | undefined): number | null => {
  if (text === null || text === undefined) return null;

  const cleaned = String(text)
    .split('')
    .filter((ch) => /[0-9]/.test(ch) || ch === '-' || ch === '.')
    .join('');

  // A stray second dot, or a sign that is not leading, makes it meaningless.
  const dots = cleaned.split('.').length - 1;
  if (dots > 1 || cleaned.lastIndexOf('-') > 0) return null;
  if (['', '-', '.', '-.'].includes(cleaned)) return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};
