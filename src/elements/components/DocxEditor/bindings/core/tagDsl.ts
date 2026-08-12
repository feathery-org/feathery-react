// The binding tag DSL carried in content-control `tag` properties.
//
// Canonical (v2) form: order-independent key=value pairs.
//
//   [[name=project.name]]                                     text field
//   [[name=unit_cost|type=currency|row=r-1]]                  currency cell
//   [[name=line_total|expr=mul(quantity,unit_cost)|row=r-1]]  row formula
//   [[name=tax_rate|type=percent|del=keep]]                   shared number
//   [[table=costs]]                                           table marker
//
// Kind is inferred: an `expr` key makes it a formula (read-only, non-deletable,
// engine-owned); a `table` key makes it a table marker; otherwise it is an
// editable field. Every key except `name` (or `table`) has a default - see
// KEY_REFERENCE below.
//
// The older positional grammar ([[v1|field|...]] / [[v1|formula|...]] /
// [[v1|table|...]]) is still READ for backward compatibility, but formatTag
// always emits canonical v2 with default-valued keys omitted, so semantically
// equal definitions are byte-identical. That byte-identity is load-bearing: the
// editor adapter finds a write target by exact tag match, and the engine dedupes
// writes by tag.
//
// Parsing is strict: unknown keys, versions, types, or policies are rejected,
// never guessed at. No eval anywhere.

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ID_RE = /^[A-Za-z0-9_-]+$/;

const KEYS = new Set([
  'v',
  'table',
  'name',
  'expr',
  'type',
  'del',
  'default',
  'label',
  'row'
]);

export type TagVersion = 1 | 2;

export type FieldType =
  | { kind: 'text' }
  | { kind: 'integer' }
  | { kind: 'boolean' }
  | { kind: 'percent' }
  | { kind: 'decimal'; scale: number }
  | { kind: 'currency'; currency: string; scale: number }
  | { kind: 'date'; format: string };

export interface TagOptions {
  default?: string;
  label?: string;
  row?: string;
}

export interface TableDefinition {
  version: TagVersion;
  kind: 'table';
  tableId: string;
}

export interface FieldDefinition {
  version: TagVersion;
  kind: 'field';
  name: string;
  fieldType: FieldType;
  isEditable: boolean;
  isDeletable: boolean;
  options: TagOptions;
}

export interface FormulaDefinition {
  version: TagVersion;
  kind: 'formula';
  name: string;
  fieldType: FieldType;
  expression: string;
  isEditable: boolean;
  isDeletable: boolean;
  options: TagOptions;
}

/** A definition that names a value - everything except a table marker. */
export type BoundDefinition = FieldDefinition | FormulaDefinition;

export type Definition = TableDefinition | BoundDefinition;

export interface KeyReferenceEntry {
  key: string;
  required: string;
  default: string | null;
  meaning: string;
}

// Documented defaults (also the values formatTag omits):
export const KEY_REFERENCE: KeyReferenceEntry[] = [
  {
    key: 'name',
    required: 'for fields/formulas',
    default: null,
    meaning: 'binding identifier (dotted identifiers allowed)'
  },
  {
    key: 'expr',
    required: 'no',
    default: null,
    meaning:
      'allowlisted formula; its presence makes the tag a formula (ro, non-deletable)'
  },
  {
    key: 'table',
    required: 'for table markers',
    default: null,
    meaning: 'marks the wrapped table as configured; takes no other keys'
  },
  {
    key: 'type',
    required: 'no',
    default: 'text (fields) / currency:USD:2 (formulas)',
    meaning:
      'text | integer | decimal[:scale] | currency[:CODE:scale] | percent | date[:format] | boolean'
  },
  {
    key: 'del',
    required: 'no',
    default: 'delete (fields); formulas are always keep',
    meaning: 'delete = occurrence may be removed; keep = protected'
  },
  {
    key: 'default',
    required: 'no',
    default: "'' / 0 by type",
    meaning: 'initial value for new rows/instances (percent-encoded)'
  },
  {
    key: 'label',
    required: 'no',
    default: null,
    meaning: 'human display label (percent-encoded)'
  },
  {
    key: 'row',
    required: 'system',
    default: null,
    meaning:
      'immutable row identity; written by the app when cloning/adopting rows'
  },
  {
    key: 'v',
    required: 'no',
    default: '2',
    meaning: 'grammar version of key=value tags'
  }
];

