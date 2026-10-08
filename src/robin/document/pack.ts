/**
 * The pack interface: the one typed seam between the format-blind core and a document format.
 *
 * The core never names a format. Everything a format knows reaches the core through the slots
 * below, and a pack is registered under its `format` name, the only place a format is named
 * (envelope contract section 14). A pack lives in `formats/<name>/` and imports only from the core
 * and from the editor modules it builds on.
 *
 * Slots, in the order the engine uses them:
 *
 *   tree         how to find a node's children, infer a written node's kind, and what may hold what
 *   formatRefKeys  the node keys whose string value references a format entry
 *   adapter      native bytes <-> normal form, byte-exact, with an engine-held residue keyed by id
 *   outline      the per-node detail after the id and kind tokens of an outline line
 *   text, features, annotate   what `find` matches and what `read` annotates
 *   properties   the property schema per kind and how overrides are written (architecture 5.1a)
 *   invariants   the pack's refusals, run on the virtual document before anything is committed
 *   finalizers   derived-value passes run after the changes, each declaring the ids it touched
 *   projections  accept and reject views of a document, and the enumerated normalization list
 *   reconcile, seams   how a verified change set is written into the live editor
 *   vocabulary   words that name this format or its SDK; the core must never contain them
 */
import type {
  Fact,
  PropertySource,
  RefusalProblem,
  Span,
  Warning
} from './envelope';
import {
  FormatEntry,
  NfNode,
  NormalForm,
  Placement,
  TreeShape,
  canonicalJson,
  isPlainObject,
  walk,
  withoutLists
} from './tree';

// ---------------------------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------------------------

/** Engine-derived values attached to a node by the pack: `usedBy` and `derived` (contract 2.3). */
export interface Annotation {
  usedBy?: string[];
  derived?: Record<string, unknown>;
}

/** A read-only view of one version of the normal form, handed to every pack function. */
export interface DocumentView {
  readonly nf: NormalForm;
  get(id: string): NfNode | undefined;
  placement(id: string): Placement | undefined;
  annotation(id: string): Annotation | undefined;
  /** Every node in document order. */
  nodes(): NfNode[];
}

export interface PackTree extends TreeShape {
  /**
   * The kind of a written node that carries none, decided from its shape and the list it is
   * written into; null when the shape does not say (the write is then refused).
   */
  inferKind(
    node: Record<string, unknown>,
    parentKind: string,
    listKey: string
  ): string | null;
  /** Whether a node of `kind` may sit in list `listKey` of a node of `parentKind`. */
  accepts(parentKind: string, listKey: string, kind: string): boolean;
  /**
   * An identity the pack tracks on a node that survives edits (a bound name, say); the id table
   * pins nodes with equal identities before anything else when it re-anchors. Null when none.
   */
  identity?(node: NfNode): string | null;
}

/**
 * Per-node native data the normal form omits, keyed by node id. Opaque to the core.
 *
 * The residue must be identity-free: nothing in it may be the only carrier of an identity (a
 * binding's name or row key, a bookmark's name, an image's key). A copied node takes a copy of the
 * original's residue, and finalizers re-mint identity only in the normal form, so an identity held
 * only in the residue would be duplicated by every copy. Identity lives in the normal form, where
 * the verifier sees it and finalizers mint it; residue holds only bytes that follow from it or
 * carry none.
 */
export type Residue = Record<string, unknown>;

export interface Adapter {
  /**
   * Native bytes to normal form. Node ids and format keys may be any unique strings: the core
   * replaces them with engine ids. `residue` holds, per node id, whatever the normal form leaves
   * out and the way back needs.
   */
  toNormalForm(native: string): { nf: NormalForm; residue: Residue };
  /** Normal form plus residue back to native bytes; `fromNormalForm(toNormalForm(x))` is `x`. */
  fromNormalForm(nf: NormalForm, residue: Residue): string;
}

export interface OutlineRenderer {
  /** Levels rendered below the root's children when `outline` names no depth. */
  defaultDepth: number;
  /** Everything after the id and kind tokens of the node's line; may be empty. */
  detail(node: NfNode, view: DocumentView): string;
  /** A label line printed before a child list (for example a story name), or null. */
  listLabel?(node: NfNode, listKey: string): string | null;
}

export interface FeatureMark {
  name: string;
  value?: string;
}

// ---------------------------------------------------------------------------------------------
// Properties (architecture 5.1a)
// ---------------------------------------------------------------------------------------------

