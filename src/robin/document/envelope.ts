/**
 * The envelope contract, protocol version 1.
 *
 * Every shape that crosses between the server, which emits document tool calls, and this engine,
 * which executes them: the four verb inputs and their results, the write envelope, the id grammar,
 * the refusal, conflict and uncertain results, the trace, the descriptor and the bridge payload.
 *
 * The section numbers in the comments below are the sections of the frozen contract document
 * ("Robin document model: the envelope contract"), so a reviewer can map each schema to the text
 * it implements. This file implements that document exactly; it does not extend it.
 *
 * Inputs (verb inputs, the bridge payload) are strict: an unknown field is rejected (section 11).
 * Results and the descriptor are loose: a consumer ignores fields it does not know (section 11).
 * Node content is pack-defined and opaque here, except for the core keys of section 2.3.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------
// Section 11. Versioning
// ---------------------------------------------------------------------------------------------

/** The integer naming the section 2 to 10 shapes of the contract as a whole. */
export const PROTOCOL_VERSION = 1 as const;

/** The versions this engine build implements; the descriptor declares the current one. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [
  PROTOCOL_VERSION
];

export function isSupportedProtocolVersion(value: unknown): boolean {
  return (
    typeof value === 'number' && SUPPORTED_PROTOCOL_VERSIONS.includes(value)
  );
}

/**
 * Section 7.1: the core invariant names, declared first because the write-level checks below
 * refuse under them. Every other invariant name is a pack invariant.
 */
export const CORE_INVARIANTS = [
  'envelope',
  'unknown-id',
  'id-shape-mismatch',
  'node-not-one-node',
  'placeholder-call',
  'apply-failed',
  'scope',
  'property-invalid',
  'unknown-format',
  'format-entry-rejected',
  'one-write-per-message',
  'proof-failed'
] as const;
export type CoreInvariant = typeof CORE_INVARIANTS[number];

// ---------------------------------------------------------------------------------------------
// Section 2.1. Id grammar
// ---------------------------------------------------------------------------------------------

export const NODE_ID_PATTERN = /^n[0-9]+$/;
export const FORMAT_ID_PATTERN = /^f[0-9]+$/;
export const TEMP_ID_PATTERN = /^tmp:[a-z0-9][a-z0-9_-]{0,63}$/;
/** The reserved document root: readable, never writable by replace, delete or move. */
export const ROOT_ID = 'root' as const;

export type IdShape = 'node' | 'format' | 'temporary' | 'root';

/** The shape an id string has under the grammar, or null when it has none. */
export function idShape(value: unknown): IdShape | null {
  if (typeof value !== 'string') return null;
  if (NODE_ID_PATTERN.test(value)) return 'node';
  if (FORMAT_ID_PATTERN.test(value)) return 'format';
  if (TEMP_ID_PATTERN.test(value)) return 'temporary';
  if (value === ROOT_ID) return 'root';
  return null;
}

export const isNodeId = (value: unknown): value is string =>
  idShape(value) === 'node';
export const isFormatId = (value: unknown): value is string =>
  idShape(value) === 'format';
export const isTempId = (value: unknown): value is string =>
  idShape(value) === 'temporary';

const COPY_IDS =
  'copy ids exactly as outline, read and find returned them; nodes you create carry no id or a tmp: id';

const nodeIdSchema = z.string().regex(NODE_ID_PATTERN, {
  message: `must be a node id such as n12; ${COPY_IDS}`
});
const formatIdSchema = z.string().regex(FORMAT_ID_PATTERN, {
  message: `must be a format id such as f7; ${COPY_IDS}`
});
const tempIdSchema = z.string().regex(TEMP_ID_PATTERN, {
  message:
    'must be a temporary id: tmp: followed by 1 to 64 of a-z, 0-9, _ and -, starting with a letter or digit'
});
/** An id a change may address: an engine node id, or a temporary id declared earlier in the write. */
const nodeOrTempIdSchema = z
  .string()
  .refine((v) => isNodeId(v) || isTempId(v), {
    message: `must be a node id such as n12 or a temporary id declared earlier in this write; ${COPY_IDS}`
  });
/** An id `read` accepts: a node id, a format id or root. */
const readIdSchema = z
  .string()
  .refine((v) => isNodeId(v) || isFormatId(v) || v === ROOT_ID, {
    message: `must be a node id, a format id or root; ${COPY_IDS}`
  });

// ---------------------------------------------------------------------------------------------
// Section 2.2. The base and shape hashes
// ---------------------------------------------------------------------------------------------

/** Opaque content hashes; equality is the only operation defined on them. */
const baseSchema = z
  .string()
  .min(1, { message: 'must be the base string copied from the read result' })
  .max(128);
const shapeSchema = z
  .string()
  .min(1, { message: 'must be the shape string copied from the read result' })
  .max(128);

// ---------------------------------------------------------------------------------------------
// Section 2.3. Node shape, the core part
// ---------------------------------------------------------------------------------------------

/**
 * Keys the engine emits and the model never writes; a written one is stripped with a warning
 * (sections 2.3 and 6.2).
 */