export class TagError extends Error {
  constructor(message?: string) {
    super(message);
    // The package compiles to es5, where the emit runs `Error.call(this, message)
    // || this` and Error-as-a-function returns a FRESH plain Error - so the
    // constructed object is not a TagError at runtime and `instanceof` is false.
    // Every catch site here distinguishes an expected value/parse failure from a
    // real bug, so losing that check turns a diagnostic into a thrown reconcile.
    // Restoring the prototype and stamping the name keeps both routes working.
    Object.setPrototypeOf(this, TagError.prototype);
    this.name = 'TagError';
  }
}

/**
 * True for a TagError, whether or not `instanceof` survived compilation. Catch
 * sites use this rather than `instanceof` so a downlevelled build cannot silently
 * reclassify an expected failure as a crash.
 */
export function isTagError(error: unknown): error is TagError {
  return (
    error instanceof TagError ||
    (!!error && (error as Error).name === 'TagError')
  );
}

function fail(message: string, tag: string): never {
  throw new TagError(`${message} in tag ${JSON.stringify(tag)}`);
}

/** Reserved delimiters inside option values are percent-encoded. */
export function encodeValue(value: string): string {
  return String(value).replace(/[%|[\]=]/g, (character) => {
    const hex = character.charCodeAt(0).toString(16).toUpperCase();
    return `%${hex.length < 2 ? `0${hex}` : hex}`;
  });
}

/**
 * Tolerant: a "%" that does not start a valid %XX escape is taken literally, so
 * hand-authored values like "default=0%" work without writing "0%25".
 */
export function decodeValue(value: string): string {
  const safe = String(value).replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
  try {
    return decodeURIComponent(safe);
  } catch {
    throw new TagError(`bad percent-encoding in ${JSON.stringify(value)}`);
  }
}

const DEFAULT_FIELD_TYPE = (): FieldType => ({ kind: 'text' });
const DEFAULT_FORMULA_TYPE = (): FieldType => ({
  kind: 'currency',
  currency: 'USD',
  scale: 2
});

export function parseType(spec: string, tag: string): FieldType {
  const parts = String(spec).split(':');
  switch (parts[0]) {
    case 'text':
    case 'integer':
    case 'boolean':
    case 'percent':
      if (parts.length !== 1) fail(`type ${parts[0]} takes no arguments`, tag);
      return { kind: parts[0] };
    case 'decimal': {
      if (parts.length === 1) return { kind: 'decimal', scale: 2 };
      if (parts.length !== 2 || !/^\d+$/.test(parts[1]))
        fail('decimal takes an optional numeric scale', tag);
      return { kind: 'decimal', scale: Number(parts[1]) };
    }
    case 'currency': {
      if (parts.length === 1)
        return { kind: 'currency', currency: 'USD', scale: 2 };
      if (
        parts.length !== 3 ||
        !/^[A-Z]{3}$/.test(parts[1]) ||
        !/^\d+$/.test(parts[2])
      ) {
        fail('currency is bare (USD, 2dp) or currency:CODE:scale', tag);
      }
      return { kind: 'currency', currency: parts[1], scale: Number(parts[2]) };
    }
    case 'date': {
      if (parts.length === 1) return { kind: 'date', format: 'YYYY-MM-DD' };
      if (parts.length !== 2 || !parts[1])
        fail('date takes an optional display format', tag);
      return { kind: 'date', format: parts[1] };
    }
    default:
      return fail(`unknown type ${JSON.stringify(parts[0])}`, tag);
  }
}

