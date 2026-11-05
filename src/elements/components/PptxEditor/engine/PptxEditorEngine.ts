import { releaseEmbeddedFonts } from '../core/render/embeddedFontRegistry';
import { findGroupMember, ungroupShape } from '../core/model/groups';
import { applySlideJSON } from '../core/model/applyJson';
import { exportDeckBytes } from '../core/model/export';
import { releaseObjectUrls } from '../core/opc/objectUrls';
import {
  captureHistorySnapshot,
  restoreHistorySnapshot,
  restoreShapes,
  restoreShapesInOrder,
  restoreSourceSlide,
  sameHistoryDocument,
  slideShapes,
  type HistoryRestoreResult,
  type PptxHistoryEntry,
  type PptxHistorySnapshot
} from '../core/model/history';
import { importDeck } from '../core/model/import';
import { deckToJSON, type DeckJSON } from '../core/model/json';
import { setPresentationSize } from '../core/model/slideSize';
import { addSlide, deleteSlide, moveSlide } from '../core/model/slides';
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
  setShapeFillColor,
  setShapeLineColor,
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
import type { OTree } from '../core/opc/xml';
import type { CommandMeta, EditorCommand, Invalidation } from './commands';
import { deriveChangeRecord, type PptxChangeRecord } from './changes';

const HISTORY_LIMIT = 100;

/** Opaque state handle: taken with savePoint(), consumed by markSaved(). */
export type PptxSavePoint = PptxHistorySnapshot;

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
  // A slide add/delete/duplicate or a presentation resize changes every
  // slide; a full redraw covers the navigator and the active slide.
  if (result.deck || result.size) return [{ kind: 'deck' }];
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

// The slides before a pending suggestion, so a reader can reject it from its own data, like a revision's deleted text
function slidesBefore(
  record: PptxChangeRecord,
  before: PptxHistorySnapshot
): Record<string, OTree> {
  const deckWide = record.targets.some((target) => target.slideId === '*');
  const paths = deckWide
    ? Object.keys(before.sourceSlides)
    : [...new Set(record.targets.map((target) => target.slideId))];
  const beforeSlides: Record<string, OTree> = {};
  for (const path of paths)
    if (before.sourceSlides[path])
      beforeSlides[path] = before.sourceSlides[path];
  return beforeSlides;
}

const shapeOrder = (raw: OTree) => slideShapes(raw).map((shape) => shape.id);

// Whether a suggestion deleted the shape or moved it among the shapes it kept, which an in-place restore cannot undo
function changedPlacement(
  before: string[],
  after: string[],
  shapeId: string
): boolean {
  if (!before.includes(shapeId)) return false;
  if (!after.includes(shapeId)) return true;
  const kept = (ids: string[]) =>
    ids.filter((id) => before.includes(id) && after.includes(id));
  return kept(before).indexOf(shapeId) !== kept(after).indexOf(shapeId);
}

interface OpenTransaction {
  labels: string[];
  invalidations: Invalidation[];
  createdShapeIds: string[];
}

