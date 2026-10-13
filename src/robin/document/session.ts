/**
 * One session per mounted document: the engine's whole state for that editor and the one entry
 * point the form dispatches to.
 *
 * The session holds the current normal form with its residue and engine ids, re-read from the
 * editor before every verb so the virtual document is the live one; the engine's history stack;
 * and the per-turn write journal. `dispatch` takes a bridge payload (contract section 10) and
 * returns the bridge response or a dispatch failure; `descriptor` is what the form sends in
 * request context (section 9).
 */
import {
  Descriptor,
  DispatchOutcome,
  ERROR_CODES,
  HostTarget,
  PROTOCOL_VERSION,
  Selection,
  Verb,
  VerbResult,
  WriteInput,
  makeRefusal,
  dispatchFailure,
  parseBridgePayload,
  parseVerbInput,
  readOnlyResult,
  refusedResult,
  sameEditor
} from './envelope';
import { ENGINE_HISTORY_LIMIT, EngineHistory, HistoryOutcome } from './history';
import { IdTable } from './ids';
import { WriteJournal } from './loop';
import { renderOutline } from './outline';
import type { EditorHost, Pack, Residue } from './pack';
import { logDebug, logError, logWarn, truncatedDetail } from './log';
import { equivalentNative } from './proof';
import { reconcile } from './reconciler';
import { Clock, defaultClock, TraceBuilder } from './trace';
import type { NormalForm } from './tree';
import { problem } from './verifier';
import { conflictMessage } from './verifier/base';
import {
  DocumentState,
  findVerb,
  outlineVerb,
  prepareWrite,
  readVerb
} from './verbs';
import { makeView } from './view';

export interface SessionOptions {
  pack: Pack;
  host: EditorHost;
  /** What the form mounted, as the descriptor names it. */
  target: HostTarget;
  /** Stable for the life of the mount; a remount is a new session with a new id. */
  editorId?: string;
  clock?: Clock;
  history?: EngineHistory;
  /**
   * Called when an editing turn starts (the turn's first write) and when the form finishes it,
   * with null. The host uses it to tell Robin's selection moves from the user's while a turn runs.
   */
  onTurnChange?: (turnId: string | null) => void;
  /**
   * Runs each write's commit, so the host can mark the editor's own change events during it as
   * Robin's (version history attributes them). Without it the commit simply runs.
   */
  writing?: <T>(commit: () => T) => T;
  /**
   * The engine replaced the document whole, which the editor reports no change event for:
   * `robin` for a write (called inside `writing`), `person` for a card they resolved or an undo or
   * redo through the engine's history. The host runs its change handling as for any edit.
   */
  onReplaced?: (by: 'robin' | 'person') => void;
  /**
   * The write journal (contract 10.3). The form shares one per form session, so a resent write
   * finds its record after the editor remounted; without it the session keeps its own.
   */
  journal?: WriteJournal<VerbResult>;
}

export type { DispatchOutcome };

let mounts = 0;
/** A new editor id: stable for the life of a mount, unique across mounts. */
export const newEditorId = (): string => {
  mounts += 1;
  return `ed-${Date.now().toString(36)}-${mounts}`;
};

export class DocumentSession {
  readonly editorId: string;

  readonly target: HostTarget;

  readonly pack: Pack;

  readonly host: EditorHost;

  readonly history: EngineHistory;

  private readonly clock: Clock;

  private readonly ids = new IdTable();

  private readonly journal: WriteJournal<VerbResult>;

  private native = '';

  private current: DocumentState | null = null;

  private turn: string | null = null;

  /** Cards this session committed by replacing the document: the engine resolves them. */
  private readonly structural = new Set<string>();

  private readonly onTurnChange?: (turnId: string | null) => void;

  private readonly writing: <T>(commit: () => T) => T;

  private readonly onReplaced?: (by: 'robin' | 'person') => void;

  constructor(options: SessionOptions) {
    this.pack = options.pack;
    this.host = options.host;
    this.target = { ...options.target };
    this.editorId = options.editorId ?? newEditorId();
    this.clock = options.clock ?? defaultClock;
    this.onTurnChange = options.onTurnChange;
    this.writing = options.writing ?? ((commit) => commit());
    this.onReplaced = options.onReplaced;
    this.journal = options.journal ?? new WriteJournal<VerbResult>();
    this.history =
      options.history ??
      new EngineHistory(ENGINE_HISTORY_LIMIT, (a, b) =>
        equivalentNative(this.pack, a, b)
      );
    this.adopt(this.host.serialize(), []);
  }

