// Type registry: displayed text <-> canonical value.
//
// Parsing turns what the user typed in the editor into a canonical value
// (base-10 decimal strings for numeric types, ISO dates, booleans). Rendering
// turns a canonical value back into display text with the type's format
// metadata. Formulas only ever see canonical values.
//
// Named valueTypes rather than types to avoid colliding with the DocxEditor's
// own types.ts one directory up.

import { group, isDecimalString, mul, normalize, roundTo } from './decimal';
import { BoundDefinition, FieldType } from './tagDsl';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£'
};

export class ValueError extends Error {
  constructor(message?: string) {
    super(message);
    // The package compiles to es5, where the emit runs `Error.call(this, message)
    // || this` and Error-as-a-function returns a FRESH plain Error - so the
    // constructed object is not a ValueError at runtime and `instanceof` is false.
    // Every catch site here distinguishes an expected value/parse failure from a
    // real bug, so losing that check turns a diagnostic into a thrown reconcile.
    // Restoring the prototype and stamping the name keeps both routes working.
    Object.setPrototypeOf(this, ValueError.prototype);
    this.name = 'ValueError';
  }
}

/**
 * True for a ValueError, whether or not `instanceof` survived compilation. Catch
 * sites use this rather than `instanceof` so a downlevelled build cannot silently
 * reclassify an expected failure as a crash.
 */
export function isValueError(error: unknown): error is ValueError {
  return (
    error instanceof ValueError ||
    (!!error && (error as Error).name === 'ValueError')
  );
}

function stripNumeric(text: string): { neg: boolean; body: string } {
  let body = String(text).trim();
  let neg = false;
  if (/^\(.*\)$/.test(body)) {
    neg = true;
    body = body.slice(1, -1).trim();
  }
  body = body
    .replace(/[$€£]/g, '')
    .replace(/^[A-Z]{3}\s*/, '')
    .replace(/[,\s]/g, '');
  if (body.startsWith('-')) {
    neg = !neg;
    body = body.slice(1);
  }
  return { neg, body };
}

/** Display text -> canonical value string, or throws ValueError. */
export function parseDisplay(fieldType: FieldType, text: string): string {
  const raw = String(text);
  switch (fieldType.kind) {
    case 'text':
      return raw;
    case 'integer': {
      const { neg, body } = stripNumeric(raw);
      if (!/^\d+$/.test(body))
        throw new ValueError(`not an integer: ${JSON.stringify(raw)}`);
      return normalize((neg ? '-' : '') + body);
    }
    case 'decimal':
    case 'currency': {
      // Input is rounded to the type's scale up front (half-up), so a typed
      // "150.005" becomes canonical "150.01" for a 2dp currency.
      const { neg, body } = stripNumeric(raw);
      if (!isDecimalString(body))
        throw new ValueError(`not a number: ${JSON.stringify(raw)}`);
      return normalize(roundTo((neg ? '-' : '') + body, fieldType.scale));
    }
    case 'percent': {
      // "8%", "8", "8.5 %" all mean the fraction 0.08 / 0.085
      const { neg, body } = stripNumeric(raw.replace(/%\s*$/, ''));
      if (!isDecimalString(body))
        throw new ValueError(`not a percentage: ${JSON.stringify(raw)}`);
      return normalize(mul((neg ? '-' : '') + body, '0.01'));
    }
    case 'date': {
      const trimmed = raw.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || isNaN(Date.parse(trimmed))) {
        throw new ValueError(`not an ISO date: ${JSON.stringify(raw)}`);
      }
      return trimmed;
    }
    case 'boolean': {
      const trimmed = raw.trim().toLowerCase();
      if (trimmed === 'true' || trimmed === 'yes') return 'true';
      if (trimmed === 'false' || trimmed === 'no') return 'false';
      throw new ValueError(`not a boolean: ${JSON.stringify(raw)}`);
    }
    default:
      throw new ValueError(
        `unknown type ${JSON.stringify((fieldType as FieldType).kind)}`
      );
  }
}

/** Canonical value -> display text. */
export function renderDisplay(fieldType: FieldType, value: string): string {
  switch (fieldType.kind) {
    case 'text':
    case 'date':
    case 'boolean':
      return String(value);
    case 'integer':
      return group(normalize(String(value)));
    case 'percent':
      return `${normalize(mul(String(value), '100'))}%`;
    case 'decimal':
      return group(roundTo(String(value), fieldType.scale));
    case 'currency': {
      const rounded = roundTo(String(value), fieldType.scale);
      const symbol = CURRENCY_SYMBOLS[fieldType.currency];
      const body = group(rounded.replace(/^-/, ''));
      const withSymbol = symbol
        ? symbol + body
        : `${fieldType.currency} ${body}`;
      return rounded.startsWith('-') ? `-${withSymbol}` : withSymbol;
    }
    default:
      throw new ValueError(
        `unknown type ${JSON.stringify((fieldType as FieldType).kind)}`
      );
  }
}

export function isNumericType(fieldType: FieldType): boolean {
  return (
    fieldType.kind === 'integer' ||
    fieldType.kind === 'decimal' ||
    fieldType.kind === 'currency' ||
    fieldType.kind === 'percent'
  );
}

/** The value a freshly created row instance starts with. */
export function defaultValue(def: BoundDefinition): string {
  if (def.options && def.options.default !== undefined) {
    return parseDisplay(def.fieldType, def.options.default);
  }
  return isNumericType(def.fieldType) ? '0' : '';
}