function jsonInvalidations(
  slideId: string,
  result: ReturnType<typeof applySlideJSON>
): Invalidation[] {
  if (result.slideSize) return [{ kind: 'deck' }];
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
  private pendingSnapshots = new Map<
    string,
    { before: PptxHistorySnapshot; after: PptxHistorySnapshot }
  >();

  private openTransaction: OpenTransaction | null = null;

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
    if (this.deck !== deck) {
      if (this.deck) {
        releaseObjectUrls(this.deck.pkg);
        releaseEmbeddedFonts(this.deck.pkg);
      }
      // Snapshot reuse keys on slide paths + mutation sequence, which fresh
      // imports share; a previous document's snapshot must never seed it.
      this.present = null;
      this.baseline = null;
    }
    this.deck = deck;
    this.resetHistory();
    this.revision += 1;
    const result = this.result(true, [{ kind: 'deck' }]);
    this.emit('load', result);
  }

  /** The loaded deck for reading, change it only through commands */
  readDeck(): Readonly<Deck> | null {
    return this.deck;
  }

  /**
   * Run several commands as one undo entry and one change record, like Word's undo group: a nested
   * call joins the open one, and what ran before a throw is still kept as that one entry
   */
  transaction(meta: CommandMeta, run: () => void): CommandResult {
    if (this.openTransaction) {
      run();
      return this.result(false, []);
    }
    const deck = this.requireDeck();
    const before = this.present || captureHistorySnapshot(deck);
    const open: OpenTransaction = {
      labels: [],
      invalidations: [],
      createdShapeIds: []
    };
    this.openTransaction = open;
    const close = () => {
      this.openTransaction = null;
      return this.record(
        before,
        this.present || captureHistorySnapshot(deck, before),
        meta.label || open.labels[0] || 'Edit',
        open.invalidations,
        'change',
        open.createdShapeIds,
        meta
      );
    };
    try {
      run();
    } catch (error) {
      close();
      throw error;
    }
    return close();
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
      case 'set-presentation-size': {
        setPresentationSize(deck, command.cx, command.cy);
        invalidations = [{ kind: 'deck' }];
        defaultLabel = 'Resize slides';
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
      case 'set-shape-fill': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireShapeOrGroupMember(slide, command.shapeId);
        setShapeFillColor(deck, slide, shape, command.color);
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Change fill color';
        break;
      }
      case 'set-line-color': {
        const slide = this.requireSlide(command.slideId);
        const shape = this.requireShapeOrGroupMember(slide, command.shapeId);
        setShapeLineColor(deck, slide, shape, command.color);
        invalidations = [
          { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
        ];
        defaultLabel = 'Change line color';
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
      case 'ungroup-shape': {
        const slide = this.requireSlide(command.slideId);
        const group = this.requireShape(slide, command.shapeId);
        createdShapeIds.push(...ungroupShape(deck, slide, group));
        invalidations = [
          {
            kind: 'structure',
            slideId: slide.path,
            shapeIds: [group.id, ...createdShapeIds]
          }
        ];
        defaultLabel = 'Ungroup';
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
      case 'add-slide': {
        // A duplicate source, when named, must exist.
        if (command.duplicateOf) this.requireSlide(command.duplicateOf);
        addSlide(deck, command.atIndex, command.duplicateOf);
        invalidations = [{ kind: 'deck' }];
        defaultLabel = command.duplicateOf ? 'Duplicate slide' : 'Add slide';
        break;
      }
      case 'delete-slide': {
        this.requireSlide(command.slideId);
        deleteSlide(deck, command.slideId);
        invalidations = [{ kind: 'deck' }];
        defaultLabel = 'Delete slide';
        break;
      }
      case 'move-slide': {
        moveSlide(deck, command.fromIndex, command.toIndex);
        invalidations = [{ kind: 'deck' }];
        defaultLabel = 'Move slide';
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
        ? { ...candidate, status: 'accepted' as const, beforeSlides: undefined }
        : candidate
    );
    this.pendingSnapshots.delete(id);
    this.revision += 1;
    return true;
  }

  /**
   * Reject a pending suggestion by restoring its targets from the slide XML before it, refused as a
   * conflict when a target changed since so later work is never overwritten
   */
  rejectChange(
    id: string
  ):
    | { ok: true; results: CommandResult[] }
    | { ok: false; reason: 'not-pending' | 'conflict' } {
    const record = this.changeLog.find((candidate) => candidate.id === id);
    if (!record || record.status !== 'pending')
      return { ok: false, reason: 'not-pending' };
    const snapshots = this.pendingSnapshots.get(id);
    if (!snapshots || !this.isUnchangedSince(record))
      return { ok: false, reason: 'conflict' };

    const deck = this.requireDeck();
    let invalidations: Invalidation[];
    if (record.targets.some((target) => target.slideId === '*')) {
      restoreHistorySnapshot(deck, snapshots.before);
      invalidations = [{ kind: 'deck' }];
    } else {
      const targetsBySlide = new Map<string, Array<string | undefined>>();
      for (const target of record.targets)
        targetsBySlide.set(target.slideId, [
          ...(targetsBySlide.get(target.slideId) ?? []),
          target.shapeId
        ]);
      // Decide every slide before touching any: a whole slide back exactly, shapes back in place, or a conflict
      const plans = [...targetsBySlide].map(([slideId, shapeIds]) => {
        const beforeRaw = snapshots.before.sourceSlides[slideId];
        const afterRaw = snapshots.after.sourceSlides[slideId];
        const currentRaw = this.requireSlide(slideId).raw;
        const untouched =
          JSON.stringify(currentRaw) === JSON.stringify(afterRaw);
        const beforeOrder = shapeOrder(beforeRaw);
        const afterOrder = shapeOrder(afterRaw);
        const shapeTargetIds = shapeIds.filter(
          (shapeId): shapeId is string => !!shapeId
        );
        const shapeTargets = shapeTargetIds.length === shapeIds.length;
        const inPlace =
          shapeTargets &&
          shapeTargetIds.every(
            (shapeId) => !changedPlacement(beforeOrder, afterOrder, shapeId)
          );
        const sameOrder =
          shapeTargets &&
          JSON.stringify(shapeOrder(currentRaw)) === JSON.stringify(afterOrder);
        return {
          slideId,
          beforeRaw,
          shapeIds: shapeTargetIds,
          how: untouched
            ? 'whole'
            : inPlace
            ? 'in-place'
            : sameOrder
            ? 'in-order'
            : 'refused'
        };
      });
      if (plans.some((plan) => plan.how === 'refused'))
        return { ok: false, reason: 'conflict' };
      invalidations = plans.map((plan): Invalidation => {
        if (plan.how === 'whole') {
          restoreSourceSlide(deck, plan.slideId, plan.beforeRaw);
          return { kind: 'slide', slideId: plan.slideId };
        }
        (plan.how === 'in-order' ? restoreShapesInOrder : restoreShapes)(
          deck,
          this.requireSlide(plan.slideId),
          plan.beforeRaw,
          plan.shapeIds
        );
        return {
          kind: 'structure',
          slideId: plan.slideId,
          shapeIds: plan.shapeIds
        };
      });
    }
    const result = this.commit(
      'Reject suggestion',
      invalidations,
      'change',
      [],
      {
        label: 'Reject suggestion',
        authorLabel: 'Reject'
      }
    );
    this.changeLog = this.changeLog.map((candidate) =>
      candidate.id === id
        ? { ...candidate, status: 'rejected' as const, beforeSlides: undefined }
        : candidate
    );
    this.pendingSnapshots.delete(id);
    this.revision += 1;
    return { ok: true, results: [result] };
  }

  // Every target's XML still looks the way the suggestion left it, wherever it sits now
  private isUnchangedSince(record: PptxChangeRecord): boolean {
    const present = this.present;
    const snapshots = this.pendingSnapshots.get(record.id);
    if (!present || !snapshots) return false;
    return record.targets.every((target) => {
      if (target.slideId === '*')
        return sameHistoryDocument(present, snapshots.after);
      const slide = this.deck?.slides.find((s) => s.path === target.slideId);
      const afterRaw = snapshots.after.sourceSlides[target.slideId];
      if (!slide || !afterRaw) return false;
      if (!target.shapeId)
        return JSON.stringify(slide.raw) === JSON.stringify(afterRaw);
      const nodeOf = (raw: OTree) =>
        JSON.stringify(
          slideShapes(raw).find((shape) => shape.id === target.shapeId)?.node ??
            null
        );
      return nodeOf(slide.raw) === nodeOf(afterRaw);
    });
  }

  /** Cheap dirty check against the saved baseline (no snapshot cloning). */
  isDirty(): boolean {
    return !!(
      this.present &&
      this.baseline &&
      !sameHistoryDocument(this.present, this.baseline)
    );
  }

  /** Handle to the current state, to pass to markSaved once an export of it
   *  has been persisted (edits made meanwhile stay dirty). */
  savePoint(): PptxSavePoint | null {
    return this.present;
  }

  /** Mark the save point (default: current state) as the saved baseline;
   *  undo/redo stays intact. */
  markSaved(savePoint?: PptxSavePoint | null): void {
    if (!this.deck) return;
    this.baseline =
      savePoint ?? this.present ?? captureHistorySnapshot(this.deck);
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
    this.pendingSnapshots.clear();
    this.historyRevision += 1;
  }

  dispose(): void {
    this.listeners.clear();
    if (this.deck) {
      releaseObjectUrls(this.deck.pkg);
      releaseEmbeddedFonts(this.deck.pkg);
    }
    this.changeLog = [];
    this.shelvedRecords.clear();
    this.pendingSnapshots.clear();
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
    invalidations = this.groupOwnedInvalidations(invalidations);
    const open = this.openTransaction;
    if (!open)
      return this.record(
        before,
        after,
        label,
        invalidations,
        event,
        createdShapeIds,
        meta
      );
    const changed = !sameHistoryDocument(before, after);
    if (changed) {
      open.labels.push(label);
      open.invalidations.push(...invalidations);
      open.createdShapeIds.push(...createdShapeIds);
    }
    return this.result(changed, invalidations, createdShapeIds);
  }

  private record(
    before: PptxHistorySnapshot,
    after: PptxHistorySnapshot,
    label: string,
    invalidations: Invalidation[],
    event: EditorEvent['kind'],
    createdShapeIds: string[],
    meta: CommandMeta
  ): CommandResult {
    this.present = after;
    if (sameHistoryDocument(before, after)) return this.result(false, []);
    const entryId = ++this.sequence;
    this.undoStack = [
      ...this.undoStack,
      { id: entryId, label, before, after }
    ].slice(-HISTORY_LIMIT);
    this.redoStack = [];
    // Redo is gone, so records shelved by undo can never come back.
    for (const shelved of this.shelvedRecords.values())
      this.pendingSnapshots.delete(shelved.id);
    this.shelvedRecords.clear();
    const changeRecord = deriveChangeRecord({
      transactionId: entryId,
      label,
      meta,
      invalidations,
      beforeDoc: before.document,
      afterDoc: after.document
    });
    if (changeRecord.status === 'pending') {
      this.pendingSnapshots.set(changeRecord.id, { before, after });
      changeRecord.beforeSlides = slidesBefore(changeRecord, before);
    }
    this.changeLog = [...this.changeLog, changeRecord];
    this.revision += 1;
    const result = this.result(true, invalidations, createdShapeIds);
    this.emit(event, result);
    return result;
  }

  // A group member's edit repaints and records as a change to its top-level group
  private groupOwnedInvalidations(
    invalidations: Invalidation[]
  ): Invalidation[] {
    return invalidations.map((invalidation) => {
      if (invalidation.kind !== 'shapes' && invalidation.kind !== 'structure')
        return invalidation;
      const slide = this.deck?.slides.find(
        (candidate) => candidate.path === invalidation.slideId
      );
      if (!slide) return invalidation;
      const ownerIds = invalidation.shapeIds.map((shapeId) => {
        if (slide.shapes.some((shape) => shape.id === shapeId)) return shapeId;
        const group = slide.shapes.find(
          (shape) =>
            shape.type === 'group' && !!findGroupMember([shape], shapeId)
        );
        return group?.id ?? shapeId;
      });
      return { ...invalidation, shapeIds: [...new Set(ownerIds)] };
    });
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
    const shape = this.requireShapeOrGroupMember(slide, shapeId);
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

  // Edits made in place may reach into groups, edits that move or remove a shape may not
  private requireShapeOrGroupMember(slide: Slide, shapeId: string): Shape {
    const shape =
      slide.shapes.find((candidate) => candidate.id === shapeId) ??
      findGroupMember(slide.shapes, shapeId);
    if (!shape)
      throw new Error(`Shape ${shapeId} was not found on ${slide.path}`);
    return shape;
  }
}