  /** The current state of the virtual document, after reading the editor. */
  get state(): DocumentState {
    this.refresh();
    return this.current as DocumentState;
  }

  /** Bring the virtual document up to date with the editor; ids continue across user edits. */
  refresh(): void {
    const native = this.host.serialize();
    if (this.current && native === this.native) return;
    this.adopt(native, this.current ? [this.current.view.nf] : []);
  }

  private adopt(native: string, previous: NormalForm[]): void {
    const { pack } = this;
    this.install(
      native,
      this.ids.adopt(
        pack.adapter.toNormalForm(native),
        pack.tree,
        pack.formatRefKeys,
        previous
      )
    );
  }

  /** Make an adopted read of the editor the current state. */
  private install(
    native: string,
    adopted: { nf: NormalForm; residue: Residue }
  ): void {
    const { pack } = this;
    const view = makeView(adopted.nf, pack);
    this.native = native;
    this.current = {
      pack,
      view,
      residue: adopted.residue,
      ids: this.ids,
      outlineHash: renderOutline(view, pack).outlineHash
    };
  }

  /** Section 9: what the form sends in `context.liveDocument` while this editor is mounted. */
  descriptor(selection?: Selection): Descriptor {
    const { outlineHash } = this.state;
    return {
      protocolVersion: PROTOCOL_VERSION,
      editorId: this.editorId,
      target: { ...this.target },
      format: this.pack.format,
      readOnly: this.host.readOnly(),
      outlineHash,
      ...(selection ? { selection } : {})
    };
  }

