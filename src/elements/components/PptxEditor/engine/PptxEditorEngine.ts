import { applySlideJSON } from '../core/model/applyJson';
import { deepClone } from '../core/opc/deepClone';
import { exportDeckBytes } from '../core/model/export';
import { releaseObjectUrls } from '../core/opc/objectUrls';
import {
  captureHistorySnapshot,
  restoreHistorySnapshot,
  sameHistoryDocument,
  type HistoryRestoreResult,
  type PptxHistoryEntry,
  type PptxHistorySnapshot
} from '../core/model/history';
import { importDeck } from '../core/model/import';
import { deckToJSON, type DeckJSON } from '../core/model/json';
import { setSlideSize } from '../core/model/slideSize';
import {
  addAutoShape,
  addTableColumn,
  addTableRow,
  addTextBox,
  deleteShape,
  insertImage,
  insertSlideNumber,
  insertTable,
  mergeTableCells,
  removeTableColumn,
  removeTableRow,
  reorderShape,
  setParagraphAlign,
  setParagraphAlignAt,
  setParagraphBullet,
  setPictureCrop,
  setShapeGeometry,
  setShapeRichText,
  setSlideBackground,
  setSlideBackgroundImage,
  setTableCellRangeAlign,
  setTableCellRangeBorders,
  setTableCellRangeStyle,
  setTableCellText,
  setTableColumnWidth,
  setTableRowHeight,
  setTableStyle,
  setTextRangeStyle,
  setTextStyle,
  slideNumberShapes,
  snapTableColumnToContent,
  snapTableRowToContent,
  snapTableRowsToContent,
  unmergeTableCells
} from '../core/model/edit';
import type { Deck, Shape, Slide } from '../core/model/types';
import type { CommandMeta, EditorCommand, Invalidation } from './commands';
import { deriveChangeRecord, type PptxChangeRecord } from './changes';

const HISTORY_LIMIT = 100;

export interface EditorSnapshot {
  document: DeckJSON | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
  undoLabel?: string;
  redoLabel?: string;
  revision: number;
  historyRevision: number;
}

export interface CommandResult {
  changed: boolean;
  invalidations: Invalidation[];
  createdShapeIds: string[];
  snapshot: EditorSnapshot;
}

export interface EditorEvent {
  kind: 'load' | 'change' | 'undo' | 'redo';
  result: CommandResult;
}

export type EditorListener = (event: EditorEvent) => void;

function historyInvalidations(result: HistoryRestoreResult): Invalidation[] {
  const invalidations: Invalidation[] = [];
  for (const change of result.slides) {
    if (change.fullContent || change.structure || change.slideSize) {
      invalidations.push({ kind: 'slide', slideId: change.path });
      continue;
    }
    if (change.background)
      invalidations.push({ kind: 'background', slideId: change.path });
    if (change.shapeIds.length)
      invalidations.push({
        kind: 'shapes',
        slideId: change.path,
        shapeIds: change.shapeIds
      });
  }
  return invalidations;
}

function jsonInvalidations(
  slideId: string,
  result: ReturnType<typeof applySlideJSON>
): Invalidation[] {
  if (result.slideSize) return [{ kind: 'slide', slideId }];
  const invalidations: Invalidation[] = [];
  if (result.background) invalidations.push({ kind: 'background', slideId });
  if (result.shapeIds.length)
    invalidations.push({ kind: 'shapes', slideId, shapeIds: result.shapeIds });
  return invalidations;
}

/** Framework-free owner of PPTX mutations, JSON projection, transactions and history. */
export class PptxEditorEngine {
  private deck: Deck | null;
  private present: PptxHistorySnapshot | null;
  private baseline: PptxHistorySnapshot | null;
  private undoStack: PptxHistoryEntry[] = [];
  private redoStack: PptxHistoryEntry[] = [];
  private listeners = new Set<EditorListener>();
  private sequence = 0;
  private revision = 0;
  private historyRevision = 0;
  private changeLog: PptxChangeRecord[] = [];
  // Records whose transactions are currently undone (they return on redo).
  private shelvedRecords = new Map<string, PptxChangeRecord>();