export const READ_ONLY_NODE_KEYS = [
  'base',
  'shape',
  'pending',
  'usedBy',
  'derived',
  'properties'
] as const;
export type ReadOnlyNodeKey = typeof READ_ONLY_NODE_KEYS[number];

/** Where an effective property value came from, in resolution order (section 4.2). */
export const PROPERTY_SOURCES = [
  'override',
  'container',
  'format',
  'default'
] as const;
export type PropertySource = typeof PROPERTY_SOURCES[number];

const jsonObjectSchema = z.record(z.string(), z.unknown());

const effectivePropertySchema = z.looseObject({
  value: z.unknown(),
  source: z.enum(PROPERTY_SOURCES)
});

/** A node as the engine emits it: core keys fixed, every other key the pack's. */
export const emittedNodeSchema = z.looseObject({
  id: nodeIdSchema.or(z.literal(ROOT_ID)),
  base: baseSchema,
  shape: shapeSchema,
  kind: z.string().min(1),
  pending: jsonObjectSchema.optional(),
  usedBy: z.array(nodeIdSchema).optional(),
  derived: jsonObjectSchema.optional(),
  properties: z.record(z.string(), effectivePropertySchema).optional()
});
export type EmittedNode = z.output<typeof emittedNodeSchema>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A node as the model writes it: exactly one object. An `id` on it or on any nested node must be a
 * node id or a temporary id (section 2.1); `kind` is optional (contract decision 16.3).
 */
const writtenNodeSchema = jsonObjectSchema.superRefine((node, ctx) => {
  const walk = (value: unknown, path: (string | number)[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...path, i]));
      return;
    }
    if (!isPlainObject(value)) return;
    if ('id' in value && !isNodeId(value.id) && !isTempId(value.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'id'],
        message: `must be a node id such as n12 or a temporary id; ${COPY_IDS}`
      });
    }
    if ('kind' in value && typeof value.kind !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'kind'],
        message: 'must be a node kind string when present'
      });
    }
    for (const [key, child] of Object.entries(value)) {
      if ((READ_ONLY_NODE_KEYS as readonly string[]).includes(key)) continue;
      walk(child, [...path, key]);
    }
  };
  walk(node, []);
});
export type WrittenNode = z.output<typeof writtenNodeSchema>;

/**
 * Section 6.2: a written node that carries `pending`, `usedBy`, `derived` or `properties` has those
 * keys stripped, at every depth. Returns a stripped copy and whether anything was stripped.
 */
export function stripReadOnlyKeys<T>(node: T): {
  node: T;
  stripped: ReadOnlyNodeKey[];
} {
  const stripped = new Set<ReadOnlyNodeKey>();
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if ((READ_ONLY_NODE_KEYS as readonly string[]).includes(key)) {
        stripped.add(key as ReadOnlyNodeKey);
        continue;
      }
      out[key] = walk(child);
    }
    return out;
  };
  return { node: walk(node) as T, stripped: [...stripped] };
}

// ---------------------------------------------------------------------------------------------
// Section 3. outline
// ---------------------------------------------------------------------------------------------

export const outlineInputSchema = z.strictObject({
  depth: z.int().min(1).max(6).optional()
});
export type OutlineInput = z.output<typeof outlineInputSchema>;

export const outlineResultSchema = z.looseObject({
  ok: z.literal(true),
  outlineHash: z.string().min(1),
  depth: z.int().min(1).max(6),
  lines: z.string()
});
export type OutlineResult = z.output<typeof outlineResultSchema>;

// ---------------------------------------------------------------------------------------------
// Section 4. read
// ---------------------------------------------------------------------------------------------

export const READ_FORMATS_MODES = ['referenced', 'all', 'none'] as const;
export type ReadFormatsMode = typeof READ_FORMATS_MODES[number];

export const readInputSchema = z.strictObject({
  ids: z.array(readIdSchema).min(1).max(64),
  formats: z.enum(READ_FORMATS_MODES).optional(),
  properties: z.boolean().optional()
});
export type ReadInput = z.output<typeof readInputSchema>;

const emittedFormatSchema = z.looseObject({ base: baseSchema });

export const readResultSchema = z.looseObject({
  ok: z.literal(true),
  outlineHash: z.string().min(1),
  nodes: z.array(emittedNodeSchema),
  formats: z.record(formatIdSchema, emittedFormatSchema),
  missing: z.array(z.string())
});
export type ReadResult = z.output<typeof readResultSchema>;

// ---------------------------------------------------------------------------------------------
// Section 5. find
// ---------------------------------------------------------------------------------------------

/** A section 5.1 query; also the query of a bulk `set` target and of a scope `bulk` entry. */
export const findQuerySchema = z
  .strictObject({
    text: z.string().min(1).max(500).optional(),
    kind: z.string().min(1).optional(),
    feature: z
      .strictObject({
        name: z.string().min(1),
        value: z.string().optional()
      })
      .optional(),
    format: formatIdSchema.optional(),
    within: nodeIdSchema.optional(),
    limit: z.int().min(1).max(200).optional()
  })
  .refine(
    (q) =>
      q.text !== undefined ||
      q.kind !== undefined ||
      q.feature !== undefined ||
      q.format !== undefined,
    { message: 'needs at least one of text, kind, feature or format' }
  );