export interface PropertySpec {
  name: string;
  /** `derived` properties are reported and never writable. */
  class: 'property' | 'derived';
  /** A short type description for refusals, such as `boolean` or `colour #RRGGBB`. */
  type: string;
  /** Null when `value` is valid; otherwise why not. `null` (clear) is checked by the core. */
  validate(value: unknown): string | null;
}

export interface EffectiveProperty {
  value: unknown;
  source: PropertySource;
}

/** The engine's format table during a write: the pack interns new entries through it. */
export interface FormatTable {
  get(formatId: string): FormatEntry | undefined;
  /** The id of an entry with exactly this content, adding one when none exists. */
  intern(entry: FormatEntry): string;
}

export interface Properties {
  /** Every property a node of `kind` has; null when the kind has none. */
  schema(kind: string): readonly PropertySpec[] | null;
  /** Every property a format entry may hold. */
  formatSchema: readonly PropertySpec[];
  /** Effective values with their source, in resolution order override, container, format, default. */
  effective(
    node: NfNode,
    view: DocumentView
  ): Record<string, EffectiveProperty>;
  /** Write an override on the node itself; `null` clears it. Values are already validated. */
  setOverride(
    node: NfNode,
    name: string,
    value: unknown,
    formats: FormatTable
  ): void;
  /**
   * Write overrides on a text span inside one node, splitting what the format requires. Returns
   * null on success, or why the span cannot carry them. Absent when the pack has no spans.
   */
  setOnSpan?(
    node: NfNode,
    span: Span,
    text: string,
    props: Record<string, unknown>,
    formats: FormatTable
  ): string | null;
  /** Change a shared format entry in place. */
  setOnFormat(entry: FormatEntry, name: string, value: unknown): void;
}

// ---------------------------------------------------------------------------------------------
// Verification and derived values
// ---------------------------------------------------------------------------------------------

export interface InvariantContext {
  before: DocumentView;
  after: DocumentView;
  /** Existing ids the change set changed or removed, and ids it created. */
  changed: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  created: ReadonlySet<string>;
}

export interface Invariant {
  /** The invariant name, equal to the knowledge card that teaches it (contract 7.1). */
  name: string;
  /**
   * The knowledge cards a model reads before retrying after this invariant refuses; at least one.
   * A refusal the invariant returns without `read` carries these.
   */
  cards: readonly [string, ...string[]];
  /** Problems found; empty when the invariant holds. */
  check(ctx: InvariantContext): RefusalProblem[];
}

export interface FinalizerContext {
  before: DocumentView;
  formats: FormatTable;
}

export interface FinalizerResult {
  /** Every node id the finalizer changed: its declared scope. */
  ids: string[];
  facts?: Fact[];
  /** Things the model should know that are legal, not refusals (a ragged table, say). */
  warnings?: Warning[];
}

export interface Finalizer {
  name: string;
  /** Recompute derived content on `after` in place. */
  run(after: NormalForm, ctx: FinalizerContext): FinalizerResult;
}

export interface Normalization {
  /** A measured normalization's name, reported in the proof trace when it was needed. */
  name: string;
  /**
   * The normalized document, never mutating the input. Returns the input itself when it changes
   * nothing, which lets the proof skip re-reading it; returning a copy is still correct, only slower.
   */
  apply(nf: NormalForm): NormalForm;
}

export interface Projections {
  /** All pending changes accepted. */
  accept(nf: NormalForm): NormalForm;
  /** All pending changes rejected. */
  reject(nf: NormalForm): NormalForm;
  /** The enumerated differences the proof admits; anything else fails it. */
  normalizations: readonly Normalization[];
  /**
   * Further differences admitted only where an undo or a reopen is compared with the document it
   * should restore (rollback and engine history), never by the proof.
   */
  undoNormalizations?: readonly Normalization[];
  /**
   * What rejecting every pending change should restore after this commit. Defaults to the
   * document before the write; a pack whose plan applies some changes untracked returns the
   * before document with those changes applied.
   */
  expectedRejection?(before: NormalForm, intended: NormalForm): NormalForm;
  /**
   * Whether a pending annotation was authored by the change set `turnId`. The proof requires the
   * pending changes not authored by this turn to be exactly those the document had before, so a
   * seam that re-authors someone else's change, or leaves its own change out of its group, fails.
   */
  authoredBy(pending: unknown, turnId: string): boolean;
  /**
   * The part of one node's residue a commit must leave unchanged, for the proof; the whole entry
   * when absent. A pack leaves out what its seams legitimately rewrite (revision anchors, say) and
   * what is derived from the normal form and checked there.
   */
  conservedResidue?(entry: unknown): unknown;
}