  constructor(deck: Deck | null = null) {
    this.deck = deck;
    this.present = deck ? captureHistorySnapshot(deck) : null;
    this.baseline = this.present;
  }

  load(bytes: Uint8Array): void {
    this.adopt(importDeck(bytes));
  }

  /** Adopt an already-imported deck, replacing any current document. */
  adopt(deck: Deck): void {
    if (this.deck && this.deck !== deck) releaseObjectUrls(this.deck.pkg);
    this.deck = deck;
    this.resetHistory();
    this.revision += 1;
    const result = this.result(true, [{ kind: 'deck' }]);
    this.emit('load', result);
  }

  snapshot(): EditorSnapshot {
    // The snapshot document is IMMUTABLE shared state (history snapshots share
    // untouched slides structurally). Consumers must deepClone before mutating
    // a draft - the JSON panel and applySlideJson callers already do.
    const document =
      this.present?.document || (this.deck ? deckToJSON(this.deck) : null);
    return {
      document,
      dirty: !!(
        this.present &&
        this.baseline &&
        !sameHistoryDocument(this.present, this.baseline)
      ),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label,
      revision: this.revision,
      historyRevision: this.historyRevision
    };
  }

  execute(command: EditorCommand, meta: CommandMeta = {}): CommandResult {
    const deck = this.requireDeck();
    let invalidations: Invalidation[];
    let defaultLabel: string;
    let createdShapeIds: string[] = [];
    switch (command.type) {
      case 'set-slide-size': {
        const slide = this.requireSlide(command.slideId);
        setSlideSize(deck, slide, command.cx, command.cy);
        invalidations = [{ kind: 'slide', slideId: slide.path }];
        defaultLabel = 'Resize slide';
        break;
      }
      case 'set-slide-background': {
        const slide = this.requireSlide(command.slideId);
        const background = command.background;
        if (background.type === 'image')
          setSlideBackgroundImage(
            deck,
            slide,
            background.bytes,
            background.extension
          );
        else setSlideBackground(deck, slide, background);
        invalidations = [{ kind: 'background', slideId: slide.path }];
        defaultLabel =
          background.type === 'image'
            ? 'Set background image'
            : background.type === 'gradient'
            ? 'Set gradient background'
            : 'Set slide background';
        break;
      }
      case 'format-text': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireTextShape(slide, command.shapeId);
        if (command.ranges?.length)
          setTextRangeStyle(deck, slide, shape, command.ranges, command.style);
        else setTextStyle(deck, slide, shape, command.style);
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Format text';
        break;
      }
      case 'set-paragraph-align': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireTextShape(slide, command.shapeId);
        if (command.paragraphIndexes?.length) {
          for (const paragraphIndex of new Set(command.paragraphIndexes))
            setParagraphAlignAt(
              deck,
              slide,
              shape,
              paragraphIndex,
              command.align
            );
        } else setParagraphAlign(deck, slide, shape, command.align);
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Align text';
        break;
      }
      case 'set-paragraph-bullet': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireTextShape(slide, command.shapeId);
        setParagraphBullet(
          deck,
          slide,
          shape,
          command.bullet,
          command.paragraphIndexes
        );
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Change bullets';
        break;
      }
      case 'replace-rich-text': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireTextShape(slide, command.shapeId);
        setShapeRichText(deck, slide, shape, command.paragraphs);
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Edit text';
        break;
      }
      case 'set-shape-geometries': {
        const slide = this.requireSlide(command.slideId);
        const shapeIds: string[] = [];
        for (const update of command.updates) {
          const shape = this.requireShape(slide, update.shapeId);
          setShapeGeometry(deck, slide, shape, update.geometry);
          if (!shapeIds.includes(shape.id)) shapeIds.push(shape.id);
        }
        invalidations = shapeIds.length
          ? [{ kind: 'shapes', slideId: slide.path, shapeIds }]
          : [];
        defaultLabel = 'Transform shapes';
        break;
      }
      case 'set-picture-crop': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireShape(slide, command.shapeId);
        if (shape.type !== 'pic')
          throw new Error(
            `Picture ${command.shapeId} was not found on ${slide.path}`
          );
        if (command.geometry)
          setShapeGeometry(deck, slide, shape, command.geometry);
        setPictureCrop(deck, slide, shape, command.crop);
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Crop picture';
        break;
      }
      case 'edit-table': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireShape(slide, command.shapeId);
        if (shape.type !== 'table')
          throw new Error(
            `Table ${command.shapeId} was not found on ${slide.path}`
          );
        for (const operation of command.operations) {
          switch (operation.kind) {
            case 'set-cell-text':
              setTableCellText(
                deck,
                slide,
                shape,
                operation.row,
                operation.col,
                operation.value
              );
              break;
            case 'add-row':
              addTableRow(deck, slide, shape, operation.index);
              break;
            case 'remove-row':
              removeTableRow(deck, slide, shape, operation.index);
              break;
            case 'add-column':
              addTableColumn(deck, slide, shape, operation.index);
              break;
            case 'remove-column':
              removeTableColumn(deck, slide, shape, operation.index);
              break;
            case 'set-column-width':
              setTableColumnWidth(
                deck,
                slide,
                shape,
                operation.index,
                operation.width
              );
              break;
            case 'set-row-height':
              setTableRowHeight(
                deck,
                slide,
                shape,
                operation.index,
                operation.height
              );
              break;
            case 'fit-rows':
              snapTableRowsToContent(deck, slide, shape);
              break;
            case 'fit-column':
              snapTableColumnToContent(deck, slide, shape, operation.index);
              break;
            case 'fit-row':
              snapTableRowToContent(deck, slide, shape, operation.index);
              break;
            case 'merge-cells':
              mergeTableCells(deck, slide, shape, operation.range);
              break;
            case 'unmerge-cells':
              unmergeTableCells(deck, slide, shape, operation.range);
              break;
            case 'style-cells':
              setTableCellRangeStyle(
                deck,
                slide,
                shape,
                operation.range,
                operation.style
              );
              break;
            case 'align-cells':
              setTableCellRangeAlign(
                deck,
                slide,
                shape,
                operation.range,
                operation.align,
                operation.vertical
              );
              break;
            case 'set-borders':
              setTableCellRangeBorders(
                deck,
                slide,
                shape,
                operation.range,
                operation.target,
                operation.color,
                operation.widthPt,
                operation.dash
              );
              break;
            case 'set-table-style':
              setTableStyle(
                deck,
                slide,
                shape,
                operation.fill,
                operation.border
              );
              break;
            case 'set-geometry':
              setShapeGeometry(deck, slide, shape, operation.geometry);
              break;
          }
        }
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Edit table';
        break;
      }
      case 'insert-shape': {
        const slide = this.requireSlide(command.slideId);
        const insertion = command.shape;
        let shape: Shape;
        switch (insertion.kind) {
          case 'text-box':
            shape = addTextBox(
              deck,
              slide,
              insertion.x,
              insertion.y,
              insertion.cx,
              insertion.cy,
              insertion.text
            );
            break;
          case 'auto-shape':
            shape = addAutoShape(
              deck,
              slide,
              insertion.geometry,
              insertion.x,
              insertion.y,
              insertion.cx,
              insertion.cy,
              insertion.fill
            );
            break;
          case 'table':
            shape = insertTable(
              deck,
              slide,
              insertion.rows,
              insertion.columns,
              insertion.x,
              insertion.y,
              insertion.cx,
              insertion.cy
            );
            break;
          case 'image':
            shape = insertImage(
              deck,
              slide,
              insertion.bytes,
              insertion.extension,
              insertion.x,
              insertion.y,
              insertion.cx,
              insertion.cy
            );
            break;
          case 'slide-number':
            shape = insertSlideNumber(deck, slide, insertion.displayNumber);
            break;
        }
        createdShapeIds = [shape.id];
        invalidations = [
          { kind: 'structure', slideId: slide.path, shapeIds: createdShapeIds }
        ];
        defaultLabel = 'Insert shape';
        break;
      }
      case 'toggle-deck-slide-numbers': {
        // Deck-wide toggle: turning on adds a slide number to every slide
        // that lacks one (slides where the user deleted theirs get it back
        // only through this explicit re-toggle); turning off removes all.
        invalidations = [];
        deck.slides.forEach((slide, index) => {
          const existing = slideNumberShapes(slide);
          if (command.enabled && !existing.length) {
            const shape = insertSlideNumber(deck, slide, index + 1);
            createdShapeIds.push(shape.id);
            invalidations.push({
              kind: 'structure',
              slideId: slide.path,
              shapeIds: [shape.id]
            });
          } else if (!command.enabled && existing.length) {
            for (const shape of existing) deleteShape(deck, slide, shape);
            invalidations.push({
              kind: 'structure',
              slideId: slide.path,
              shapeIds: existing.map((shape) => shape.id)
            });
          }
        });
        defaultLabel = command.enabled
          ? 'Add slide numbers'
          : 'Remove slide numbers';
        break;
      }
      case 'delete-shapes': {
        const slide = this.requireSlide(command.slideId);
        const shapes = [...new Set(command.shapeIds)].map((shapeId) =>
          this.requireShape(slide, shapeId)
        );
        for (const shape of shapes) deleteShape(deck, slide, shape);
        invalidations = shapes.length
          ? [
              {
                kind: 'structure',
                slideId: slide.path,
                shapeIds: shapes.map((shape) => shape.id)
              }
            ]
          : [];
        defaultLabel = shapes.length > 1 ? 'Delete shapes' : 'Delete shape';
        break;
      }
      case 'reorder-shape': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireShape(slide, command.shapeId);
        reorderShape(deck, slide, shape, command.operation);
        invalidations = [
          { kind: 'structure', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Reorder shape';
        break;
      }
    }
    return this.commit(
      meta.label || defaultLabel,
      invalidations,
      'change',
      createdShapeIds,
      meta
    );
  }

  applySlideJson(
    slideId: string,
    value: unknown,
    meta: CommandMeta = {}
  ): CommandResult {
    const slide = this.requireSlide(slideId);
    const applied = applySlideJSON(this.requireDeck(), slide, value);
    return this.commit(
      meta.label || 'Edit slide JSON',
      jsonInvalidations(slide.path, applied),
      'change',
      [],
      meta
    );
  }

  undo(): CommandResult {
    const deck = this.requireDeck();
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return this.result(false, []);
    const restored = restoreHistorySnapshot(deck, entry.before);
    this.undoStack.pop();
    this.redoStack.push(entry);
    const undone = this.changeLog.find(
      (record) => record.transactionId === String(entry.id)
    );
    if (undone) {
      this.shelvedRecords.set(undone.transactionId, undone);
      this.changeLog = this.changeLog.filter((record) => record !== undone);
    }
    this.present = entry.before;
    this.revision += 1;
    this.historyRevision += 1;
    const result = this.result(true, historyInvalidations(restored));
    this.emit('undo', result);
    return result;
  }

  redo(): CommandResult {
    const deck = this.requireDeck();
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return this.result(false, []);
    const restored = restoreHistorySnapshot(deck, entry.after);
    this.redoStack.pop();
    this.undoStack.push(entry);
    const shelved = this.shelvedRecords.get(String(entry.id));
    if (shelved) {
      this.shelvedRecords.delete(String(entry.id));
      this.changeLog = [...this.changeLog, shelved];
    }
    this.present = entry.after;
    this.revision += 1;
    this.historyRevision += 1;
    const result = this.result(true, historyInvalidations(restored));
    this.emit('redo', result);
    return result;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** The tracked-edit log for the current document (newest last). */
  changes(): PptxChangeRecord[] {
    return this.changeLog;
  }

  pendingChangeCount(): number {
    return this.changeLog.filter((record) => record.status === 'pending')
      .length;
  }

  /** Accept a pending suggestion: the deck already carries it, only the
   *  record's status flips. */
  acceptChange(id: string): boolean {
    const record = this.changeLog.find((candidate) => candidate.id === id);
    if (!record || record.status !== 'pending') return false;
    this.changeLog = this.changeLog.map((candidate) =>
      candidate === record
        ? { ...candidate, status: 'accepted' as const }
        : candidate
    );
    this.revision += 1;
    return true;
  }

  /**
   * Reject a pending suggestion by executing an inverse engine command - but
   * only when its targets are unchanged since the suggestion. A target that
   * moved on is a conflict; later work is never overwritten.
   */
  rejectChange(
    id: string
  ):
    | { ok: true; results: CommandResult[] }
    | { ok: false; reason: 'not-pending' | 'conflict' | 'unsupported' } {
    const record = this.changeLog.find((candidate) => candidate.id === id);
    if (!record || record.status !== 'pending')
      return { ok: false, reason: 'not-pending' };
    const doc = this.present?.document;
    if (!doc) return { ok: false, reason: 'conflict' };
    const before = record.before as Record<string, unknown>;
    const after = record.after as Record<string, unknown>;

    // Validate every target first: reject is all-or-nothing.
    type SlidePlan = { slideId: string; draft: any; deletions: string[] };
    const plans = new Map<string, SlidePlan>();
    for (const target of record.targets) {
      if (target.slideId === '*') return { ok: false, reason: 'unsupported' };
      const slide = doc.slides.find((s) => s.path === target.slideId);
      if (!slide) return { ok: false, reason: 'conflict' };
      let plan = plans.get(target.slideId);
      if (!plan) {
        plan = {
          slideId: target.slideId,
          draft: deepClone(slide),
          deletions: []
        };
        plans.set(target.slideId, plan);
      }
      if (target.shapeId) {
        const key = `${target.slideId}#${target.shapeId}`;
        const current = slide.shapes.find((s) => s.id === target.shapeId);
        const expected = after[key];
        if (JSON.stringify(current ?? null) !== JSON.stringify(expected))
          return { ok: false, reason: 'conflict' };
        const previous = before[key];
        if (previous === null) {
          // The suggestion created this shape; rejecting deletes it.
          if (!current) return { ok: false, reason: 'conflict' };
          plan.deletions.push(target.shapeId);
        } else if (current) {
          const index = plan.draft.shapes.findIndex(
            (s: any) => s.id === target.shapeId
          );
          plan.draft.shapes[index] = deepClone(previous);
        } else {
          // The suggestion deleted the shape; restoring it needs raw XML we
          // no longer hold in the public projection.
          return { ok: false, reason: 'unsupported' };
        }
      } else {
        const expected = after[target.slideId];
        if (JSON.stringify(slide) !== JSON.stringify(expected))
          return { ok: false, reason: 'conflict' };
        plans.set(target.slideId, {
          slideId: target.slideId,
          draft: deepClone(before[target.slideId]),
          deletions: []
        });
      }
    }

    const results: CommandResult[] = [];
    for (const plan of plans.values()) {
      if (plan.deletions.length) {
        results.push(
          this.execute(
            {
              type: 'delete-shapes',
              slideId: plan.slideId,
              shapeIds: plan.deletions
            },
            { label: 'Reject suggestion', authorLabel: 'Reject' }
          )
        );
        plan.draft.shapes = plan.draft.shapes.filter(
          (s: any) => !plan.deletions.includes(s.id)
        );
      }
      results.push(
        this.applySlideJson(plan.slideId, plan.draft, {
          label: 'Reject suggestion',
          authorLabel: 'Reject'
        })
      );
    }
    this.changeLog = this.changeLog.map((candidate) =>
      candidate.id === id
        ? { ...candidate, status: 'rejected' as const }
        : candidate
    );
    this.revision += 1;
    return { ok: true, results };
  }

  /** Cheap dirty check against the saved baseline (no snapshot cloning). */
  isDirty(): boolean {
    return !!(
      this.present &&
      this.baseline &&
      !sameHistoryDocument(this.present, this.baseline)
    );
  }

  /** Mark the current state as the saved baseline; undo/redo stays intact. */
  markSaved(): void {
    if (!this.deck) return;
    this.baseline = this.present ?? captureHistorySnapshot(this.deck);
    this.revision += 1;
  }

  exportPptx(): Blob {
    const bytes = exportDeckBytes(this.requireDeck());
    return new Blob([bytes as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });
  }

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetHistory(): void {
    const deck = this.requireDeck();
    this.present = captureHistorySnapshot(deck, this.present);
    this.baseline = this.present;
    this.undoStack = [];
    this.redoStack = [];
    this.changeLog = [];
    this.shelvedRecords.clear();
    this.historyRevision += 1;
  }

  dispose(): void {
    this.listeners.clear();
    if (this.deck) releaseObjectUrls(this.deck.pkg);
    this.changeLog = [];
    this.shelvedRecords.clear();
    this.deck = null;
    this.present = null;
    this.baseline = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  private commit(
    label: string,
    invalidations: Invalidation[],
    event: EditorEvent['kind'],
    createdShapeIds: string[] = [],
    meta: CommandMeta = {}
  ): CommandResult {
    const deck = this.requireDeck();
    const before = this.present || captureHistorySnapshot(deck);
    const after = captureHistorySnapshot(deck, before);
    this.present = after;
    if (sameHistoryDocument(before, after)) return this.result(false, []);
    const entryId = ++this.sequence;
    this.undoStack = [
      ...this.undoStack,
      { id: entryId, label, before, after }
    ].slice(-HISTORY_LIMIT);
    this.redoStack = [];
    // Redo is gone, so records shelved by undo can never come back.
    this.shelvedRecords.clear();
    this.changeLog = [
      ...this.changeLog,
      deriveChangeRecord({
        transactionId: entryId,
        label,
        meta,
        invalidations,
        beforeDoc: before.document,
        afterDoc: after.document
      })
    ];
    this.revision += 1;
    const result = this.result(true, invalidations, createdShapeIds);
    this.emit(event, result);
    return result;
  }

  private result(
    changed: boolean,
    invalidations: Invalidation[],
    createdShapeIds: string[] = []
  ): CommandResult {
    return {
      changed,
      invalidations,
      createdShapeIds,
      snapshot: this.snapshot()
    };
  }

  private emit(kind: EditorEvent['kind'], result: CommandResult): void {
    for (const listener of this.listeners) listener({ kind, result });
  }

  private requireDeck(): Deck {
    if (!this.deck) throw new Error('No PowerPoint document is loaded');
    return this.deck;
  }

  private requireSlide(slideId: string): Slide {
    const slide = this.requireDeck().slides.find(
      (candidate) => candidate.path === slideId
    );
    if (!slide) throw new Error(`Slide ${slideId} was not found`);
    return slide;
  }

  private requireTextShape(slide: Slide, shapeId: string): Shape {
    const shape = this.requireShape(slide, shapeId);
    if (!shape?.text)
      throw new Error(`Text shape ${shapeId} was not found on ${slide.path}`);
    return shape;
  }

  private requireShape(slide: Slide, shapeId: string): Shape {
    const shape = slide.shapes.find((candidate) => candidate.id === shapeId);
    if (!shape)
      throw new Error(`Shape ${shapeId} was not found on ${slide.path}`);
    return shape;
  }
}
