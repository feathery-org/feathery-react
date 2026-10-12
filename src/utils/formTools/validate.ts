import {
  checkValueAgainstField,
  describeOptions,
  emptyValueFor,
  isEmptyValue,
  resolveOptions
} from '../formActions/fillFields';
import { formatDateString } from '../../elements/fields/DateSelectorField/utils';
import countryData from '../../elements/components/data/countries';
import { stateMap } from '../../elements/components/data/states';
import { dataURLToFile } from '../image';
import {
  fileSizeLimitFor,
  NUM_FILES_LIMIT,
  resolveAllowedFileTypes,
  validateFileSizes,
  validateFileTypes
} from '../../elements/fields/FileUploadField/validation';
import { validators } from '../validation';
import { FileInput } from './types';

const UNSUPPORTED_TYPES = new Set([
  'signature',
  'audio_recording',
  'payment_method',
  'custom',
  'qr_scanner',
  'hex_color'
]);

export const isUnsupportedType = (type: string): boolean =>
  UNSUPPORTED_TYPES.has(type);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((e) => typeof e === 'string');

const checkMatrixValue = (servar: any, value: unknown): string | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return `Field '${servar.key}' (matrix) expects an object of questionId -> string[].`;
  const questionIds = new Set(
    (servar.metadata?.questions ?? []).map((q: any) => q.id)
  );
  for (const [questionId, answers] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!isStringArray(answers))
      return `Field '${servar.key}' (matrix) question '${questionId}' expects a string[].`;
    if (questionIds.size > 0 && !questionIds.has(questionId))
      return `Field '${servar.key}' (matrix) has no question '${questionId}'.`;
  }
  return null;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ZONED_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Date rolls impossible days over (2026-02-30 becomes March 2), so check the
// parts survive a round trip
const isRealDate = (y: number, mo: number, d: number) => {
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
};

// Reformat through formatDateString so the stored shape matches what
// DateSelectorField itself produces
const normalizeDateSelector = (
  servar: any,
  value: unknown
): { ok: true; value: string } | { ok: false; error: string } => {
  const meta = servar.metadata ?? {};
  const chooseTime = !!meta.choose_time;
  if (typeof value !== 'string')
    return {
      ok: false,
      error: `Field '${servar.key}' (date_selector) expects a string.`
    };
  if (chooseTime) {
    const invalid = {
      ok: false as const,
      error: `Field '${servar.key}' expects 'YYYY-MM-DDTHH:mm' in local time, or an ISO date-time with a timezone.`
    };
    // A zoned value is that exact instant; a bare one is the browser's local time, as the picker reads it
    if (ZONED_DATETIME_RE.test(value)) {
      const zoned = new Date(value);
      return Number.isNaN(zoned.getTime())
        ? invalid
        : { ok: true, value: formatDateString(zoned, meta) };
    }
    const m = value.match(DATETIME_RE);
    if (!m) return invalid;
    const [, y, mo, d, h, mi] = m;
    if (+h > 23 || +mi > 59 || !isRealDate(+y, +mo, +d)) return invalid;
    const date = new Date(+y, +mo - 1, +d, +h, +mi);
    return { ok: true, value: formatDateString(date, meta) };
  }
  const m = value.match(DATE_RE);
  if (!m)
    return { ok: false, error: `Field '${servar.key}' expects 'YYYY-MM-DD'.` };
  const [, y, mo, d] = m;
  if (!isRealDate(+y, +mo, +d))
    return { ok: false, error: `Field '${servar.key}' expects 'YYYY-MM-DD'.` };
  const date = new Date(+y, +mo - 1, +d);
  return { ok: true, value: formatDateString(date, meta) };
};

