// Per-instance editor store. Each mounted PptxEditor owns one store, which owns
// one PptxEditorEngine: nothing here is module-level, so several editors on one
// page keep fully isolated selection, history, dirty state and render targets.
//
// The store is a small hand-rolled external store (subscribe/getState/setState)
// consumed by React through useSyncExternalStore - no state library dependency.

import { importDeck } from '../core/model/import';
import type { Deck, Shape } from '../core/model/types';
import type { TextRange } from '../core/model/edit';
import {
  reconcileSlideSvg,
  rerenderBackground,
  rerenderShape,
  syncShapeOrder
} from '../core/render/svg';
import {
  PptxEditorEngine,
  type CommandResult,
  type EditorSnapshot
} from '../engine/PptxEditorEngine';
import type { EditorCommand } from '../engine/commands';

export interface HistorySummary {
  id: number;
  label: string;
}

export interface TableSelection {
  shapeId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface PptxEditorState {
  deck: Deck | null;
  fileName: string;
  activeSlide: number;
  /** Primary selection (first of selectedIds) - for the toolbar/JSON panel. */
  selectedId: string | null;
  selectedIds: string[];
  textSelection: { shapeId: string; ranges: TextRange[] } | null;
  tableSelection: TableSelection | null;
  pictureCropModeId: string | null;
  /** Keep a captured text range through toolbar focus/blur. */
  textToolbarPointer: boolean;
  /** Bumped after any value/geometry mutation (refresh panels). */
  rev: number;
  /** Bumped only when the SVG DOM must be fully rebuilt (not in-place edits). */
  renderRev: number;
  /** Bumped when the mounted SVG needs structural reconciliation. */
  structureRev: number;
  showJson: boolean;
  undoStack: HistorySummary[];
  redoStack: HistorySummary[];
  /** Increments only for undo/redo (suppresses transient UI animations). */
  historyRevision: number;
}

const INITIAL_STATE: PptxEditorState = {
  deck: null,
  fileName: '',
  activeSlide: 0,
  selectedId: null,
  selectedIds: [],
  textSelection: null,
  tableSelection: null,
  pictureCropModeId: null,
  textToolbarPointer: false,
  rev: 0,
  renderRev: 0,
  structureRev: 0,
  showJson: false,
  undoStack: [],
  redoStack: [],
  historyRevision: 0
};

function historyFields(
  snapshot: EditorSnapshot | null
): Pick<PptxEditorState, 'undoStack' | 'redoStack' | 'historyRevision'> {
  if (!snapshot) return { undoStack: [], redoStack: [], historyRevision: 0 };
  return {
    undoStack: Array.from({ length: snapshot.undoDepth }, (_, index) => ({
      id: index,
      label:
        index === snapshot.undoDepth - 1
          ? snapshot.undoLabel || 'Edit slide'
          : 'Edit slide'
    })),
    redoStack: Array.from({ length: snapshot.redoDepth }, (_, index) => ({
      id: index,
      label:
        index === snapshot.redoDepth - 1
          ? snapshot.redoLabel || 'Edit slide'
          : 'Edit slide'
    })),
    historyRevision: snapshot.historyRevision
  };
}

export class PptxEditorStore {
  private state: PptxEditorState = INITIAL_STATE;

  private listeners = new Set<() => void>();

  /** The engine this instance owns for its whole lifetime. */
  readonly engine = new PptxEditorEngine();

  // Live, non-reactive references. These never trigger React updates: the SVG
  // root is a render target, and commitSvgTextEdit is an imperative escape
  // hatch the stage installs while a contenteditable edit is in flight.
  svgRoot: SVGSVGElement | null = null;

  commitSvgTextEdit: ((options?: { render?: boolean }) => void) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PptxEditorState => this.state;