// ---------------------------------------------------------------------------------------------
// Writing into the live editor
// ---------------------------------------------------------------------------------------------

/** The live editor as the core drives it. The pack builds one around its editor. */
export interface EditorHost {
  serialize(): string;
  /** Replace the whole document; clears the editor's own undo history. */
  open(native: string): void;
  canUndo(): boolean;
  undo(): void;
  canRedo(): boolean;
  redo(): void;
  readOnly(): boolean;
}

export interface SeamContext {
  /** The change set id: the bridge turn id, the card id and the group tag. */
  turnId: string;
  /** One or two sentences from the write, for the card's detail text. */
  intent: string;
  /** The card's title, composed by the engine from the change (`card.ts`). */
  title?: string;
}

export interface Seam {
  /** Apply one step to the live editor. Throws when the step cannot be placed. */
  apply(host: EditorHost, payload: unknown, ctx: SeamContext): void;
}

export interface CommitStep {
  /** A key of `Pack.seams`. */
  seam: string;
  payload: unknown;
}

export interface CommitPlan {
  steps: CommitStep[];
  /** `card` when every change is reviewable as a tracked change, `immediate` otherwise. */
  landed: 'card' | 'immediate';
  /**
   * `editor` when the steps land as the editor's own undoable group; `engine` when they replace
   * the document (the editor's history is cleared and the engine keeps the way back).
   */
  history: 'editor' | 'engine';
  warnings?: Warning[];
}

export interface PlanContext {
  /** The change set id, which every change the plan authors is grouped under. */
  turnId: string;
  before: DocumentView;
  intended: DocumentView;
  beforeResidue: Residue;
  intendedResidue: Residue;
  beforeNative: string;
  /** What the card says: the engine's title and the write's intent, for the group tag. */
  card?: { title: string; intent: string };
}

export interface Reconcile {
  plan(ctx: PlanContext): CommitPlan;
}

// ---------------------------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------------------------

export interface Pack {
  /** The registration name; the descriptor's and trace's `format`. */
  format: string;
  /** Words naming this format or its SDK, which no core file may contain. */
  vocabulary: readonly string[];
  tree: PackTree;
  formatRefKeys: readonly string[];
  adapter: Adapter;
  outline: OutlineRenderer;
  /** The node's own text, which `find` searches and spans index; null when it has none. */
  text(node: NfNode): string | null;
  /** Feature marks on a node, as the outline renders them and `find` matches them. */
  features(node: NfNode, view: DocumentView): FeatureMark[];
  /** `usedBy` and `derived` for every node that has them. */
  annotate(view: DocumentView): Map<string, Annotation>;
  properties: Properties;
  invariants: readonly Invariant[];
  finalizers: readonly Finalizer[];
  projections: Projections;
  reconcile: Reconcile;
  seams: Readonly<Record<string, Seam>>;
  /**
   * The node kinds a person counts on a review card, singular and plural ("row", "rows"). A kind
   * not named here rolls up to its nearest named ancestor in the card title.
   */
  cardNouns?: Readonly<Record<string, readonly [string, string]>>;
}

const REQUIRED_FUNCTIONS: Array<[string, (p: Pack) => unknown]> = [
  ['tree.childLists', (p) => p.tree?.childLists],
  ['tree.inferKind', (p) => p.tree?.inferKind],
  ['tree.accepts', (p) => p.tree?.accepts],
  ['adapter.toNormalForm', (p) => p.adapter?.toNormalForm],
  ['adapter.fromNormalForm', (p) => p.adapter?.fromNormalForm],
  ['outline.detail', (p) => p.outline?.detail],
  ['text', (p) => p.text],
  ['features', (p) => p.features],
  ['annotate', (p) => p.annotate],
  ['properties.schema', (p) => p.properties?.schema],
  ['properties.effective', (p) => p.properties?.effective],
  ['properties.setOverride', (p) => p.properties?.setOverride],
  ['properties.setOnFormat', (p) => p.properties?.setOnFormat],
  ['projections.accept', (p) => p.projections?.accept],
  ['projections.reject', (p) => p.projections?.reject],
  ['projections.authoredBy', (p) => p.projections?.authoredBy],
  ['reconcile.plan', (p) => p.reconcile?.plan]
];