export function formatType(fieldType: FieldType): string {
  switch (fieldType.kind) {
    case 'decimal':
      return `decimal:${fieldType.scale}`;
    case 'currency':
      return `currency:${fieldType.currency}:${fieldType.scale}`;
    case 'date':
      return `date:${fieldType.format}`;
    default:
      return fieldType.kind;
  }
}

/**
 * Shortest spelling that parses back to the same type: bare shorthands for the
 * per-kind defaults, the full form otherwise.
 */
function shortTypeString(fieldType: FieldType): string {
  const full = formatType(fieldType);
  for (const bare of ['decimal', 'currency', 'date']) {
    if (fieldType.kind === bare && formatType(parseType(bare, '')) === full)
      return bare;
  }
  return full;
}

/* ---------------- legacy positional v1 reader ---------------- */

function parseLegacyOptions(fields: string[], tag: string): TagOptions {
  const options: TagOptions = {};
  for (const field of fields) {
    const eq = field.indexOf('=');
    if (eq === -1)
      fail(`unexpected trailing field ${JSON.stringify(field)}`, tag);
    const key = field.slice(0, eq);
    if (key !== 'default' && key !== 'label' && key !== 'row')
      fail(`unknown option ${JSON.stringify(key)}`, tag);
    if (key in options) fail(`duplicate option ${JSON.stringify(key)}`, tag);
    options[key] = decodeValue(field.slice(eq + 1));
  }
  if (options.row !== undefined && !ID_RE.test(options.row))
    fail('row id must be [A-Za-z0-9_-]+', tag);
  return options;
}

function parseLegacyV1(fields: string[], tag: string): Definition {
  const kind = fields[1];
  if (kind === 'table') {
    if (fields.length !== 3) fail('table tag is [[v1|table|<id>]]', tag);
    if (!ID_RE.test(fields[2])) fail('table id must be [A-Za-z0-9_-]+', tag);
    return { version: 1, kind: 'table', tableId: fields[2] };
  }
  if (kind === 'field') {
    if (fields.length < 6)
      fail('field tag needs name|type|rw|delete_policy', tag);
    const [, , name, type, policy, del, ...rest] = fields;
    if (!NAME_RE.test(name)) fail(`invalid name ${JSON.stringify(name)}`, tag);
    if (policy !== 'rw') fail('field edit policy must be rw', tag);
    if (del !== 'delete' && del !== 'keep')
      fail('delete policy must be delete or keep', tag);
    return {
      version: 1,
      kind: 'field',
      name,
      fieldType: parseType(type, tag),
      isEditable: true,
      isDeletable: del === 'delete',
      options: parseLegacyOptions(rest, tag)
    };
  }
  if (kind === 'formula') {
    if (fields.length < 7)
      fail('formula tag needs name|type|expression|ro|keep', tag);
    const [, , name, type, expression, policy, del, ...rest] = fields;
    if (!NAME_RE.test(name)) fail(`invalid name ${JSON.stringify(name)}`, tag);
    if (policy !== 'ro') fail('formula edit policy must be ro', tag);
    if (del !== 'keep') fail('formula delete policy must be keep', tag);
    if (!expression) fail('formula needs an expression', tag);
    return {
      version: 1,
      kind: 'formula',
      name,
      fieldType: parseType(type, tag),
      expression: decodeValue(expression),
      isEditable: false,
      isDeletable: false,
      options: parseLegacyOptions(rest, tag)
    };
  }
  return fail(`unknown kind ${JSON.stringify(kind)}`, tag);
}

/* ---------------- canonical key=value (v2) ---------------- */

/**
 * Returns a definition object, or throws TagError. Text that follows neither
 * convention (no key=value pairs, not [[v1|...]]) returns null so foreign
 * content controls are skipped rather than treated as errors.
 */