  private set(partial: Partial<PptxEditorState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Release the document, history and object URLs. The store stays usable
   * afterwards (StrictMode remounts reload through loadFile).
   */
  dispose(): void {
    this.engine.dispose();
    this.svgRoot = null;
    this.commitSvgTextEdit = null;
    this.state = INITIAL_STATE;
    this.listeners.forEach((listener) => listener());
  }

  // ---- rendering bridge ----

  /**
   * Apply a command result's invalidations to the mounted SVG (targeted,
   * no-flash), or bump structureRev so the next mount rebuilds.
   */
  private refreshEngineView(
    result: CommandResult
  ): Pick<PptxEditorState, 'renderRev' | 'structureRev'> {
    const { deck, activeSlide, renderRev, structureRev } = this.state;
    const unchanged = { renderRev, structureRev };
    if (!result.changed || !deck) return unchanged;
    const slide = deck.slides[activeSlide];
    const active = result.invalidations.filter(
      (invalidation) =>
        invalidation.kind === 'deck' || invalidation.slideId === slide?.path
    );
    if (!active.length) return unchanged;
    if (this.svgRoot && slide) {
      for (const invalidation of active) {
        if (invalidation.kind === 'deck' || invalidation.kind === 'slide') {
          reconcileSlideSvg(deck, slide, this.svgRoot, {
            fullContent: true,
            background: true,
            structure: true,
            slideSize: true
          });
        } else if (invalidation.kind === 'background') {
          rerenderBackground(deck, slide, this.svgRoot);
        } else if (invalidation.kind === 'structure') {
          for (const shapeId of invalidation.shapeIds)
            rerenderShape(deck, slide, shapeId, this.svgRoot);
          syncShapeOrder(slide, this.svgRoot);
        } else {
          for (const shapeId of invalidation.shapeIds)
            rerenderShape(deck, slide, shapeId, this.svgRoot);
        }
      }
      return unchanged;
    }
    return { renderRev, structureRev: structureRev + 1 };
  }

  // ---- engine actions ----

  loadFile = (bytes: Uint8Array, name: string): void => {
    const deck = importDeck(bytes);
    this.engine.adopt(deck);
    this.set({
      deck,
      fileName: name,
      activeSlide: 0,
      selectedId: null,
      selectedIds: [],
      textSelection: null,
      tableSelection: null,
      pictureCropModeId: null,
      ...historyFields(this.engine.snapshot()),
      rev: this.state.rev + 1,
      structureRev: this.state.structureRev + 1
    });
  };

  executeCommand = (
    command: EditorCommand,
    label?: string,
    options?: { render?: boolean }
  ): CommandResult | undefined => {
    if (!this.state.deck) return undefined;
    const result = this.engine.execute(command, { label });
    const rendering =
      options?.render === false
        ? {
            renderRev: this.state.renderRev,
            structureRev: this.state.structureRev
          }
        : this.refreshEngineView(result);
    this.set({
      ...historyFields(result.snapshot),
      rev: this.state.rev + (result.changed ? 1 : 0),
      ...rendering
    });
    return result;
  };

  applyActiveSlideJSON = (value: unknown): CommandResult | undefined => {
    const slide = this.state.deck?.slides[this.state.activeSlide];
    if (!slide) return undefined;
    const result = this.engine.applySlideJson(slide.path, value);
    const rendering = this.refreshEngineView(result);
    this.set({
      ...historyFields(result.snapshot),
      rev: this.state.rev + (result.changed ? 1 : 0),
      ...rendering
    });
    return result;
  };

  undo = (): void => {
    // Finish an active SVG text edit first so the visible text becomes the top
    // history entry and this Undo reverses what the user just typed.
    this.commitSvgTextEdit?.({ render: false });
    if (!this.state.deck) return;
    const result = this.engine.undo();
    if (!result.changed) return;
    this.afterHistoryRestore(result);
  };

  redo = (): void => {
    // A pending SVG text edit is a new branch. Commit it before deciding
    // whether a previously undone entry can still be redone.
    this.commitSvgTextEdit?.({ render: false });
    if (!this.state.deck) return;
    const result = this.engine.redo();
    if (!result.changed) return;
    this.afterHistoryRestore(result);
  };

  private afterHistoryRestore(result: CommandResult): void {
    const rendering = this.refreshEngineView(result);
    // Undo/redo of a slide add/delete can leave activeSlide out of range.
    const count = this.state.deck?.slides.length ?? 0;
    const activeSlide = Math.min(
      this.state.activeSlide,
      Math.max(0, count - 1)
    );
    const slide = this.state.deck?.slides[activeSlide];
    const selectedIds = this.state.selectedIds.filter((id) =>
      slide?.shapes.some((shape) => shape.id === id)
    );
    this.set({
      ...historyFields(result.snapshot),
      activeSlide,
      selectedIds,
      selectedId: selectedIds[0] ?? null,
      textSelection: null,
      tableSelection: null,
      pictureCropModeId: null,
      rev: this.state.rev + 1,
      ...rendering
    });
  }

  resetHistory = (): void => {
    if (!this.state.deck) return;
    this.engine.resetHistory();
    this.set({ ...historyFields(this.engine.snapshot()) });
  };

  /** After a successful host save: current state becomes the clean baseline. */
  markSaved = (): void => {
    if (!this.state.deck) return;
    this.engine.markSaved();
    this.set({ rev: this.state.rev + 1 });
  };

  // ---- tracked edits ----

  acceptChange = (id: string): boolean => {
    const accepted = this.engine.acceptChange(id);
    if (accepted) this.set({ rev: this.state.rev + 1 });
    return accepted;
  };

  rejectChange = (id: string): ReturnType<PptxEditorEngine['rejectChange']> => {
    const outcome = this.engine.rejectChange(id);
    if (outcome.ok) {
      for (const result of outcome.results) this.refreshEngineView(result);
    }
    this.set({
      ...historyFields(this.engine.snapshot()),
      rev: this.state.rev + 1
    });
    return outcome;
  };

  // ---- UI state actions ----

  setSvgRoot = (svg: SVGSVGElement | null): void => {
    this.svgRoot = svg;
  };

  setCommitSvgTextEdit = (
    commit: ((options?: { render?: boolean }) => void) | null
  ): void => {
    this.commitSvgTextEdit = commit;
  };

  setActiveSlide = (index: number): void =>
    this.set({
      activeSlide: index,
      selectedId: null,
      selectedIds: [],
      textSelection: null,
      tableSelection: null,
      pictureCropModeId: null
    });

  /** Insert a slide at `atIndex` (blank, or a clone of `duplicateOf`). */
  addSlide = (atIndex: number, duplicateOf?: string): void => {
    if (!this.state.deck) return;
    const result = this.executeCommand(
      { type: 'add-slide', atIndex, duplicateOf },
      duplicateOf ? 'Duplicate slide' : 'Add slide'
    );
    if (!result?.changed) return;
    const count = this.state.deck?.slides.length ?? 1;
    this.setActiveSlide(Math.min(Math.max(atIndex, 0), count - 1));
  };

  /** Delete a slide by path; never removes the deck's last slide. */
  deleteSlide = (slideId: string): void => {
    const deck = this.state.deck;
    if (!deck || deck.slides.length <= 1) return;
    const index = deck.slides.findIndex((slide) => slide.path === slideId);
    if (index < 0) return;
    const result = this.executeCommand(
      { type: 'delete-slide', slideId },
      'Delete slide'
    );
    if (!result?.changed) return;
    const count = this.state.deck?.slides.length ?? 1;
    this.setActiveSlide(Math.min(index, count - 1));
  };

  select = (id: string | null): void =>
    this.set({
      selectedId: id,
      selectedIds: id ? [id] : [],
      textSelection: null,
      tableSelection:
        this.state.tableSelection?.shapeId === id
          ? this.state.tableSelection
          : null,
      pictureCropModeId: this.state.pictureCropModeId === id ? id : null
    });

  toggleSelect = (id: string): void => {
    const has = this.state.selectedIds.includes(id);
    const ids = has
      ? this.state.selectedIds.filter((candidate) => candidate !== id)
      : [...this.state.selectedIds, id];
    this.set({
      selectedIds: ids,
      selectedId: ids[ids.length - 1] ?? null,
      textSelection: null,
      tableSelection: null,
      pictureCropModeId: null
    });
  };

  selectMany = (ids: string[]): void =>
    this.set({
      selectedIds: ids,
      selectedId: ids[0] ?? null,
      textSelection: null,
      tableSelection: null,
      pictureCropModeId: null
    });

  setTextSelection = (selection: PptxEditorState['textSelection']): void =>
    this.set({ textSelection: selection });

  setTableSelection = (selection: TableSelection | null): void =>
    this.set({ tableSelection: selection });

  setPictureCropMode = (shapeId: string | null): void =>
    this.set({ pictureCropModeId: shapeId });

  setTextToolbarPointer = (active: boolean): void =>
    this.set({ textToolbarPointer: active });

  toggleJson = (): void => this.set({ showJson: !this.state.showJson });

  selectedShape = (): Shape | undefined => {
    const { deck, activeSlide, selectedId } = this.state;
    if (!deck || selectedId == null) return undefined;
    return deck.slides[activeSlide]?.shapes.find(
      (shape) => shape.id === selectedId
    );
  };
}

export function createPptxEditorStore(): PptxEditorStore {
  return new PptxEditorStore();
}