/** Every slot a pack is missing or has malformed; empty when the pack is complete. */
export function packProblems(pack: Pack): string[] {
  const problems: string[] = [];
  if (typeof pack?.format !== 'string' || !pack.format) problems.push('format');
  if (!Array.isArray(pack?.vocabulary) || !pack.vocabulary.length)
    problems.push('vocabulary[]');
  if (!Array.isArray(pack?.formatRefKeys)) problems.push('formatRefKeys[]');
  for (const [name, get] of REQUIRED_FUNCTIONS)
    if (typeof get(pack) !== 'function') problems.push(name);
  if (
    typeof pack?.outline?.defaultDepth !== 'number' ||
    pack.outline.defaultDepth < 1
  )
    problems.push('outline.defaultDepth');
  if (!Array.isArray(pack?.properties?.formatSchema))
    problems.push('properties.formatSchema[]');
  if (!Array.isArray(pack?.invariants)) problems.push('invariants[]');
  else
    for (const invariant of pack.invariants)
      if (!Array.isArray(invariant?.cards) || !invariant.cards.length)
        problems.push(`invariants.${invariant?.name}.cards`);
  if (!Array.isArray(pack?.finalizers)) problems.push('finalizers[]');
  if (!Array.isArray(pack?.projections?.normalizations))
    problems.push('projections.normalizations[]');
  if (!pack?.seams || typeof pack.seams !== 'object') problems.push('seams');
  else
    for (const [name, seam] of Object.entries(pack.seams))
      if (typeof seam?.apply !== 'function')
        problems.push(`seams.${name}.apply`);
  return problems;
}

/**
 * The conformance suite every pack passes over its fixture corpus before it is registered:
 * byte-exact round trip, unique node ids, every format reference resolving, and accept and reject
 * leaving a document with no pending changes as it is. Returns every failure, empty when none.
 */
export function conformanceProblems(
  pack: Pack,
  fixtures: Record<string, string>
): string[] {
  const problems = packProblems(pack).map((slot) => `missing slot ${slot}`);
  if (problems.length) return problems;
  const refKeys = new Set(pack.formatRefKeys);
  for (const [name, native] of Object.entries(fixtures)) {
    const { nf, residue } = pack.adapter.toNormalForm(native);
    if (pack.adapter.fromNormalForm(nf, residue) !== native)
      problems.push(`${name}: round trip is not byte-exact`);
    const seen = new Set<string>();
    let pending = false;
    walk(nf.root, pack.tree, ({ node }) => {
      if (typeof node.id !== 'string' || seen.has(node.id))
        problems.push(
          `${name}: node id ${String(node.id)} is missing or repeated`
        );
      seen.add(node.id);
      if (typeof node.kind !== 'string' || !node.kind)
        problems.push(`${name}: node ${node.id} has no kind`);
      if (node.pending !== undefined) pending = true;
      const refs = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(refs);
        if (!isPlainObject(value)) return;
        for (const [key, child] of Object.entries(value)) {
          if (
            refKeys.has(key) &&
            typeof child === 'string' &&
            !(child in nf.formats)
          )
            problems.push(
              `${name}: node ${node.id} references unknown format ${child}`
            );
          refs(child);
        }
      };
      refs(withoutLists(node, pack.tree));
    });
    if (!pending) {
      const same = canonicalJson(nf);
      if (canonicalJson(pack.projections.accept(nf)) !== same)
        problems.push(
          `${name}: accept changes a document with no pending changes`
        );
      if (canonicalJson(pack.projections.reject(nf)) !== same)
        problems.push(
          `${name}: reject changes a document with no pending changes`
        );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The registry, keyed by format
// ---------------------------------------------------------------------------------------------

const registry = new Map<string, Pack>();

/** Register a pack. Throws naming every missing slot, so a half-written pack fails loudly. */
export function registerPack(pack: Pack): void {
  const problems = packProblems(pack);
  if (problems.length)
    throw new Error(
      `document pack ${JSON.stringify(
        pack?.format
      )} is incomplete: ${problems.join(', ')}`
    );
  const existing = registry.get(pack.format);
  if (existing && existing !== pack)
    throw new Error(
      `a different document pack is already registered as ${JSON.stringify(
        pack.format
      )}`
    );
  registry.set(pack.format, pack);
}

export function getPack(format: string): Pack | undefined {
  return registry.get(format);
}

export function registeredFormats(): string[] {
  return [...registry.keys()];
}

/** Test support: forget every registration. */
export function clearPackRegistry(): void {
  registry.clear();
}