export type FindInput = z.output<typeof findQuerySchema>;
export const findInputSchema = findQuerySchema;

/** Default and cap for find hits. */
export const FIND_DEFAULT_LIMIT = 40;
export const FIND_SNIPPET_MAX = 90;
export const FIND_WITHIN_MAX = 4;

const spanSchema = z
  .strictObject({
    start: z.int().min(0),
    end: z.int().min(0)
  })
  .refine((s) => s.end > s.start, {
    message: 'end must be greater than start'
  });
export type Span = z.output<typeof spanSchema>;

const findHitSchema = z.looseObject({
  id: nodeIdSchema,
  kind: z.string().min(1),
  within: z.array(nodeIdSchema.or(z.literal(ROOT_ID))).max(FIND_WITHIN_MAX),
  snippet: z.string().max(FIND_SNIPPET_MAX),
  span: z.looseObject({ start: z.int().min(0), end: z.int().min(0) }).optional()
});
export type FindHit = z.output<typeof findHitSchema>;

export const findResultSchema = z.looseObject({
  ok: z.literal(true),
  outlineHash: z.string().min(1),
  hits: z.array(findHitSchema),
  truncated: z.boolean(),
  total: z.int().min(0)
});
export type FindResult = z.output<typeof findResultSchema>;

// ---------------------------------------------------------------------------------------------
// Section 6.3. set targets and property values
// ---------------------------------------------------------------------------------------------

const idsTargetSchema = z.strictObject({
  ids: z.array(nodeOrTempIdSchema).min(1).max(1000),
  shape: z.record(nodeIdSchema, shapeSchema)
});
const matchTargetSchema = z.strictObject({
  id: nodeOrTempIdSchema,
  shape: shapeSchema.optional(),
  match: z.strictObject({
    text: z.string().min(1).max(500),
    span: spanSchema
  })
});
/** Bulk find target. A `limit` in the copied query is ignored: `total` is the acknowledgement. */
const findTargetSchema = z.strictObject({
  find: findQuerySchema,
  total: z.int().min(0)
});
const formatTargetSchema = z.strictObject({
  formatId: formatIdSchema,
  base: baseSchema,
  referrers: z.int().min(0)
});

export const setTargetSchema = z.union([
  idsTargetSchema,
  matchTargetSchema,
  findTargetSchema,
  formatTargetSchema
]);
export type IdsTarget = z.output<typeof idsTargetSchema>;
export type MatchTarget = z.output<typeof matchTargetSchema>;
export type FindTarget = z.output<typeof findTargetSchema>;
export type FormatTarget = z.output<typeof formatTargetSchema>;
export type SetTarget = z.output<typeof setTargetSchema>;

export type SetTargetForm = 'ids' | 'match' | 'find' | 'format';
export function setTargetForm(target: SetTarget): SetTargetForm {
  if ('formatId' in target) return 'format';
  if ('find' in target) return 'find';
  if ('match' in target) return 'match';
  return 'ids';
}

const SET_TARGET_FORMS =
  'target must be exactly one of {ids, shape}, {id, shape, match: {text, span}}, {find, total} or {formatId, base, referrers}';

/** Property values are JSON; `null` clears an override. Names and types are the pack schema's. */
const propsSchema = z
  .record(z.string().min(1), z.unknown())
  .refine((p) => Object.keys(p).length > 0, {
    message: 'props must name at least one property'
  });

// ---------------------------------------------------------------------------------------------
// Section 6.2. Change kinds
// ---------------------------------------------------------------------------------------------

export const CHANGE_KINDS = [
  'replace',
  'insert_before',
  'insert_after',
  'delete',
  'move',
  'set'
] as const;
export type ChangeKind = typeof CHANGE_KINDS[number];

export const MOVE_POSITIONS = ['before', 'after'] as const;

// `base`, `shape` and `container` are optional in the schema and required by the write-level
// check below whenever the id or anchor they belong to is an engine id; a node created earlier in
// the same write has no hash yet. Which hash a change carries follows what it depends on (2.2):
// replace and delete the subtree's `base`; insert the parent's `shape` as `container`; move the
// node's `shape` and the destination parent's `shape` as `container`.
const replaceChangeSchema = z.strictObject({
  kind: z.literal('replace'),
  id: nodeOrTempIdSchema,
  base: baseSchema.optional(),
  node: writtenNodeSchema
});
const insertBeforeChangeSchema = z.strictObject({
  kind: z.literal('insert_before'),
  anchor: nodeOrTempIdSchema,
  container: shapeSchema.optional(),
  node: writtenNodeSchema
});
const insertAfterChangeSchema = z.strictObject({
  kind: z.literal('insert_after'),
  anchor: nodeOrTempIdSchema,
  container: shapeSchema.optional(),
  node: writtenNodeSchema
});
const deleteChangeSchema = z.strictObject({
  kind: z.literal('delete'),
  id: nodeOrTempIdSchema,
  base: baseSchema.optional()
});
const moveChangeSchema = z.strictObject({
  kind: z.literal('move'),
  id: nodeOrTempIdSchema,
  shape: shapeSchema.optional(),
  anchor: nodeOrTempIdSchema,
  position: z.enum(MOVE_POSITIONS),
  container: shapeSchema.optional()
});
const setChangeSchema = z.strictObject({
  kind: z.literal('set'),
  target: setTargetSchema,
  props: propsSchema
});

