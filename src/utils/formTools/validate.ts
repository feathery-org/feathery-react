import {
  checkValueAgainstField,
  resolveOptions
} from '../../assistant/tools/setFieldValue';
import { formatDateString } from '../../elements/fields/DateSelectorField/utils';
import countryData from '../../elements/components/data/countries';
import { dataURLToFile } from '../image';
import {
  fileSizeLimitFor,
  NUM_FILES_LIMIT,
  resolveAllowedFileTypes,
  validateFileSizes,
  validateFileTypes
} from '../../elements/fields/FileUploadField/validation';
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

// Stored date_selector values are always produced by formatDateString (see
// DateSelectorField), UTC-ending-in-Z when the field has a time picker.
// Writing straight through our own ISO-ish input would leave the field
// holding a shape the rest of the form never produces, so reformat through
// the same helper the real field uses.
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
    const m = value.match(DATETIME_RE);
    if (!m)
      return {
        ok: false,
        error: `Field '${servar.key}' expects 'YYYY-MM-DDTHH:mm'.`
      };
    const [, y, mo, d, h, mi] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    return { ok: true, value: formatDateString(date, meta) };
  }
  const m = value.match(DATE_RE);
  if (!m)
    return { ok: false, error: `Field '${servar.key}' expects 'YYYY-MM-DD'.` };
  const [, y, mo, d] = m;
  const date = new Date(+y, +mo - 1, +d);
  return { ok: true, value: formatDateString(date, meta) };
};

// checkValueAgainstField (reused as-is, unchanged, for the existing
// assistant) has no validation for 'select' (radio-rendered) or 'matrix',
// and no time-aware date_selector check. This wraps it with the extra
// checks fill_step needs without touching that shared helper's behavior.
export const validateAndNormalizeForFill = (
  servar: any,
  rawValue: unknown
): { ok: true; value: unknown } | { ok: false; error: string } => {
  if (servar.type === 'date_selector')
    return normalizeDateSelector(servar, rawValue);

  if (servar.type === 'matrix') {
    const error = checkMatrixValue(servar, rawValue);
    return error ? { ok: false, error } : { ok: true, value: rawValue };
  }

  if (servar.type === 'select') {
    if (typeof rawValue !== 'string')
      return {
        ok: false,
        error: `Field '${servar.key}' (select) expects a single option value (string).`
      };
    const opts = resolveOptions(servar, undefined).map((o) => o.value);
    if (opts.length > 0 && !opts.includes(rawValue))
      return {
        ok: false,
        error: `Value not in allowed options. Allowed: ${opts.join(', ')}.`
      };
    return { ok: true, value: rawValue };
  }

  // gmap_country renders as a closed dropdown over our static country list
  // (DropdownField), keyed by code or name per store_abbreviation - same
  // shape as 'select' above, just sourced from countryData instead of
  // servar.metadata. Previously fell through to the generic string/length
  // check below, which never caught a country that doesn't exist.
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

  const error = checkValueAgainstField(servar, rawValue, undefined);
  return error ? { ok: false, error } : { ok: true, value: rawValue };
};

// Decodes feathery_fill_step's FileInput[] into real File objects and runs
// the same type/size/count checks FileUploadField runs on a real drop, so a
// tool-driven upload can't bypass limits a user-driven one would hit.
export const decodeAndValidateFiles = (
  servar: any,
  rawValue: unknown
): { ok: true; files: File[] } | { ok: false; error: string } => {
  if (!Array.isArray(rawValue) || rawValue.length === 0)
    return {
      ok: false,
      error: `Field '${servar.key}' (file_upload) expects a non-empty array of files.`
    };

  const isMultiple = !!servar.metadata?.multiple;
  if (!isMultiple && rawValue.length > 1)
    return { ok: false, error: `Field '${servar.key}' accepts only one file.` };
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
