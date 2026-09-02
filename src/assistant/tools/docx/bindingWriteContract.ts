/**
 * Shared frontend/ai-services contract for document-binding writes.
 *
 * This repo OWNS these shapes; ai-services re-declares them as Zod in
 * `src/modules/assistant/schema.ts` and parses the payloads at its tool
 * boundary. The two copies are kept in step by hand, so adding, renaming, or
 * removing a field here is a breaking wire change that must land with the
 * matching schema edit. Both sides are pinned by tests - `boundDuplicateTable`
 * here, `bindingWriteContract.test.ts` there - so drift fails a build rather
 * than a customer conversation.
 *
 * Inventory reads expose `BindingWireIdentity`: only `global: true` proves that
 * several occurrences deliberately share one document-wide identity. Equal
 * labels or related non-global ids are not permission to update them together.
 * An ambiguous write returns `BindingWriteAmbiguity` without mutating the
 * document. After the user chooses, ai-services resends one `set_cell_text`
 * operation with the returned ambiguity id and a `BindingWriteResolution`;
 * the client revalidates that id against the live document before applying the
 * selected instance or all listed instances atomically. The original operation
 * anchor identifies the ambiguous field family; `instanceId` identifies the
 * instance selected by the user.
 */

export interface BindingWireIdentity {
  /** The binding id stored in the content-control tag (`name=...`). */
  id: string;
  /** True only for an explicit `global=true` tag. */
  global: boolean;
}

export interface BindingOccurrenceChoice {
  /** Stable for this document shape; use the enclosing instance id to choose. */
  occurrenceId: string;
  bindingId: string;
  value: string;
  /** Human-readable placement suitable for a disambiguation prompt. */
  location: string;
  tableId?: string;
  documentPath: string;
}

export interface BindingInstanceChoice {
  /** Value sent back as `instanceId` when the user chooses one instance. */
  instanceId: string;
  identity: BindingWireIdentity;
  occurrences: BindingOccurrenceChoice[];
}

export interface BindingWriteAmbiguity {
  kind: 'binding_write';
  /** Opaque live-document fingerprint; stale confirmations are refused. */
  ambiguityId: string;
  field: string;
  instanceCount: number;
  occurrenceCount: number;
  instances: BindingInstanceChoice[];
}

export type BindingWriteResolution =
  | { ambiguityId: string; choice: 'all' }
  | { ambiguityId: string; choice: 'one'; instanceId: string };