export const changeSchema = z.discriminatedUnion('kind', [
  replaceChangeSchema,
  insertBeforeChangeSchema,
  insertAfterChangeSchema,
  deleteChangeSchema,
  moveChangeSchema,
  setChangeSchema
]);
export type ReplaceChange = z.output<typeof replaceChangeSchema>;
export type InsertBeforeChange = z.output<typeof insertBeforeChangeSchema>;
export type InsertAfterChange = z.output<typeof insertAfterChangeSchema>;
export type InsertChange = InsertBeforeChange | InsertAfterChange;
export type DeleteChange = z.output<typeof deleteChangeSchema>;
export type MoveChange = z.output<typeof moveChangeSchema>;
export type SetChange = z.output<typeof setChangeSchema>;
export type Change = z.output<typeof changeSchema>;

// ---------------------------------------------------------------------------------------------
// Section 6.4. Scope
// ---------------------------------------------------------------------------------------------

export const scopeSchema = z.strictObject({
  ids: z.array(nodeIdSchema).max(10000),
  bulk: z.array(findTargetSchema).optional(),
  formats: z
    .array(
      z.strictObject({
        id: formatIdSchema,
        referrers: z.int().min(0)
      })
    )
    .optional()
});
export type Scope = z.output<typeof scopeSchema>;

// ---------------------------------------------------------------------------------------------
// Section 6.1. Envelope
// ---------------------------------------------------------------------------------------------

export const WRITE_CHANGES_MAX = 256;
export const INTENT_MAX = 400;

const writeShapeSchema = z.strictObject({
  intent: z.string().min(1).max(INTENT_MAX),
  scope: scopeSchema,
  formats: z.record(tempIdSchema, jsonObjectSchema).optional(),
  changes: z.array(changeSchema).min(1).max(WRITE_CHANGES_MAX),
  dryRun: z.boolean().optional()
});

/** Temporary ids a written node declares on itself and its nested nodes, in document order. */
export function declaredTempIds(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!isPlainObject(value)) return;
    if (isTempId(value.id)) out.push(value.id);
    for (const [key, child] of Object.entries(value)) {
      if ((READ_ONLY_NODE_KEYS as readonly string[]).includes(key)) continue;
      walk(child);
    }
  };
  walk(node);
  return out;
}

/** Ids a change addresses (not the ids inside its written node). */
export function addressedIds(change: Change): string[] {
  switch (change.kind) {
    case 'replace':
    case 'delete':
      return [change.id];
    case 'insert_before':
    case 'insert_after':
      return [change.anchor];
    case 'move':
      return [change.id, change.anchor];
    case 'set': {
      const t = change.target;
      if ('ids' in t) return [...t.ids];
      if ('match' in t) return [t.id];
      return [];
    }
  }
}

/**
 * The write-level rules the shapes alone cannot state:
 * - replace and delete of an engine id carry its `base`, move and the match-span `set` carry its
 *   `shape`, and a change placing a node next to an engine anchor carries `container` (2.2, 6.2);
 * - an ids-form `set` carries a `shape` for every engine id it names and for nothing else;
 * - a temporary id is declared once, on a node or as a `formats` key, and is used as an id, anchor or
 *   target only after the change that declares it (sections 2.1, 6.2).
 */