export function parseTag(tag: unknown): Definition | null {
  if (typeof tag !== 'string' || !tag.startsWith('[[') || !tag.endsWith(']]'))
    return null;
  const body = tag.slice(2, -2);
  const parts = body.split('|');
  if (parts[0] === 'v1') return parseLegacyV1(parts, tag);
  if (!parts.some((part) => part.includes('='))) return null; // another convention

  const pairs: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) fail(`expected key=value, got ${JSON.stringify(part)}`, tag);
    const key = part.slice(0, eq);
    if (!KEYS.has(key)) fail(`unknown key ${JSON.stringify(key)}`, tag);
    if (key in pairs) fail(`duplicate key ${JSON.stringify(key)}`, tag);
    pairs[key] = part.slice(eq + 1);
  }
  if (pairs.v !== undefined && pairs.v !== '2')
    fail(`unsupported version ${JSON.stringify(pairs.v)}`, tag);

  if (pairs.table !== undefined) {
    const extras = Object.keys(pairs).filter(
      (key) => key !== 'table' && key !== 'v'
    );
    if (extras.length)
      fail(`table tags take no other keys (found ${extras.join(', ')})`, tag);
    if (!ID_RE.test(pairs.table)) fail('table id must be [A-Za-z0-9_-]+', tag);
    return { version: 2, kind: 'table', tableId: pairs.table };
  }

  if (pairs.name === undefined) fail('missing name', tag);
  if (!NAME_RE.test(pairs.name))
    fail(`invalid name ${JSON.stringify(pairs.name)}`, tag);

  const options: TagOptions = {};
  for (const key of ['default', 'label', 'row'] as const) {
    if (pairs[key] !== undefined) options[key] = decodeValue(pairs[key]);
  }
  if (options.row !== undefined && !ID_RE.test(options.row))
    fail('row id must be [A-Za-z0-9_-]+', tag);

  if (pairs.expr !== undefined) {
    const expression = decodeValue(pairs.expr);
    if (!expression) fail('expr must not be empty', tag);
    if (pairs.del !== undefined && pairs.del !== 'keep')
      fail('formulas are always del=keep', tag);
    return {
      version: 2,
      kind: 'formula',
      name: pairs.name,
      fieldType:
        pairs.type !== undefined
          ? parseType(pairs.type, tag)
          : DEFAULT_FORMULA_TYPE(),
      expression,
      isEditable: false,
      isDeletable: false,
      options
    };
  }

  const del = pairs.del !== undefined ? pairs.del : 'delete';
  if (del !== 'delete' && del !== 'keep')
    fail('del must be delete or keep', tag);
  return {
    version: 2,
    kind: 'field',
    name: pairs.name,
    fieldType:
      pairs.type !== undefined
        ? parseType(pairs.type, tag)
        : DEFAULT_FIELD_TYPE(),
    isEditable: true,
    isDeletable: del === 'delete',
    options
  };
}

/**
 * Canonical serialization: key order is fixed and default-valued keys are
 * omitted, so semantically equal definitions produce byte-identical tags.
 */
export function formatTag(def: Definition): string {
  if (def.kind === 'table') return `[[table=${def.tableId}]]`;
  const parts = [`name=${def.name}`];
  if (def.kind === 'formula') {
    parts.push(`expr=${encodeValue(def.expression)}`);
    if (formatType(def.fieldType) !== 'currency:USD:2')
      parts.push(`type=${shortTypeString(def.fieldType)}`);
  } else if (def.kind === 'field') {
    if (formatType(def.fieldType) !== 'text')
      parts.push(`type=${shortTypeString(def.fieldType)}`);
    if (!def.isDeletable) parts.push('del=keep');
  } else {
    throw new TagError(
      `cannot format kind ${JSON.stringify((def as Definition).kind)}`
    );
  }
  for (const key of ['default', 'label', 'row'] as const) {
    const value = def.options?.[key];
    if (value !== undefined) parts.push(`${key}=${encodeValue(value)}`);
  }
  return `[[${parts.join('|')}]]`;
}
