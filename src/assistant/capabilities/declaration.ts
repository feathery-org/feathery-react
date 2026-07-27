import {
  FULL_INVENTORY_BLOCK_LIMIT,
  MAX_LIVE_OCCURRENCE_QUERIES,
  MAX_LIVE_OCCURRENCES_PER_QUERY
} from '../tools/syncfusionDocumentOps';
import {
  CapabilityEntry,
  DOCUMENT_EDITOR_CAPABILITIES,
  DOCUMENT_EDITOR_READS,
  ReadCapabilityEntry
} from './registry';

// The wire form of the declaration, sent as `context.capabilities` on every
// assistant chat request from a document-editor surface and forwarded verbatim
// by the backend to ai-services.
//
// It must be canonically serialised and byte-stable turn to turn: the
// declaration lands inside the model prompt, so any nondeterminism (map
// iteration order, timestamps, per-request values) would change the prompt
// bytes every turn and silently destroy prompt-cache hits. Stability comes
// from construction: everything below is built from literals in fixed key
// order, `JSON.stringify` preserves insertion order for string keys, and a
// unit test asserts two consecutive builds serialise to identical bytes.
export interface CapabilitiesDeclaration {
  version: string;
  surfaces: Array<{
    surface: string;
    // Package name only, no version: production loads SyncFusion from a CDN,
    // so the build-time dependency version is not the runtime truth. The
    // runtime capability probe that can honestly report the served version is
    // S5 work.
    engine: string;
    anchorScheme: string;
    limits: {
      fullInventoryBlocks: number;
      liveSearchQueries: number;
      liveOccurrencesPerQuery: number;
    };
    // The retrieval legs, cheapest first (S3): the declared counterpart of the
    // ops list, so what the client can READ is as visible as what it can edit.
    reads: ReadCapabilityEntry[];
    ops: CapabilityEntry[];
  }>;
}

export function buildCapabilitiesDeclaration(): CapabilitiesDeclaration {
  return {
    version: '1',
    surfaces: [
      {
        surface: 'document_editor',
        engine: 'syncfusion/ej2-documenteditor',
        anchorScheme: 'section;block[;row;cell;paragraph], 0-based',
        limits: {
          fullInventoryBlocks: FULL_INVENTORY_BLOCK_LIMIT,
          liveSearchQueries: MAX_LIVE_OCCURRENCE_QUERIES,
          liveOccurrencesPerQuery: MAX_LIVE_OCCURRENCES_PER_QUERY
        },
        reads: DOCUMENT_EDITOR_READS.map((entry) => ({ ...entry })),
        ops: DOCUMENT_EDITOR_CAPABILITIES.map((entry) => ({ ...entry }))
      }
    ]
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// The single instance chat requests send. Frozen so nothing can mutate it
// between turns and break the byte-stability guarantee.
export const CAPABILITIES_DECLARATION: CapabilitiesDeclaration = deepFreeze(
  buildCapabilitiesDeclaration()
);