const writeInputSchema = writeShapeSchema.superRefine((write, ctx) => {
  const declared = new Set<string>(Object.keys(write.formats ?? {}));
  const issue = (
    path: (string | number)[],
    message: string,
    invariant: CoreInvariant = 'envelope'
  ) => ctx.addIssue({ code: 'custom', path, message, params: { invariant } });

  write.changes.forEach((change, index) => {
    const at = ['changes', index];
    const used = addressedIds(change);
    for (const id of used) {
      if (isTempId(id) && !declared.has(id)) {
        issue(
          at,
          `${id} is not declared by an earlier change in this write; a temporary id is declared on a node a change writes, then used by later changes`,
          'unknown-id'
        );
      }
    }
    if (
      (change.kind === 'replace' || change.kind === 'delete') &&
      isNodeId(change.id) &&
      change.base === undefined
    ) {
      issue(
        [...at, 'base'],
        `${change.kind} of ${change.id} must carry the base read for it`
      );
    }
    if (
      change.kind === 'move' &&
      isNodeId(change.id) &&
      change.shape === undefined
    ) {
      issue(
        [...at, 'shape'],
        `move of ${change.id} must carry the shape read for it`
      );
    }
    if (
      (change.kind === 'insert_before' ||
        change.kind === 'insert_after' ||
        change.kind === 'move') &&
      isNodeId(change.anchor) &&
      change.container === undefined
    ) {
      issue(
        [...at, 'container'],
        `${change.kind} next to ${change.anchor} must carry container, the shape of the node that owns the list ${change.anchor} is in`
      );
    }
    if (change.kind === 'set') {
      const t = change.target;
      if ('ids' in t) {
        for (const id of t.ids) {
          if (isNodeId(id) && !(id in t.shape)) {
            issue([...at, 'target', 'shape'], `shape has no entry for ${id}`);
          }
        }
        for (const id of Object.keys(t.shape)) {
          if (!t.ids.includes(id)) {
            issue(
              [...at, 'target', 'shape'],
              `shape names ${id}, which is not in ids`
            );
          }
        }
      } else if ('match' in t && isNodeId(t.id) && t.shape === undefined) {
        issue(
          [...at, 'target', 'shape'],
          `set on ${t.id} must carry the shape read for it`
        );
      }
    }
    if (
      change.kind !== 'delete' &&
      change.kind !== 'move' &&
      change.kind !== 'set'
    ) {
      for (const id of declaredTempIds(change.node)) {
        if (declared.has(id)) {
          issue([...at, 'node'], `${id} is declared twice in this write`);
        }
        declared.add(id);
      }
    }
  });
});
export type WriteInput = z.output<typeof writeShapeSchema>;

// ---------------------------------------------------------------------------------------------
// Section 7. Failure results shared by every verb
// ---------------------------------------------------------------------------------------------

export const RETRY_VERBS = [
  'same_input',
  'modified_input',
  'patch_input',
  'do_not_retry'
] as const;
export type RetryVerb = typeof RETRY_VERBS[number];

export const ERROR_CODES = {
  refused: 'document.refused',
  conflict: 'document.conflict',
  uncertain: 'document.uncertain',
  readOnly: 'document.read_only',
  wrongEditor: 'document.wrong_editor'
} as const;
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

const errorSchema = z.looseObject({
  code: z.string().min(1),
  message: z.string()
});

const refusalProblemSchema = z.looseObject({
  invariant: z.string().min(1),
  destroyed: z.string(),
  detail: z.unknown(),
  retry: z.enum(RETRY_VERBS),
  read: z.array(z.string()),
  hint: z.string().optional()
});
export type RefusalProblem = {
  invariant: string;
  destroyed: string;
  detail: unknown;
  retry: RetryVerb;
  read: string[];
  hint?: string;
};

export const refusalSchema = refusalProblemSchema.extend({
  problems: z.array(refusalProblemSchema).optional()
});
export type Refusal = RefusalProblem & { problems?: RefusalProblem[] };

// Section 8 is needed by the write results; it is declared here, before them.

export const VERIFIED_OUTCOMES = ['passed', 'refused', 'conflict'] as const;
export const COMMITTED_OUTCOMES = [
  'committed',
  'skipped',
  'rolled-back'
] as const;
/** `skipped` when nothing was committed to prove (a dry run, a refusal, a conflict). */
export const PROOF_OUTCOMES = ['passed', 'failed', 'skipped'] as const;

export const traceSchema = z.looseObject({
  protocolVersion: z.int(),
  format: z.string().min(1),
  turnId: z.string().min(1),
  requested: z.looseObject({
    changes: z.int().min(0),
    kinds: z.record(z.string(), z.int().min(0)),
    scopeIds: z.int().min(0),
    bulk: z.int().min(0),
    formats: z.int().min(0),
    dryRun: z.boolean()
  }),
  verified: z.looseObject({
    outcome: z.enum(VERIFIED_OUTCOMES),
    checks: z.array(
      z.looseObject({ name: z.string().min(1), pass: z.boolean() })
    ),
    ms: z.number().min(0)
  }),
  committed: z.looseObject({
    outcome: z.enum(COMMITTED_OUTCOMES),
    seams: z.array(z.string()),
    touched: z.int().min(0),
    ms: z.number().min(0)
  }),
  proof: z.looseObject({
    outcome: z.enum(PROOF_OUTCOMES),
    landed: z.boolean(),
    reversible: z.boolean(),
    normalizations: z.array(z.string()),
    rollback: z.looseObject({ byteEqual: z.boolean() }).nullable(),
    ms: z.number().min(0)
  }),
  timing: z.looseObject({ totalMs: z.number().min(0) })
});
export type Trace = z.output<typeof traceSchema>;

export const refusedResultSchema = z.looseObject({
  ok: z.literal(false),
  error: errorSchema.extend({ code: z.literal(ERROR_CODES.refused) }),
  retry: z.enum(RETRY_VERBS),
  refusal: refusalSchema,
  trace: traceSchema.optional()
});
export type RefusedResult = {
  ok: false;
  error: { code: typeof ERROR_CODES.refused; message: string };
  retry: RetryVerb;
  refusal: Refusal;
  trace?: Trace;
};

