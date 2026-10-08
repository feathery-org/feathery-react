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
  BridgeResponse,
  Descriptor,
  DispatchFailure,
  ERROR_CODES,
  HostTarget,
  PROTOCOL_VERSION,
  Selection,
  Verb,
  VerbResult,
  WriteInput,
  makeRefusal,
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
}

export type DispatchOutcome =
  | { status: 'ok'; response: BridgeResponse }
  | { status: 'error'; failure: DispatchFailure };

let mounts = 0;
const newEditorId = () => {
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

  private readonly journal = new WriteJournal<VerbResult>();

  private native = '';

  private current: DocumentState | null = null;

  constructor(options: SessionOptions) {
    this.pack = options.pack;
    this.host = options.host;
    this.target = { ...options.target };
    this.editorId = options.editorId ?? newEditorId();
    this.clock = options.clock ?? defaultClock;
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

  /** Section 10: one bridge request in, one bridge response or dispatch failure out. */
  dispatch(raw: unknown): DispatchOutcome {
    try {
      const parsed = parseBridgePayload(raw);
      if (!parsed.ok) return { status: 'error', failure: parsed.failure };
      const payload = parsed.value;
      if (!sameEditor(payload, this))
        return {
          status: 'error',
          failure: {
            reason: 'wrong-editor',
            message:
              'The request named a different editor or target than the one mounted.'
          }
        };
      const result = this.execute(payload.verb, payload.input, payload.turnId);
      return {
        status: 'ok',
        response: {
          editorId: this.editorId,
          target: { ...this.target },
          outlineHash: this.state.outlineHash,
          result
        }
      };
    } catch (e) {
      return {
        status: 'error',
        failure: {
          reason: 'handler-exception',
          message: e instanceof Error ? e.message : String(e)
        }
      };
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

    const journaled = this.journal.check(turnId, write);
    if (journaled && 'replay' in journaled) return journaled.replay;
    if (journaled) {
      trace.verified('refused', [
        { name: 'envelope', pass: true },
        { name: 'one-write-per-message', pass: false }
      ]);
      return refusedResult(
        makeRefusal([
          problem(
            'one-write-per-message',
            'Nothing was applied: this message already committed its change; a message makes one change.',
            {
              retry: 'do_not_retry',
              hint: 'Reply to the user with what landed; a further change is a new message.'
            }
          )
        ]),
        trace.build()
      );
    }

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

    const outcome = reconcile({
      pack: this.pack,
      host: this.host,
      history: this.history,
      turnId,
      intent: write.intent,
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
                retry: rolledBack ? 'modified_input' : 'do_not_retry'
              }
            )
          : problem(
              'apply-failed',
              `The editor could not place the change (${outcome.error}), so ${restored}.`,
              {
                retry: rolledBack ? 'modified_input' : 'do_not_retry'
              }
            );
      return refusedResult(makeRefusal([refusal]), trace.build());
    }

    this.install(outcome.live.native, outcome.live);
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
      cardId: outcome.plan.landed === 'card' ? turnId : null,
      landed: outcome.plan.landed,
      outlineHash: (this.current as DocumentState).outlineHash,
      ...common,
      warnings: [...prepared.warnings, ...outcome.warnings],
      trace: trace.build()
    };
    this.journal.record(turnId, write, result);
    return result;
  }

  /** Ctrl+Z: the editor when it has an entry, else the engine (decision D4). */
  undo(): HistoryOutcome {
    const out = this.history.undo(this.host);
    this.refresh();
    return out;
  }

  /** Ctrl+Y, routed the same way. */
  redo(): HistoryOutcome {
    const out = this.history.redo(this.host);
    this.refresh();
    return out;
  }
}