  /** Section 10: one document action (its verb) and its payload in, its outcome out. */
  dispatch(verb: Verb, raw: unknown): DispatchOutcome {
    const started = this.clock();
    let turnId: string | undefined;
    try {
      const parsed = parseBridgePayload(raw);
      if (!parsed.ok) return parsed.failure;
      const payload = parsed.value;
      turnId = payload.turnId;
      if (!sameEditor(payload, this))
        return dispatchFailure(
          'wrong-editor',
          'The request named a different editor or target than the one mounted.'
        );
      if (verb === 'write') this.setTurn(payload.turnId);
      const result = this.execute(verb, payload.input, payload.turnId);
      if (verb === 'write')
        logWriteOutcome(payload.turnId, result, this.clock() - started);
      return {
        status: 'ok',
        result: {
          ...result,
          editorId: this.editorId,
          target: { ...this.target },
          outlineHash: this.state.outlineHash
        }
      };
    } catch (e) {
      logError({
        turnId,
        verb,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      });
      return dispatchFailure(
        'handler-exception',
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  /** Run one verb against the live document. */
  execute(verb: Verb, input: unknown, turnId: string): VerbResult {
    if (verb === 'write') return this.write(input, turnId);
    const parsed = parseVerbInput(verb, input);
    if (!parsed.ok) return refusedResult(parsed.refusal);
    const state = this.state;
    if (verb === 'outline')
      return outlineVerb(
        state,
        parsed.value as Parameters<typeof outlineVerb>[1]
      );
    if (verb === 'read')
      return readVerb(state, parsed.value as Parameters<typeof readVerb>[1]);
    return findVerb(state, parsed.value as Parameters<typeof findVerb>[1]);
  }

  private write(input: unknown, turnId: string): VerbResult {
    const trace = new TraceBuilder(this.pack.format, turnId, this.clock);
    const parsed = parseVerbInput('write', input);
    if (!parsed.ok) {
      trace.verified('refused', [{ name: 'envelope', pass: false }]);
      return refusedResult(parsed.refusal, trace.build());
    }
    const write: WriteInput = parsed.value;
    trace.requested(write);
    if (this.host.readOnly()) return readOnlyResult();

    // a resent identical write returns what it committed; a different one is the turn's next card
    const recorded = this.journal.replay(turnId, write);
    if (recorded) return recorded;
    const changeSetId = this.journal.nextChangeSet(turnId);

    const before = this.state;
    const prepared = prepareWrite(before, write);
    if (prepared.outcome === 'refused') {
      trace.verified('refused', prepared.checks);
      return refusedResult(prepared.refusal, trace.build());
    }
    if (prepared.outcome === 'conflict') {
      trace.verified('conflict', prepared.checks);
      return {
        ok: false,
        error: {
          code: ERROR_CODES.conflict,
          message: conflictMessage(prepared.conflict)
        },
        retry: 'modified_input',
        conflict: prepared.conflict,
        trace: trace.build()
      };
    }
    trace.verified('passed', prepared.checks);
    const common = {
      mapping: prepared.mapping,
      touched: prepared.touched,
      finalizerScope: prepared.finalizerScope,
      facts: prepared.facts
    };
    if (write.dryRun) {
      trace.committed('skipped', [], 0);
      return {
        ok: true,
        committed: false,
        dryRun: true,
        cardId: null,
        landed: 'none',
        outlineHash: before.outlineHash,
        ...common,
        warnings: prepared.warnings,
        trace: trace.build()
      };
    }

    const outcome = this.writing(() => {
      const out = reconcile({
        pack: this.pack,
        host: this.host,
        history: this.history,
        turnId: changeSetId,
        intent: write.intent,
        title: prepared.title,
        derived: prepared.facts
          .filter((f) => f.kind === 'finalizer')
          .flatMap((f) => f.ids),
        before: {
          view: before.view,
          residue: before.residue,
          native: this.native
        },
        intended: {
          view: makeView(prepared.intended, this.pack),
          residue: prepared.intendedResidue
        },
        adopt: (fresh) =>
          this.ids.adopt(fresh, this.pack.tree, this.pack.formatRefKeys, [
            prepared.intended,
            before.view.nf
          ])
      });
      // the document was opened whole: a structural commit, or a rollback that did not restore it
      const replaced =
        out.outcome === 'committed'
          ? out.plan.history === 'engine'
          : out.outcome !== 'unchanged' &&
            !(out.rollback.byteEqual || out.rollback.equivalent);
      if (replaced) this.replaced('robin');
      return out;
    });
    if (outcome.outcome === 'unchanged') {
      trace.committed('skipped', [], 0);
      return {
        ok: true,
        committed: false,
        dryRun: false,
        cardId: null,
        landed: 'none',
        outlineHash: before.outlineHash,
        ...common,
        warnings: [
          ...prepared.warnings,
          {
            code: 'no-change',
            message:
              'Nothing was applied: the document already reads as this write would leave it.'
          }
        ],
        trace: trace.build()
      };
    }
    if (outcome.outcome !== 'committed') {
      const rolledBack =
        outcome.rollback.byteEqual || outcome.rollback.equivalent;
      trace.committed('rolled-back', outcome.seams, 0);
      trace.proof({
        outcome: outcome.outcome === 'proof-failed' ? 'failed' : 'skipped',
        landed:
          outcome.outcome === 'proof-failed' ? outcome.proof.landed : false,
        reversible:
          outcome.outcome === 'proof-failed' ? outcome.proof.reversible : false,
        normalizations: [],
        rollback: {
          byteEqual: outcome.rollback.byteEqual,
          exact: outcome.rollback.exact,
          equivalent: outcome.rollback.equivalent
        }
      });
      this.refresh();
      const restored = rolledBack
        ? 'it was rolled back and nothing was applied'
        : 'rolling it back did not restore the document exactly; ask the user to check it';
      const refusal =
        outcome.outcome === 'proof-failed'
          ? problem(
              'proof-failed',
              `The change did not land in the editor exactly as composed, so ${restored}.`,
              {
                detail: {
                  landed: outcome.proof.landedDiff,
                  reversible: outcome.proof.reversibleDiff,
                  conserved: outcome.proof.conservedDiff,
                  authorship: outcome.proof.authorshipDiff
                },
                read: [...(this.pack.methodCards ?? [])],
                retry: rolledBack ? 'modified_input' : 'do_not_retry'
              }
            )
          : problem(
              'apply-failed',
              `The editor could not place the change (${outcome.error}), so ${restored}.`,
              {
                read: [...(this.pack.methodCards ?? [])],
                retry: rolledBack ? 'modified_input' : 'do_not_retry'
              }
            );
      return refusedResult(makeRefusal([refusal]), trace.build());
    }

    this.install(outcome.live.native, outcome.live);
    if (outcome.plan.history === 'engine' && outcome.plan.landed === 'card')
      this.structural.add(changeSetId);
    trace.committed('committed', outcome.seams, prepared.touched.length);
    trace.proof({
      outcome: 'passed',
      landed: true,
      reversible: true,
      normalizations: outcome.proof.normalizations,
      rollback: null
    });
    const result: VerbResult = {
      ok: true,
      committed: true,
      dryRun: false,
      cardId: outcome.plan.landed === 'card' ? changeSetId : null,
      landed: outcome.plan.landed,
      outlineHash: (this.current as DocumentState).outlineHash,
      ...common,
      warnings: [...prepared.warnings, ...outcome.warnings],
      trace: trace.build()
    };
    this.journal.record(turnId, write, result);
    return result;
  }

  /**
   * Whether the engine resolves this card itself: one it committed by replacing the document this
   * session, or one the pack says the editor's own accept or reject cannot settle.
   */
  ownsCard(changeSetId: string): boolean {
    if (!this.pack.projections.resolveGroup) return false;
    if (this.structural.has(changeSetId)) return true;
    // read from the last installed state, never by re-reading the editor: the rail asks this from
    // inside the editor's change events, mid-commit, where a re-read would adopt a half-written
    // document (and cost a full read per keystroke)
    const nf = this.current?.view.nf;
    return !!nf && !!this.pack.projections.ownsResolution?.(nf, changeSetId);
  }

  /**
   * Accept or reject one card through the engine: a reject of the last change set, with the
   * document still as it left it, restores the snapshot byte for byte; otherwise the pack's group
   * projection of the live document is opened. The resolution is one engine history entry, so
   * Ctrl+Z brings the card back. False, and the document as it was, when it cannot be done.
   */
  resolveCard(changeSetId: string, accept: boolean): boolean {
    const resolveGroup = this.pack.projections.resolveGroup;
    if (!resolveGroup) return false;
    const state = this.state;
    const before = this.native;
    const snapshot = accept
      ? undefined
      : this.history.restorable(changeSetId, before);
    let target: string;
    try {
      target = snapshot
        ? snapshot.before
        : this.pack.adapter.fromNormalForm(
            resolveGroup(state.view.nf, changeSetId, accept),
            state.residue
          );
      this.host.open(target);
    } catch {
      try {
        this.host.open(before);
      } catch {
        // the editor is gone; nothing left to restore
      }
      this.refresh();
      return false;
    }
    this.history.push({
      turnId: changeSetId,
      kind: 'resolution',
      before,
      after: this.host.serialize()
    });
    this.structural.delete(changeSetId);
    this.refresh();
    this.replaced('person');
    return true;
  }

  /** The editing turn in flight: set by its first write, cleared by `finishTurn`. */
  get activeTurn(): string | null {
    return this.turn;
  }

  /** The form's turn settled: Robin is no longer editing this document. */
  finishTurn(): void {
    this.setTurn(null);
  }

  private setTurn(turnId: string | null): void {
    if (this.turn === turnId) return;
    this.turn = turnId;
    try {
      this.onTurnChange?.(turnId);
    } catch {
      // A host listener must never change what the verb does.
    }
  }

  /** Ctrl+Z: the editor when it has an entry, else the engine (decision D4). */
  undo(): HistoryOutcome {
    const out = this.history.undo(this.host);
    this.refresh();
    if (out.via === 'engine') this.replaced('person');
    return out;
  }

  /** Ctrl+Y, routed the same way. */
  redo(): HistoryOutcome {
    const out = this.history.redo(this.host);
    this.refresh();
    if (out.via === 'engine') this.replaced('person');
    return out;
  }

  private replaced(by: 'robin' | 'person'): void {
    try {
      this.onReplaced?.(by);
    } catch {
      // A host listener must never change what the verb does.
    }
  }
}

/** A write's outcome in the console: a warning when it did not commit, a debug line when it did. */
function logWriteOutcome(turnId: string, result: VerbResult, ms: number): void {
  const r = result as unknown as Record<string, any>;
  if (r.ok && r.committed) {
    logDebug({
      turnId,
      verb: 'write',
      landed: r.landed,
      cardId: r.cardId,
      warnings: (r.warnings ?? []).map((w: { code: string }) => w.code),
      ms: Math.round(ms * 10) / 10
    });
    return;
  }
  if (r.ok) return; // a dry run
  const refusal = r.refusal as Record<string, any> | undefined;
  const proof = r.trace?.proof as Record<string, any> | undefined;
  const rollback = proof?.rollback as
    | { byteEqual: boolean; exact?: boolean; equivalent?: boolean }
    | null
    | undefined;
  logWarn({
    turnId,
    verb: 'write',
    code: r.error?.code,
    invariant: refusal?.invariant,
    cards: refusal?.read,
    proofOutcome: proof?.outcome,
    rollback: rollback
      ? {
          byteEqual: rollback.byteEqual,
          exact: rollback.exact,
          equivalent: rollback.equivalent
        }
      : undefined,
    detail: truncatedDetail(refusal?.detail ?? r.conflict ?? r.error?.message)
  });
}