// Section 7.2. Conflict
/** The carried hash is repeated under its own name, `base` or `shape`; `live` carries both. */
const staleEntrySchema = z
  .looseObject({
    id: nodeIdSchema.or(z.literal(ROOT_ID)),
    base: z.string().optional(),
    shape: z.string().optional(),
    live: emittedNodeSchema.nullable()
  })
  .refine((e) => (e.base === undefined) !== (e.shape === undefined), {
    message: 'a stale entry repeats exactly one carried hash, base or shape'
  });
const bulkConflictSchema = z.looseObject({
  find: z.unknown(),
  total: z.int().min(0),
  live: z.int().min(0)
});
const formatConflictSchema = z.looseObject({
  id: formatIdSchema,
  base: z.string(),
  referrers: z.int().min(0),
  live: z.int().min(0),
  liveBase: z.string(),
  liveEntry: emittedFormatSchema
});

export const conflictResultSchema = z.looseObject({
  ok: z.literal(false),
  error: errorSchema.extend({ code: z.literal(ERROR_CODES.conflict) }),
  retry: z.enum(RETRY_VERBS),
  conflict: z.looseObject({
    stale: z.array(staleEntrySchema),
    bulk: z.array(bulkConflictSchema),
    formats: z.array(formatConflictSchema),
    outlineHash: z.string().min(1)
  }),
  trace: traceSchema.optional()
});
/** `live` is null when the node was removed since it was read. */
export type ConflictResult = z.output<typeof conflictResultSchema>;
export type StaleEntry = z.output<typeof staleEntrySchema>;

// Section 7.3. Uncertain outcome (server-produced; typed here so both sides share it)
export const uncertainResultSchema = z.looseObject({
  ok: z.literal(false),
  error: errorSchema.extend({ code: z.literal(ERROR_CODES.uncertain) }),
  retry: z.literal('do_not_retry'),
  recovery: z.string()
});
export type UncertainResult = z.output<typeof uncertainResultSchema>;

// Section 7.4. Not mounted, read-only, wrong editor
export const plainFailureSchema = z.looseObject({
  ok: z.literal(false),
  error: errorSchema.extend({
    code: z.enum([ERROR_CODES.readOnly, ERROR_CODES.wrongEditor])
  }),
  retry: z.literal('do_not_retry')
});
export type PlainFailure = z.output<typeof plainFailureSchema>;

export function readOnlyResult(): PlainFailure {
  return {
    ok: false,
    error: {
      code: ERROR_CODES.readOnly,
      message: 'The document is read-only; it can be read but not changed.'
    },
    retry: 'do_not_retry'
  };
}

export function wrongEditorResult(): PlainFailure {
  return {
    ok: false,
    error: {
      code: ERROR_CODES.wrongEditor,
      message:
        'The request named a different editor or target than the one mounted.'
    },
    retry: 'do_not_retry'
  };
}

// ---------------------------------------------------------------------------------------------
// Section 6.5. Success result
// ---------------------------------------------------------------------------------------------

export const LANDED_VALUES = ['card', 'immediate', 'none'] as const;
export type Landed = typeof LANDED_VALUES[number];

/** Core fact kinds; adding one is not breaking (section 11). */
export const CORE_FACT_KINDS = [
  'inserted',
  'deleted',
  'replaced',
  'moved',
  'set',
  'finalizer'
] as const;
export type CoreFactKind = typeof CORE_FACT_KINDS[number];

/** Core warning codes; a pack may add codes, which the model treats as text. */
export const CORE_WARNING_CODES = [
  'undo-history-cleared',
  'immediate-not-tracked',
  'stripped-read-only'
] as const;
export type CoreWarningCode = typeof CORE_WARNING_CODES[number];

const factSchema = z.looseObject({
  kind: z.string().min(1),
  ids: z.array(z.string()),
  summary: z.string(),
  name: z.string().optional()
});
export type Fact = {
  kind: string;
  ids: string[];
  summary: string;
  name?: string;
};

const warningSchema = z.looseObject({
  code: z.string().min(1),
  message: z.string()
});
export type Warning = {
  code: string;
  message: string;
};

const finalizerScopeSchema = z.looseObject({
  name: z.string().min(1),
  ids: z.array(nodeIdSchema.or(z.literal(ROOT_ID)))
});
export type FinalizerScope = { name: string; ids: string[] };

export const writeSuccessResultSchema = z.looseObject({
  ok: z.literal(true),
  committed: z.boolean(),
  dryRun: z.boolean(),
  cardId: z.string().min(1).nullable(),
  landed: z.enum(LANDED_VALUES),
  outlineHash: z.string().min(1),
  mapping: z.record(
    tempIdSchema,
    z.string().refine((v) => isNodeId(v) || isFormatId(v))
  ),
  touched: z.array(nodeIdSchema.or(z.literal(ROOT_ID))),
  finalizerScope: z.array(finalizerScopeSchema),
  facts: z.array(factSchema),
  warnings: z.array(warningSchema),
  trace: traceSchema
});
export type WriteSuccessResult = Omit<
  z.output<typeof writeSuccessResultSchema>,
  'facts' | 'warnings' | 'finalizerScope'
