import type {
  PictureCrop,
  RichPara,
  TableBorderTarget,
  TableCellRange,
  TextRange,
  TextStyle
} from '../core/model/edit';
import type { Bullet, Xfrm } from '../core/model/types';

export interface ShapeGeometryUpdate {
  shapeId: string;
  geometry: Partial<Xfrm>;
}

export type ShapeInsertion =
  | {
      kind: 'text-box';
      x: number;
      y: number;
      cx: number;
      cy: number;
      text?: string;
    }
  | {
      kind: 'auto-shape';
      geometry: string;
      x: number;
      y: number;
      cx: number;
      cy: number;
      fill?: string;
    }
  | {
      kind: 'table';
      rows: number;
      columns: number;
      x: number;
      y: number;
      cx: number;
      cy: number;
    }
  | {
      kind: 'image';
      bytes: Uint8Array;
      extension: string;
      x: number;
      y: number;
      cx: number;
      cy: number;
    }
  | { kind: 'slide-number'; displayNumber: number };

export type SlideBackground =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; color1: string; color2: string; angleDeg: number }
  | { type: 'image'; bytes: Uint8Array; extension: string };

export type TableEditOperation =
  | { kind: 'set-cell-text'; row: number; col: number; value: string }
  | { kind: 'add-row' }
  | { kind: 'remove-row' }
  | { kind: 'add-column' }
  | { kind: 'remove-column' }
  | { kind: 'set-column-width'; index: number; width: number }
  | { kind: 'set-row-height'; index: number; height: number }
  | { kind: 'fit-rows' }
  | { kind: 'fit-column'; index: number }
  | { kind: 'fit-row'; index: number }
  | { kind: 'merge-cells'; range: TableCellRange }
  | { kind: 'unmerge-cells'; range: TableCellRange }
  | {
      kind: 'style-cells';
      range?: TableCellRange;
      style: TextStyle & { fill?: string };
    }
  | {
      kind: 'align-cells';
      range?: TableCellRange;
      align?: 'l' | 'ctr' | 'r' | 'just';
      vertical?: 't' | 'ctr' | 'b';
    }
  | {
      kind: 'set-borders';
      range?: TableCellRange;
      target: TableBorderTarget;
      color: string;
      widthPt: number;
      dash: 'solid' | 'dash' | 'dot';
    }
  | { kind: 'set-table-style'; fill?: string; border?: string }
  | { kind: 'set-geometry'; geometry: Partial<Xfrm> };

export type EditorCommand =
  | { type: 'set-slide-size'; slideId: string; cx: number; cy: number }
  | {
      type: 'set-slide-background';
      slideId: string;
      background: SlideBackground;
    }
  | {
      type: 'format-text';
      slideId: string;
      shapeId: string;
      style: TextStyle;
      ranges?: TextRange[];
    }
  | {
      type: 'set-paragraph-align';
      slideId: string;
      shapeId: string;
      align: 'l' | 'ctr' | 'r' | 'just';
      paragraphIndexes?: number[];
    }
  | {
      type: 'set-paragraph-bullet';
      slideId: string;
      shapeId: string;
      bullet: Bullet;
      paragraphIndexes?: number[];
    }
  | {
      type: 'replace-rich-text';
      slideId: string;
      shapeId: string;
      paragraphs: RichPara[];
    }
  | {
      type: 'set-shape-geometries';
      slideId: string;
      updates: ShapeGeometryUpdate[];
    }
  | {
      type: 'set-picture-crop';
      slideId: string;
      shapeId: string;
      crop: PictureCrop;
      geometry?: Partial<Xfrm>;
    }
  | {
      type: 'edit-table';
      slideId: string;
      shapeId: string;
      operations: TableEditOperation[];
    }
  | { type: 'insert-shape'; slideId: string; shape: ShapeInsertion }
  | { type: 'delete-shapes'; slideId: string; shapeIds: string[] }
  | {
      type: 'reorder-shape';
      slideId: string;
      shapeId: string;
      operation: 'front' | 'back' | 'forward' | 'backward';
    };

export type Invalidation =
  | { kind: 'shapes'; slideId: string; shapeIds: string[] }
  | { kind: 'structure'; slideId: string; shapeIds: string[] }
  | { kind: 'background'; slideId: string }
  | { kind: 'slide'; slideId: string }
  | { kind: 'deck' };

export interface CommandMeta {
  label?: string;
  origin?: 'editor' | 'json' | 'binding' | 'assistant';
}