// Wraps checkValueAgainstField with the checks it lacks: 'select', 'matrix'
// and time-aware date_selector
export const validateAndNormalizeForFill = (
  servar: any,
  rawValue: unknown
): { ok: true; value: unknown } | { ok: false; error: string } => {
  // An empty value clears the field, as fillFields does
  if (servar.type !== 'matrix' && isEmptyValue(rawValue))
    return { ok: true, value: emptyValueFor(servar) };

  if (servar.type === 'date_selector')
    return normalizeDateSelector(servar, rawValue);

  if (servar.type === 'matrix') {
    const error = checkMatrixValue(servar, rawValue);
    return error ? { ok: false, error } : { ok: true, value: rawValue };
  }

  // The generic text check never verifies url format
  if (servar.type === 'url') {
    if (typeof rawValue !== 'string')
      return {
        ok: false,
        error: `Field '${servar.key}' (url) expects a string.`
      };
    if (!validators.url(rawValue))
      return {
        ok: false,
        error: `Field '${servar.key}' is not a well-formed url.`
      };
    return { ok: true, value: rawValue };
  }

  if (servar.type === 'select') {
    if (typeof rawValue !== 'string')
      return {
        ok: false,
        error: `Field '${servar.key}' (select) expects a single option value (string).`
      };
    const options = resolveOptions(servar, undefined);
    if (options.length > 0 && !options.some((o) => o.value === rawValue))
      return {
        ok: false,
        error: `Value not in allowed options. Allowed: ${describeOptions(
          options
        )}.`
      };
    return { ok: true, value: rawValue };
  }

  // gmap_country is a closed dropdown over countryData, keyed by code or
  // name per store_abbreviation
  if (servar.type === 'gmap_country') {
    if (typeof rawValue !== 'string')
      return {
        ok: false,
        error: `Field '${servar.key}' (gmap_country) expects a country value (string).`
      };
    const wantCode = !!servar.metadata?.store_abbreviation;
    const lower = rawValue.toLowerCase();
    const match = countryData.find((c) =>
      wantCode
        ? c.countryCode.toLowerCase() === lower
        : c.countryName.toLowerCase() === lower
    );
    if (!match)
      return {
        ok: false,
        error: `Value is not a recognized country ${
          wantCode ? 'code' : 'name'
        }.`
      };
    return {
      ok: true,
      value: wantCode ? match.countryCode : match.countryName
    };
  }

  // gmap_state: validated against normalizeGmapState's stateMap; no state
  // list for the country means no dropdown, so it passes through
  if (servar.type === 'gmap_state') {
    if (typeof rawValue !== 'string')
      return {
        ok: false,
        error: `Field '${servar.key}' (gmap_state) expects a state value (string).`
      };
    if (rawValue === '') return { ok: true, value: rawValue };
    const dc = servar.metadata?.default_country;
    const country = ((dc && dc !== 'auto' ? dc : 'us') as string).toLowerCase();
    const states = stateMap[country];
    if (!states || states.length === 0) return { ok: true, value: rawValue };
    const lower = rawValue.toLowerCase();
    const match = states.find(
      (s) => s.code.toLowerCase() === lower || s.name.toLowerCase() === lower
    );
    if (!match) return { ok: false, error: 'Value is not a recognized state.' };
    return {
      ok: true,
      value: servar.metadata?.store_abbreviation ? match.code : match.name
    };
  }

  const error = checkValueAgainstField(servar, rawValue, undefined);
  return error ? { ok: false, error } : { ok: true, value: rawValue };
};

// Decodes FileInput[] into File objects and runs FileUploadField's
// type/size/count checks. `singleRow` caps a repeated-field row at one file
// regardless of metadata.multiple.
export const decodeAndValidateFiles = (
  servar: any,
  rawValue: unknown,
  singleRow = false
): { ok: true; files: File[] } | { ok: false; error: string } => {
  if (!Array.isArray(rawValue) || rawValue.length === 0)
    return {
      ok: false,
      error: `Field '${servar.key}' (file_upload) expects a non-empty array of files.`
    };

  const isMultiple = !singleRow && !!servar.metadata?.multiple;
  if (!isMultiple && rawValue.length > 1)
    return {
      ok: false,
      error: singleRow
        ? `Field '${servar.key}' accepts only one file per row.`
        : `Field '${servar.key}' accepts only one file.`
    };
  if (rawValue.length > NUM_FILES_LIMIT)
    return {
      ok: false,
      error: `Too many files; the limit is ${NUM_FILES_LIMIT}.`
    };

  let files: File[];
  try {
    files = (rawValue as FileInput[]).map((f) =>
      dataURLToFile(`data:${f.mimeType};base64,${f.dataBase64}`, f.name)
    );
  } catch {
    return {
      ok: false,
      error: `Field '${servar.key}' (file_upload) got an undecodable file.`
    };
  }

  try {
    validateFileTypes(files, resolveAllowedFileTypes(servar));
    validateFileSizes(files, fileSizeLimitFor(servar));
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Invalid file.' };
  }

  return { ok: true, files };
};