> & { facts: Fact[]; warnings: Warning[]; finalizerScope: FinalizerScope[] };

// ---------------------------------------------------------------------------------------------
// Verbs: inputs and results by verb (sections 3 to 7)
// ---------------------------------------------------------------------------------------------

export const VERBS = ['outline', 'read', 'find', 'write'] as const;
export type Verb = typeof VERBS[number];

export interface VerbInputs {
  outline: OutlineInput;
  read: ReadInput;
  find: FindInput;
  write: WriteInput;
}

export type FailureResult =
  | RefusedResult
  | ConflictResult
  | UncertainResult
  | PlainFailure;

export interface VerbResults {
  outline: OutlineResult | FailureResult;
  read: ReadResult | FailureResult;
  find: FindResult | FailureResult;
  write: WriteSuccessResult | FailureResult;
}
export type VerbResult = VerbResults[Verb];

const verbInputSchemas = {
  outline: outlineInputSchema,
  read: readInputSchema,
  find: findInputSchema,
  write: writeInputSchema
} as const;

const verbSuccessSchemas = {
  outline: outlineResultSchema,
  read: readResultSchema,
  find: findResultSchema,
  write: writeSuccessResultSchema
} as const;

const failureResultSchema = z.union([
  refusedResultSchema,
  conflictResultSchema,
  uncertainResultSchema,
  plainFailureSchema
]);

/** Validate a verb result against the result contract (what the server does with every result). */
export function validateVerbResult(
  verb: Verb,
  result: unknown
): { ok: true } | { ok: false; issues: string[] } {
  const schema =
    isPlainObject(result) && result.ok === true
      ? verbSuccessSchemas[verb]
      : failureResultSchema;
  const parsed = schema.safeParse(result);
  return parsed.success
    ? { ok: true }
    : { ok: false, issues: parsed.error.issues.map(describeIssue) };
}

// ---------------------------------------------------------------------------------------------
// Input parsing: a schema failure becomes a section 7.1 refusal
// ---------------------------------------------------------------------------------------------

function formatPath(path: PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || '(input)';
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const part of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[part as string];
  }
  return cur;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const where = formatPath(issue.path);
  if (issue.code === 'unrecognized_keys') {
    return `${where}: unknown field(s) ${issue.keys
      .map((k) => JSON.stringify(k))
      .join(', ')}`;
  }
  if (
    issue.code === 'invalid_union' &&
    issue.path[issue.path.length - 1] === 'target'
  ) {
    return `${where}: ${SET_TARGET_FORMS}`;
  }
  if (
    issue.code === 'invalid_union' &&
    issue.path[issue.path.length - 1] === 'kind'
  ) {
    return `${where}: must be one of ${CHANGE_KINDS.join(', ')}`;
  }
  return `${where}: ${issue.message}`;
}

/** The invariant an input issue refuses under. */
function classifyIssue(issue: z.core.$ZodIssue, input: unknown): CoreInvariant {
  const params = (issue as { params?: { invariant?: CoreInvariant } }).params;
  if (params?.invariant) return params.invariant;
  const last = issue.path[issue.path.length - 1];
  if (last === 'node' && issue.path[0] === 'changes') {
    const value = valueAt(input, issue.path);
    if (Array.isArray(value)) return 'node-not-one-node';
    if (value === null || value === undefined) return 'placeholder-call';
    if (!isPlainObject(value)) return 'node-not-one-node';
  }
  if (issue.path.length === 1 && last === 'changes') {
    const value = valueAt(input, issue.path);
    if (Array.isArray(value) && value.length === 0) return 'placeholder-call';
  }
  return 'envelope';
}

const INVARIANT_HINTS: Partial<Record<CoreInvariant, string>> = {
  envelope:
    'Send the input exactly in the documented shape; every id copied from outline, read or find as given.',
  'unknown-id':
    'Copy every id from outline, read or find exactly as given; a temporary id is declared on a node an earlier change writes.',
  'node-not-one-node':
    'Send one node per change; several siblings are several changes on the same anchor, landing in the order listed.',
  'placeholder-call':
    'Carry out the request with real changes; declining is a reply, not a write.'
};

/** Build a section 7.1 refusal from one or more problems; the top level summarises the first. */
export function makeRefusal(problems: RefusalProblem[]): Refusal {
  if (!problems.length)
    throw new Error('makeRefusal needs at least one problem');
  const [first] = problems;
  return {
    ...first,
    ...(problems.length > 1 ? { problems } : {})
  };
}

export function refusedResult(refusal: Refusal, trace?: Trace): RefusedResult {
  return {
    ok: false,
    error: { code: ERROR_CODES.refused, message: refusal.destroyed },
    retry: refusal.retry,
    refusal,
    ...(trace ? { trace } : {})
  };
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: Refusal };

/**
 * Validate a verb input against the contract. A failure is a refusal grouped by invariant, each
 * carrying every offending path; nothing is applied (section 7.1).
 */
