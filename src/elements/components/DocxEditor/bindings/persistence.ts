// Document persistence, expressed as the contract the controller needs rather
// than the storage the product happens to use.
//
// The revision rule is the point: a save carries the revision it was based on,
// and a mismatch is reported as a conflict instead of overwriting whatever
// arrived in between. feathery-react persists envelopes as .docx blobs today, so
// nothing here is wired to the product yet - the interface exists so the
// controller can be tested against it, and so a backend that versions documents
// can be dropped in without touching the controller.

import { SfdtDocument } from './core/sfdtTypes';

export interface LoadedDocument {
  sfdt: SfdtDocument;
  revision: number;
  schemaVersion?: number;
}

export interface SaveSucceeded {
  ok: true;
  revision: number;
}

export interface SaveConflicted {
  ok: false;
  conflict: true;
  currentRevision: number;
}

export type SaveResult = SaveSucceeded | SaveConflicted;

export interface DocumentPersistence {
  load(): LoadedDocument | null;
  save(sfdt: SfdtDocument, baseRevision: number): Promise<SaveResult>;
}

/** The subset of Storage this needs, so tests can pass a Map-backed fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SCHEMA_VERSION = 1;

/**
 * A revisioned persistence stub. Useful for local development and as the
 * reference implementation of the conflict rule; a real backend replaces it.
 */
export class LocalStoragePersistence implements DocumentPersistence {
  private readonly key: string;

  private readonly storage: KeyValueStorage;

  constructor(key: string, storage?: KeyValueStorage) {
    this.key = key;
    const fallback = (globalThis as any).localStorage as
      | KeyValueStorage
      | undefined;
    const resolved = storage ?? fallback;
    if (!resolved)
      throw new Error('LocalStoragePersistence needs a storage implementation');
    this.storage = resolved;
  }

  load(): LoadedDocument | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    const envelope = JSON.parse(raw);
    return {
      sfdt: envelope.sfdt,
      revision: envelope.revision,
      schemaVersion: envelope.schema_version
    };
  }

  async save(sfdt: SfdtDocument, baseRevision: number): Promise<SaveResult> {
    const existing = this.storage.getItem(this.key);
    const current = existing ? JSON.parse(existing).revision : 0;
    // Someone else advanced the document since this editor loaded it. Report it
    // rather than clobbering their work.
    if (current !== baseRevision) {
      return { ok: false, conflict: true, currentRevision: current };
    }
    const revision = current + 1;
    this.storage.setItem(
      this.key,
      JSON.stringify({ schema_version: SCHEMA_VERSION, revision, sfdt })
    );
    return { ok: true, revision };
  }
}