export function parseVerbInput<V extends Verb>(
  verb: V,
  input: unknown
): ParseResult<VerbInputs[V]> {
  const schema = verbInputSchemas[verb] as unknown as z.ZodType<VerbInputs[V]>;
  const problems: RefusalProblem[] = [];
  const byInvariant = new Map<CoreInvariant, string[]>();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const invariant = classifyIssue(issue, input);
      const list = byInvariant.get(invariant) ?? [];
      list.push(describeIssue(issue));
      byInvariant.set(invariant, list);
    }
  }
  if (!byInvariant.size && parsed.success)
    return { ok: true, value: parsed.data };
  for (const [invariant, details] of byInvariant) {
    problems.push({
      invariant,
      destroyed: `Nothing was applied: the ${verb} input is invalid at ${
        details[0]
      }${details.length > 1 ? ` (and ${details.length - 1} more)` : ''}.`,
      detail: details,
      retry: 'modified_input',
      read: [],
      ...(INVARIANT_HINTS[invariant]
        ? { hint: INVARIANT_HINTS[invariant] }
        : {})
    });
  }
  return { ok: false, refusal: makeRefusal(problems) };
}

// ---------------------------------------------------------------------------------------------
// Section 9. The descriptor
// ---------------------------------------------------------------------------------------------

export const SELECTION_TEXT_MAX = 500;

const targetSchema = z.looseObject({
  type: z.string().min(1),
  id: z.string().min(1)
});
export type HostTarget = { type: string; id: string };

const selectionPointSchema = z.looseObject({
  id: nodeIdSchema,
  offset: z.int().min(0)
});

export const selectionSchema = z.looseObject({
  start: selectionPointSchema,
  end: selectionPointSchema,
  text: z.string().max(SELECTION_TEXT_MAX),
  truncated: z.boolean()
});
export type Selection = z.output<typeof selectionSchema>;

export const descriptorSchema = z.looseObject({
  protocolVersion: z.int(),
  editorId: z.string().min(1),
  target: targetSchema,
  format: z.string().min(1),
  readOnly: z.boolean(),
  outlineHash: z.string().min(1),
  selection: selectionSchema.optional()
});
export type Descriptor = {
  protocolVersion: number;
  editorId: string;
  target: HostTarget;
  format: string;
  readOnly: boolean;
  outlineHash: string;
  selection?: Selection;
};

// ---------------------------------------------------------------------------------------------
// Section 10. The bridge action
// ---------------------------------------------------------------------------------------------

/** The bridge action name; the bridge envelope around the payload is the existing one. */
export const BRIDGE_ACTION = 'document_tool' as const;

/**
 * Section 10.1. The input is validated per verb by `parseVerbInput`, so an invalid input becomes a
 * refusal (bridge status ok) rather than a dispatch error.
 */
export const bridgePayloadSchema = z.strictObject({
  protocolVersion: z.int(),
  turnId: z.string().min(1).max(256),
  editorId: z.string().min(1),
  target: z.strictObject({ type: z.string().min(1), id: z.string().min(1) }),
  verb: z.enum(VERBS),
  input: z.unknown()
});
export type BridgePayload = Omit<
  z.output<typeof bridgePayloadSchema>,
  'input'
> & {
  input: unknown;
};

/** Section 10.2. */
export const bridgeResponseSchema = z.looseObject({
  editorId: z.string().min(1),
  target: targetSchema,
  outlineHash: z.string().min(1),
  result: z.looseObject({ ok: z.boolean() })
});
export type BridgeResponse = {
  editorId: string;
  target: HostTarget;
  outlineHash: string;
  result: VerbResult;
};

/** Transport and dispatch failures, reported as bridge status error (section 10.2). */
export type DispatchFailure =
  | { reason: 'payload-invalid'; message: string }
  | { reason: 'protocol-unsupported'; message: string }
  | { reason: 'wrong-editor'; message: string }
  | { reason: 'handler-exception'; message: string };

export function parseBridgePayload(
  raw: unknown
):
  | { ok: true; value: BridgePayload }
  | { ok: false; failure: DispatchFailure } {
  const parsed = bridgePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        reason: 'payload-invalid',
        message: parsed.error.issues.map(describeIssue).join('; ')
      }
    };
  }
  if (!isSupportedProtocolVersion(parsed.data.protocolVersion)) {
    return {
      ok: false,
      failure: {
        reason: 'protocol-unsupported',
        message: `protocolVersion ${
          parsed.data.protocolVersion
        } is not supported; this engine implements ${SUPPORTED_PROTOCOL_VERSIONS.join(
          ', '
        )}`
      }
    };
  }
  return { ok: true, value: parsed.data };
}

/** Section 10.1: the form rechecks the editor id and target against the mounted editor. */
export function sameEditor(
  payload: Pick<BridgePayload, 'editorId' | 'target'>,
  mounted: { editorId: string; target: HostTarget }
): boolean {
  return (
    payload.editorId === mounted.editorId &&
    payload.target.type === mounted.target.type &&
    payload.target.id === mounted.target.id
  );
}
