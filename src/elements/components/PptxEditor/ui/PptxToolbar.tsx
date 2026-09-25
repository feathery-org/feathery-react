import React, { useEffect, useRef, useState } from 'react';
import { featheryDoc, featheryWindow } from '../../../../utils/browser';
import {
  usePptxEditorState,
  usePptxEditorStore
} from '../state/PptxEditorContext';
import { readPictureCrop, type TextStyle } from '../core/model/edit';
import {
  tableCell,
  tableCellAlign,
  tableCellFill,
  tableCellGridSpan,
  tableCellRowSpan,
  tableCellVerticalAlign
} from '../core/model/table';
import { child, descendant, getAttr } from '../core/opc/xml';
import { selectedTextRanges } from './textSelection';
import { shortcutHint, withShortcut } from './shortcuts';
import InstantTooltips from './InstantTooltips';
import {
  effectiveSlideSize,
  SLIDE_SIZE_PRESETS
} from '../core/model/slideSize';
import {
  FEATHERY_RED,
  TOOLBAR_HEIGHT,
  ZINC
} from '../../DocxEditor/DocxToolbar/styles';
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BulletListIcon,
  NumberListIcon,
  RedoIcon,
  ShadingIcon,
  UndoIcon
} from '../../DocxEditor/icons';
import type { ShapeInsertion, TableEditOperation } from '../engine';

const FONTS = [
  'Arial',
  'Calibri',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Trebuchet MS',
  'Tahoma'
];

const SHAPE_PRESETS = [
  {
    geometry: 'rect',
    label: 'Rectangle',
    cx: 2000000,
    cy: 1200000,
    icon: 'M4 6h16v12H4z'
  },
  {
    geometry: 'roundRect',
    label: 'Rounded rectangle',
    cx: 2000000,
    cy: 1200000,
    icon: 'M8 6h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4Z'
  },
  {
    geometry: 'ellipse',
    label: 'Ellipse',
    cx: 1600000,
    cy: 1600000,
    icon: 'M12 5a8 6.5 0 1 0 0 13 8 6.5 0 1 0 0-13Z'
  },
  {
    geometry: 'triangle',
    label: 'Triangle',
    cx: 1600000,
    cy: 1400000,
    icon: 'M12 5 20 19H4z'
  },
  {
    geometry: 'diamond',
    label: 'Diamond',
    cx: 1600000,
    cy: 1600000,
    icon: 'M12 4l8 8-8 8-8-8z'
  }
] as const;

// Contextual table tools get a warm tint so they read as tied to the selection,
// mirroring PowerPoint's contextual-tab convention at Feathery visual weight.
const AMBER = '#92610e';

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#fff'
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    minHeight: TOOLBAR_HEIGHT,
    padding: '4px 8px',
    borderBottom: `1px solid ${ZINC[200]}`
  },
  // One persistent styling row: fixed height so contextual groups (table,
  // picture crop) never shift the editor below; popover menus use fixed
  // positioning, so scroll-clipping here cannot cut them off.
  pane: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    height: 42,
    flex: '0 0 auto',
    padding: '4px 8px',
    overflowX: 'auto' as const
  },
  menuPanel: (left: number, top: number, width: number) => ({
    position: 'fixed' as const,
    left,
    top,
    zIndex: 60,
    width,
    padding: 8,
    background: '#fff',
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 8,
    boxShadow: '0 6px 18px rgba(23,26,28,.13)'
  }),
  menuRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 0'
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 8px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: ZINC[700],
    fontSize: 12.5,
    textAlign: 'left' as const,
    cursor: 'pointer',
    '&:hover': { background: ZINC[100], color: ZINC[900] }
  },
  menuDivider: {
    height: 1,
    background: ZINC[200],
    margin: '6px 0'
  },
  btn: (on = false, disabled = false) => ({
    height: 30,
    minWidth: 30,
    padding: '0 7px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    border: 'none',
    borderRadius: 6,
    background: on ? ZINC[200] : 'transparent',
    color: on ? ZINC[900] : ZINC[700],
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const,
    opacity: disabled ? 0.4 : 1,
    transition: 'background .12s',
    '&:hover': disabled ? {} : { background: on ? ZINC[200] : ZINC[100] },
    '&:focus-visible': {
      outline: `2px solid ${FEATHERY_RED}`,
      outlineOffset: 1
    }
  }),
  select: {
    height: 30,
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 6,
    background: '#fff',
    color: ZINC[700],
    fontSize: 12.5,
    padding: '0 6px',
    cursor: 'pointer',
    '&:hover': { background: ZINC[100] },
    '&:disabled': { opacity: 0.4, cursor: 'default' }
  },
  num: (wide = false) => ({
    width: wide ? 60 : 48,
    height: 30,
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 6,
    background: '#fff',
    color: ZINC[700],
    fontSize: 12.5,
    padding: '0 6px',
    '&:disabled': { opacity: 0.4 }
  }),
  color: {
    width: 30,
    height: 30,
    padding: 2,
    background: '#fff',
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 6,
    cursor: 'pointer',
    '&:disabled': { opacity: 0.4, cursor: 'default' }
  },
  sep: {
    width: 1,
    height: 22,
    background: ZINC[200],
    margin: '0 5px',
    flex: '0 0 auto'
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '.05em',
    textTransform: 'uppercase' as const,
    color: ZINC[400],
    padding: '0 4px',
    whiteSpace: 'nowrap' as const
  },
  cropLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    color: ZINC[500]
  },
  slideIndicator: {
    fontSize: 12,
    color: ZINC[400],
    padding: '0 8px',
    whiteSpace: 'nowrap' as const
  },
  tableInsert: { position: 'relative' as const },
  tableMenu: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    zIndex: 40,
    width: 166,
    padding: 8,
    background: '#fff',
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 8,
    boxShadow: '0 6px 18px rgba(23,26,28,.13)'
  },
  tableLabel: {
    display: 'block',
    marginBottom: 6,
    color: ZINC[700],
    fontSize: 12
  },
  tableGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 16px)',
    gap: 3
  },
  tableCell: (active: boolean) => ({
    width: 16,
    height: 16,
    padding: 0,
    border: `1px solid ${active ? FEATHERY_RED : ZINC[300]}`,
    background: active ? 'rgba(226,98,110,.18)' : '#fff',
    cursor: 'pointer'
  })
};

function B(props: {
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  historyAction?: boolean;
}) {
  return (
    <button
      // The editor can sit inside the hosted form's <form>; an untyped button
      // defaults to type=submit and reloads the page.
      type='button'
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.on === undefined ? undefined : props.on}
      disabled={props.disabled}
      onClick={props.onClick}
      // Word-style: toolbar clicks never take focus, so the page cannot
      // scroll-to-focus and the stage's text selection survives.
      onMouseDown={(e) => e.preventDefault()}
      data-history-action={props.historyAction ? '' : undefined}
      css={styles.btn(props.on, props.disabled)}
    >
      {props.children}
    </button>
  );
}

function ColorControl(props: {
  disabled?: boolean;
  value: string;
  onCommit: (value: string) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span
      css={{
        ...styles.btn(false, props.disabled),
        position: 'relative',
        flexDirection: 'column',
        gap: 1,
        padding: '2px 7px 3px'
      }}
      aria-label={props.title}
    >
      <span
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: '15px',
          height: 15
        }}
      >
        {props.children}
      </span>
      <span
        css={{
          width: 16,
          height: 4,
          borderRadius: 1,
          background: props.value,
          boxShadow: `inset 0 0 0 1px ${ZINC[200]}`
        }}
      />
      <CommitColorInput {...props} bare />
    </span>
  );
}

function CommitColorInput(props: {
  disabled?: boolean;
  value: string;
  onCommit: (value: string) => void;
  title: string;
  /** Fill the parent ColorControl invisibly instead of rendering a swatch. */
  bare?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commitRef = useRef(props.onCommit);
  const committedValueRef = useRef(props.value.toLowerCase());
  const fallbackTimerRef = useRef<number | null>(null);
  commitRef.current = props.onCommit;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => {
      if (fallbackTimerRef.current !== null)
        featheryWindow().clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      const value = input.value.toLowerCase();
      if (value === committedValueRef.current) return;
      committedValueRef.current = value;
      commitRef.current(value);
    };
    const scheduleFallback = () => {
      if (fallbackTimerRef.current !== null)
        featheryWindow().clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = featheryWindow().setTimeout(commit, 300);
    };
    // React maps color-input `onChange` to the continuously firing native
    // `input` event. Prefer native `change` so history is written once when the
    // picker is accepted. Some native pickers omit it, so a quiet-period
    // fallback commits only the final input value instead of making every drag
    // sample a history entry.
    input.addEventListener('input', scheduleFallback);
    input.addEventListener('change', commit);
    return () => {
      input.removeEventListener('input', scheduleFallback);
      input.removeEventListener('change', commit);
      if (fallbackTimerRef.current !== null)
        featheryWindow().clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const value = props.value.toLowerCase();
    committedValueRef.current = value;
    if (inputRef.current && inputRef.current.value !== value)
      inputRef.current.value = value;
  }, [props.value]);

  return (
    <input
      ref={inputRef}
      disabled={props.disabled}
      type='color'
      defaultValue={props.value}
      css={
        props.bare
          ? {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: props.disabled ? 'default' : 'pointer',
              border: 'none',
              padding: 0
            }
          : styles.color
      }
      title={props.title}
      aria-label={props.title}
    />
  );
}

/**
 * A toolbar dropdown: click-open panel that closes on outside click or
 * Escape. The panel is position:fixed so the scrollable toolbar row can
 * never clip it.
 */
function MenuButton(props: {
  label: React.ReactNode;
  title: string;
  disabled?: boolean;
  width?: number;
  amber?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const doc = featheryDoc();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('keydown', onKey);
    return () => {
      doc.removeEventListener('mousedown', onDown);
      doc.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span css={{ display: 'inline-flex' }}>
      <button
        ref={btnRef}
        type='button'
        title={props.title}
        aria-label={props.title}
        aria-haspopup='true'
        aria-expanded={open}
        disabled={props.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!open) {
            const r = btnRef.current?.getBoundingClientRect();
            if (r) setPos({ left: r.left, top: r.bottom + 4 });
          }
          setOpen(!open);
        }}
        css={{
          ...styles.btn(open, props.disabled),
          ...(props.amber ? { color: AMBER } : {})
        }}
      >
        {props.label}
        <span css={{ fontSize: 9, color: ZINC[500] }}>▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role='group'
          aria-label={props.title}
          css={styles.menuPanel(pos.left, pos.top, props.width ?? 230)}
        >
          {props.children(close)}
        </div>
      )}
    </span>
  );
}

/**
 * A nested menu row inside a MenuButton panel: hovering the row opens a
 * flyout panel beside it (to the right, flipping left near the viewport
 * edge). Used to collapse the shape list and table-size grid.
 */
function SubMenu(props: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rowRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const width = props.width ?? 200;

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  useEffect(() => cancelClose, []);

  const openFlyout = () => {
    cancelClose();
    const r = rowRef.current?.getBoundingClientRect();
    if (!r) return;
    const win = featheryWindow();
    const overflowRight = r.right + width + 8 > (win.innerWidth ?? Infinity);
    setPos({
      // Overlap the row by 1px so moving the pointer into the flyout never
      // crosses a dead gap that would fire mouseleave and close it.
      left: overflowRight ? r.left - width + 1 : r.right - 1,
      top: r.top - 6
    });
    setOpen(true);
  };
  // Delay closing so a brief transit off the row (into the flyout) does not
  // dismiss the submenu before it can be clicked.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <span
      css={{ display: 'block', position: 'relative' }}
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={rowRef}
        type='button'
        css={styles.menuItem}
        title={props.title}
        aria-haspopup='true'
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openFlyout())}
      >
        {props.icon}
        {props.label}
        <span css={{ marginLeft: 'auto', fontSize: 10, color: ZINC[500] }}>
          ▸
        </span>
      </button>
      {open && (
        <div
          role='group'
          aria-label={props.title}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          css={styles.menuPanel(pos.left, pos.top, width)}
        >
          {props.children}
        </div>
      )}
    </span>
  );
}

export function Toolbar({
  devJson = false,
  rightActions
}: {
  devJson?: boolean;
  /** Host actions (unsaved indicator, Download, Save) pinned to the tab row. */
  rightActions?: React.ReactNode;
}) {
  const imgRef = useRef<HTMLInputElement>(null);
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  const {
    deck,
    activeSlide,
    selectedIds,
    textSelection,
    tableSelection,
    pictureCropModeId,
    showJson,
    undoStack,
    redoStack
  } = state;
  const {
    selectedShape,
    select,
    setPictureCropMode,
    toggleJson,
    undo,
    redo,
    executeCommand
  } = store;
  const { svgRoot, commitSvgTextEdit } = store;

  const slide = deck?.slides[activeSlide];
  const currentSlideSize =
    deck && slide ? effectiveSlideSize(deck, slide) : undefined;
  const currentPreset = currentSlideSize
    ? Object.entries(SLIDE_SIZE_PRESETS).find(
        ([, preset]) =>
          preset.cx === currentSlideSize.cx && preset.cy === currentSlideSize.cy
      )?.[0] || 'custom'
    : 'wide';
  const sh = selectedShape();
  const pictureCrop = sh?.type === 'pic' ? readPictureCrop(sh) : undefined;
  const selectedRange =
    textSelection && textSelection.shapeId === sh?.id
      ? textSelection.ranges[0]
      : undefined;
  const selectedParagraph =
    selectedRange && sh?.text?.paragraphs[selectedRange.paragraph];
  let runAtRange = selectedParagraph?.runs[0];
  if (selectedParagraph && selectedRange) {
    let offset = 0;
    runAtRange =
      selectedParagraph.runs.find((candidate) => {
        const next = offset + candidate.text.length;
        const found = selectedRange.start < next;
        offset = next;
        return found;
      }) || selectedParagraph.runs[selectedParagraph.runs.length - 1];
  }
  const selectedTableRange =
    sh?.type === 'table' && tableSelection?.shapeId === sh.id
      ? tableSelection
      : undefined;
  const selectedCell =
    selectedTableRange && sh
      ? tableCell(
          sh,
          Math.min(selectedTableRange.startRow, selectedTableRange.endRow),
          Math.min(selectedTableRange.startCol, selectedTableRange.endCol)
        )
      : undefined;
  const cellRPr = selectedCell ? descendant(selectedCell, 'a:rPr') : undefined;
  const cellFill = cellRPr ? child(cellRPr, 'a:solidFill') : undefined;
  const cellColor = cellFill ? child(cellFill, 'a:srgbClr') : undefined;
  const tableRun = cellRPr
    ? {
        text: '',
        node: cellRPr,
        bold: getAttr(cellRPr, 'b') === '1',
        italic: getAttr(cellRPr, 'i') === '1',
        underline: !!getAttr(cellRPr, 'u') && getAttr(cellRPr, 'u') !== 'none',
        strike:
          !!getAttr(cellRPr, 'strike') &&
          getAttr(cellRPr, 'strike') !== 'noStrike',
        sizePt: Number(getAttr(cellRPr, 'sz')) / 100 || 12,
        color: cellColor ? getAttr(cellColor, 'val') : undefined,
        highlight:
          child(cellRPr, 'a:highlight') &&
          child(child(cellRPr, 'a:highlight')!, 'a:srgbClr')
            ? getAttr(
                child(child(cellRPr, 'a:highlight')!, 'a:srgbClr')!,
                'val'
              )
            : undefined,
        baselinePct:
          getAttr(cellRPr, 'baseline') === undefined
            ? undefined
            : Number(getAttr(cellRPr, 'baseline')) / 1000,
        font: child(cellRPr, 'a:latin')
          ? getAttr(child(cellRPr, 'a:latin')!, 'typeface')
          : undefined
      }
    : undefined;
  const run =
    runAtRange || sh?.text?.paragraphs.flatMap((p) => p.runs)[0] || tableRun;
  const align0 = selectedCell
    ? tableCellAlign(selectedCell)
    : selectedParagraph?.align || sh?.text?.paragraphs[0]?.align || 'l';
  const verticalAlign0 = selectedCell
    ? tableCellVerticalAlign(selectedCell)
    : 't';
  const bullet0 = selectedParagraph?.bullet || sh?.text?.paragraphs[0]?.bullet;
  const bulletValue =
    !bullet0 || bullet0.kind === 'none'
      ? 'none'
      : bullet0.kind === 'char'
      ? `char:${bullet0.char || '•'}`
      : `auto:${bullet0.scheme || 'arabicPeriod'}`;
  // A slide-number placeholder carries an a:fld of type slidenum; the toolbar
  // button toggles it rather than stacking new ones.
  const slideNumberShape = slide?.shapes.find((candidate) => {
    const fld = descendant(candidate.node, 'a:fld');
    return !!fld && getAttr(fld, 'type') === 'slidenum';
  });
  const isText = !!sh?.text || !!selectedTableRange;
  const hasSel = !!sh;
  // Solid fill applies to auto-shapes and text boxes (not pictures/tables).
  const canFillShape = sh?.type === 'shape' || sh?.type === 'text';
  const isTable = sh?.type === 'table';
  const isPicture = sh?.type === 'pic';
  // Hide the text/fill cluster when it does not apply: a picture (crop tools
  // only) or a table with no cell context. Font editing appears for a table
  // only once a cell is clicked into or its content is selected.
  const hideTextCluster = isPicture || (isTable && !selectedTableRange);

  const [tableHover, setTableHover] = useState({ rows: 3, cols: 3 });
  const [borderTarget, setBorderTarget] = useState<
    'all' | 'outside' | 'inside' | 'top' | 'bottom' | 'left' | 'right' | 'none'
  >('all');
  const [borderDash, setBorderDash] = useState<'solid' | 'dash' | 'dot'>(
    'solid'
  );
  const [borderWidth, setBorderWidth] = useState(1);
  const [borderColor, setBorderColor] = useState('#8896A8');
  const [backgroundColor1, setBackgroundColor1] = useState('#1F4E79');
  const [backgroundColor2, setBackgroundColor2] = useState('#C0143C');
  const [backgroundAngle, setBackgroundAngle] = useState(90);
  const [lastHighlight, setLastHighlight] = useState('F7B801');
  const [backgroundMode, setBackgroundMode] = useState<
    'solid' | 'gradient' | 'image'
  >('solid');
  const resizeSlide = (cx: number, cy: number) => {
    if (!deck || !slide) return;
    executeCommand(
      { type: 'set-slide-size', slideId: slide.path, cx, cy },
      'Resize slide'
    );
  };
  const editTable = (
    operations: TableEditOperation[],
    label = 'Edit table'
  ) => {
    if (!slide || !sh || sh.type !== 'table') return undefined;
    return executeCommand(
      { type: 'edit-table', slideId: slide.path, shapeId: sh.id, operations },
      label
    );
  };
  const insertShape = (
    shape: ShapeInsertion,
    label: string,
    selectCreated = false
  ) => {
    if (!slide) return undefined;
    const result = executeCommand(
      { type: 'insert-shape', slideId: slide.path, shape },
      label
    );
    const shapeId = result?.createdShapeIds[0];
    if (selectCreated && shapeId) select(shapeId);
    return shapeId;
  };
  const applyPictureCrop = (
    patch: Partial<ReturnType<typeof readPictureCrop>>
  ) => {
    if (!deck || !slide || !sh || sh.type !== 'pic' || !pictureCrop) return;
    executeCommand(
      {
        type: 'set-picture-crop',
        slideId: slide.path,
        shapeId: sh.id,
        crop: {
          clipGeometry: patch.clipGeometry || pictureCrop.clipGeometry,
          cropPct: { ...pictureCrop.cropPct, ...(patch.cropPct || {}) }
        }
      },
      'Crop picture'
    );
  };
  const applyPictureGeometry = (value: 'rect' | 'ellipse' | 'circle') => {
    if (!deck || !slide || !sh || sh.type !== 'pic' || !pictureCrop) return;
    const size =
      value === 'circle' && sh.xfrm
        ? Math.min(sh.xfrm.cx, sh.xfrm.cy)
        : undefined;
    executeCommand(
      {
        type: 'set-picture-crop',
        slideId: slide.path,
        shapeId: sh.id,
        crop: {
          ...pictureCrop,
          clipGeometry: value === 'rect' ? 'rect' : 'ellipse'
        },
        ...(size !== undefined ? { geometry: { cx: size, cy: size } } : {})
      },
      'Crop picture'
    );
  };

  const applyText = (patch: TextStyle) => {
    if (!deck || !slide || !sh) return;
    if (sh.type === 'table' && selectedTableRange) {
      editTable(
        [{ kind: 'style-cells', range: selectedTableRange, style: patch }],
        'Format table cells'
      );
      return;
    }
    if (!sh.text) return;
    store.commitSvgTextEdit?.();
    const currentSelection = store.getState().textSelection;
    executeCommand(
      {
        type: 'format-text',
        slideId: slide.path,
        shapeId: sh.id,
        style: patch,
        ...(currentSelection?.shapeId === sh.id &&
        currentSelection.ranges.length
          ? { ranges: currentSelection.ranges }
          : {})
      },
      'Format text'
    );
    store.setTextToolbarPointer(false);
  };
  const captureTextRangeForToolbar = () => {
    if (!svgRoot) return;
    const editor = svgRoot.querySelector(
      '[data-textbody][contenteditable="true"]'
    ) as HTMLElement | null;
    if (!editor) return;
    const ranges = selectedTextRanges(editor, featheryWindow().getSelection());
    const shapeId = (editor.closest('[data-shape-id]') as HTMLElement | null)
      ?.dataset.shapeId;
    store.setTextSelection(
      shapeId && ranges.length ? { shapeId, ranges } : null
    );
    store.setTextToolbarPointer(true);
  };
  const applyAlign = (algn: 'l' | 'ctr' | 'r' | 'just') => {
    if (!deck || !slide || !sh) return;
    if (sh.type === 'table' && selectedTableRange) {
      editTable(
        [{ kind: 'align-cells', range: selectedTableRange, align: algn }],
        'Align table cells'
      );
      return;
    }
    if (!sh.text) return;
    store.commitSvgTextEdit?.();
    executeCommand(
      {
        type: 'set-paragraph-align',
        slideId: slide.path,
        shapeId: sh.id,
        align: algn
      },
      'Align text'
    );
    store.setTextToolbarPointer(false);
  };
  const applyTableVerticalAlign = (vertical: 't' | 'ctr' | 'b') => {
    if (!deck || !slide || !sh || sh.type !== 'table' || !selectedTableRange)
      return;
    editTable(
      [{ kind: 'align-cells', range: selectedTableRange, vertical }],
      'Align table cells'
    );
  };
  const applyBullet = (value: string) => {
    if (!deck || !slide || !sh?.text) return;
    const paragraphIndexes = selectedRange
      ? [selectedRange.paragraph]
      : undefined;
    const bullet =
      value === 'none'
        ? { kind: 'none' as const }
        : value.startsWith('char:')
        ? { kind: 'char' as const, char: value.slice(5) }
        : {
            kind: 'autoNum' as const,
            scheme: value.slice(5),
            startAt: 1,
            font: '+mj-lt'
          };
    executeCommand(
      {
        type: 'set-paragraph-bullet',
        slideId: slide.path,
        shapeId: sh.id,
        bullet,
        paragraphIndexes
      },
      'Change bullets'
    );
  };

  const reorder = (op: 'front' | 'back' | 'forward' | 'backward') => {
    if (!slide || !sh) return;
    const labels = {
      front: 'Bring shape to front',
      back: 'Send shape to back',
      forward: 'Bring shape forward',
      backward: 'Send shape backward'
    };
    executeCommand(
      {
        type: 'reorder-shape',
        slideId: slide.path,
        shapeId: sh.id,
        operation: op
      },
      labels[op]
    );
  };

  const onImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !deck || !slide) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const url = URL.createObjectURL(
      new Blob([bytes], { type: file.type || 'image/png' })
    );
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = url;
    });
    URL.revokeObjectURL(url);
    const maxW = 4 * 914400;
    let cx = (img.naturalWidth || 400) * 9525;
    let cy = (img.naturalHeight || 300) * 9525;
    if (cx > maxW) {
      const k = maxW / cx;
      cx *= k;
      cy *= k;
    }
    insertShape(
      { kind: 'image', bytes, extension: ext, x: 914400, y: 914400, cx, cy },
      'Insert image',
      true
    );
    e.target.value = '';
  };

  // background controls
  const bgImgRef = useRef<HTMLInputElement>(null);
  const onBgImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !slide) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    executeCommand(
      {
        type: 'set-slide-background',
        slideId: slide.path,
        background: { type: 'image', bytes, extension: ext }
      },
      'Set background image'
    );
    e.target.value = '';
  };
  const setSolidBg = (value = backgroundColor1) => {
    if (!slide) return;
    setBackgroundColor1(value);
    executeCommand(
      {
        type: 'set-slide-background',
        slideId: slide.path,
        background: { type: 'solid', color: value.replace('#', '') }
      },
      'Set slide background'
    );
  };
  const setGradientBg = (
    overrides: { color1?: string; color2?: string; angleDeg?: number } = {}
  ) => {
    if (!slide) return;
    executeCommand(
      {
        type: 'set-slide-background',
        slideId: slide.path,
        background: {
          type: 'gradient',
          color1: (overrides.color1 ?? backgroundColor1).replace('#', ''),
          color2: (overrides.color2 ?? backgroundColor2).replace('#', ''),
          angleDeg: overrides.angleDeg ?? backgroundAngle
        }
      },
      'Set gradient background'
    );
  };

  return (
    <InstantTooltips>
      <div
        css={styles.wrap}
        onKeyDown={(e) => {
          // Inside a hosted form, Enter in a toolbar input/select submits the
          // form. Values already commit onChange, so swallow the submit.
          if (
            e.key === 'Enter' &&
            (e.target as HTMLElement).matches('input, select')
          ) {
            e.preventDefault();
          }
        }}
      >
        {/* Top row: history, the Insert / Slide menus, host actions. The
          styling row below stays persistent, so a just-inserted element can
          be styled immediately. */}
        <div css={styles.topRow} role='toolbar' aria-label='Editor actions'>
          <B
            historyAction
            disabled={!undoStack.length && !commitSvgTextEdit}
            onClick={undo}
            title={
              undoStack.length
                ? `Undo ${
                    undoStack[undoStack.length - 1].label
                  } (${shortcutHint('Z')})`
                : commitSvgTextEdit
                ? `Undo current text edit (${shortcutHint('Z')})`
                : 'Nothing to undo'
            }
          >
            <UndoIcon width={16} height={16} />
          </B>
          <B
            historyAction
            disabled={!redoStack.length}
            onClick={redo}
            title={
              redoStack.length
                ? `Redo ${
                    redoStack[redoStack.length - 1].label
                  } (${shortcutHint('Z', true)})`
                : 'Nothing to redo'
            }
          >
            <RedoIcon width={16} height={16} />
          </B>
          <span css={styles.sep} />
          <MenuButton title='Insert' label='Insert' disabled={!slide}>
            {(close) => (
              <>
                <button
                  type='button'
                  css={styles.menuItem}
                  title='Insert text box'
                  onClick={() => {
                    insertShape(
                      {
                        kind: 'text-box',
                        x: 914400,
                        y: 914400,
                        cx: 3000000,
                        cy: 900000,
                        text: 'Text'
                      },
                      'Insert text box',
                      true
                    );
                    close();
                  }}
                >
                  <svg
                    viewBox='0 0 24 24'
                    width={18}
                    height={18}
                    css={{
                      flex: '0 0 auto',
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeWidth: 1.7,
                      strokeLinecap: 'round'
                    }}
                  >
                    <path d='M5 7V5h14v2M12 5v14M9 19h6' />
                  </svg>
                  Text box
                </button>
                <button
                  type='button'
                  css={styles.menuItem}
                  title='Insert image from your computer'
                  onClick={() => {
                    imgRef.current?.click();
                    close();
                  }}
                >
                  <svg
                    viewBox='0 0 24 24'
                    width={18}
                    height={18}
                    css={{
                      flex: '0 0 auto',
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeWidth: 1.7,
                      strokeLinejoin: 'round'
                    }}
                  >
                    <path d='M4 5h16v14H4z' />
                    <path d='M4 16l5-5 4 4 3-3 4 4' />
                    <circle cx='9' cy='9' r='1.4' />
                  </svg>
                  Image…
                </button>
                <div css={styles.menuDivider} />
                <SubMenu
                  title='Shapes'
                  label='Shapes'
                  width={200}
                  icon={
                    <svg
                      viewBox='0 0 24 24'
                      width={18}
                      height={18}
                      css={{
                        flex: '0 0 auto',
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: 1.7,
                        strokeLinejoin: 'round'
                      }}
                    >
                      <path d='M4 6h9v9H4zM14 13a5 5 0 1 0 6 6' />
                    </svg>
                  }
                >
                  {SHAPE_PRESETS.map((preset) => (
                    <button
                      key={preset.geometry}
                      type='button'
                      css={styles.menuItem}
                      onClick={() => {
                        insertShape(
                          {
                            kind: 'auto-shape',
                            geometry: preset.geometry,
                            x: 914400,
                            y: 914400,
                            cx: preset.cx,
                            cy: preset.cy
                          },
                          `Insert ${preset.label.toLowerCase()}`,
                          true
                        );
                        close();
                      }}
                    >
                      <svg
                        viewBox='0 0 24 24'
                        width={18}
                        height={18}
                        css={{
                          flex: '0 0 auto',
                          fill: 'none',
                          stroke: 'currentColor',
                          strokeWidth: 1.7,
                          strokeLinejoin: 'round'
                        }}
                      >
                        <path d={preset.icon} />
                      </svg>
                      {preset.label}
                    </button>
                  ))}
                </SubMenu>
                <SubMenu
                  title='Table'
                  label='Table'
                  width={166}
                  icon={
                    <svg
                      viewBox='0 0 24 24'
                      width={18}
                      height={18}
                      css={{
                        flex: '0 0 auto',
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: 1.7,
                        strokeLinejoin: 'round'
                      }}
                    >
                      <path d='M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14' />
                    </svg>
                  }
                >
                  <span css={styles.tableLabel}>
                    {tableHover.cols} × {tableHover.rows} table
                  </span>
                  <div css={styles.tableGrid}>
                    {Array.from({ length: 48 }, (_, i) => {
                      const row = Math.floor(i / 8) + 1;
                      const col = (i % 8) + 1;
                      const active =
                        row <= tableHover.rows && col <= tableHover.cols;
                      return (
                        <button
                          key={i}
                          type='button'
                          onMouseEnter={() =>
                            setTableHover({ rows: row, cols: col })
                          }
                          onClick={() => {
                            insertShape(
                              {
                                kind: 'table',
                                rows: row,
                                columns: col,
                                x: 914400,
                                y: 1828800,
                                cx: col * 1100000,
                                cy: row * 520000
                              },
                              'Insert table',
                              true
                            );
                            close();
                          }}
                          css={styles.tableCell(active)}
                          aria-label={`${col} columns by ${row} rows`}
                        />
                      );
                    })}
                  </div>
                </SubMenu>
              </>
            )}
          </MenuButton>
          <MenuButton title='Slide' label='Slide' disabled={!slide} width={250}>
            {() => (
              <>
                <span css={styles.tableLabel}>Dimensions</span>
                <div css={styles.menuRow}>
                  <select
                    disabled={!slide}
                    value={currentPreset}
                    onChange={(e) => {
                      const preset =
                        SLIDE_SIZE_PRESETS[
                          e.target.value as keyof typeof SLIDE_SIZE_PRESETS
                        ];
                      if (preset) resizeSlide(preset.cx, preset.cy);
                    }}
                    css={{ ...styles.select, width: '100%' }}
                    title='Size preset for this slide'
                    aria-label='Size preset for this slide'
                  >
                    {Object.entries(SLIDE_SIZE_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label}
                      </option>
                    ))}
                    <option value='custom'>Custom</option>
                  </select>
                </div>
                <div css={styles.menuDivider} />
                <span css={styles.tableLabel}>Background</span>
                <div css={styles.menuRow}>
                  <select
                    value={backgroundMode}
                    onChange={(event) =>
                      setBackgroundMode(
                        event.target.value as 'solid' | 'gradient' | 'image'
                      )
                    }
                    css={styles.select}
                    title='Background type'
                    aria-label='Background type'
                  >
                    <option value='solid'>Solid</option>
                    <option value='gradient'>Gradient</option>
                    <option value='image'>Image</option>
                  </select>
                  {backgroundMode === 'solid' && (
                    <ColorControl
                      value={backgroundColor1}
                      onCommit={setSolidBg}
                      title='Solid background color'
                    >
                      <span
                        css={{
                          width: 12,
                          height: 12,
                          borderRadius: 2,
                          background: backgroundColor1,
                          boxShadow: `inset 0 0 0 1px ${ZINC[300]}`
                        }}
                      />
                    </ColorControl>
                  )}
                  {backgroundMode === 'image' && (
                    <B
                      disabled={!slide}
                      onClick={() => bgImgRef.current?.click()}
                      title='Choose background image'
                    >
                      Choose image…
                    </B>
                  )}
                </div>
                {backgroundMode === 'gradient' && (
                  <div css={styles.menuRow}>
                    {/* Figma-style gradient editor: a live preview bar with a
                      color stop at each end; picking a stop's color applies
                      at once. */}
                    <span
                      css={{
                        position: 'relative',
                        width: 118,
                        height: 24,
                        flex: '0 0 auto',
                        borderRadius: 12,
                        // CSS 0deg points up; the deck's 0deg points right.
                        background: `linear-gradient(${
                          backgroundAngle + 90
                        }deg, ${backgroundColor1}, ${backgroundColor2})`,
                        boxShadow: `inset 0 0 0 1px ${ZINC[300]}`
                      }}
                    >
                      {(
                        [
                          ['start', backgroundColor1, { left: 3 }],
                          ['end', backgroundColor2, { right: 3 }]
                        ] as const
                      ).map(([stop, color, pos]) => (
                        <span
                          key={stop}
                          css={{
                            position: 'absolute',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            boxSizing: 'border-box',
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: color,
                            border: '2px solid #fff',
                            boxShadow: '0 0 0 1px rgba(23,26,28,.35)',
                            ...pos
                          }}
                        >
                          <CommitColorInput
                            value={color}
                            onCommit={(value) => {
                              if (stop === 'start') {
                                setBackgroundColor1(value);
                                setGradientBg({ color1: value });
                              } else {
                                setBackgroundColor2(value);
                                setGradientBg({ color2: value });
                              }
                            }}
                            title={
                              stop === 'start'
                                ? 'Gradient start color'
                                : 'Gradient end color'
                            }
                            bare
                          />
                        </span>
                      ))}
                    </span>
                    <select
                      value={backgroundAngle}
                      onChange={(event) => {
                        const angleDeg = Number(event.target.value);
                        setBackgroundAngle(angleDeg);
                        setGradientBg({ angleDeg });
                      }}
                      css={styles.select}
                      title='Gradient direction'
                      aria-label='Gradient direction'
                    >
                      <option value='0'>→</option>
                      <option value='45'>↘</option>
                      <option value='90'>↓</option>
                      <option value='135'>↙</option>
                      <option value='270'>↑</option>
                    </select>
                  </div>
                )}
              </>
            )}
          </MenuButton>
          <span css={{ flex: 1 }} />
          {devJson && (
            <B on={showJson} onClick={toggleJson} title='Live JSON panel'>
              {'{ }'}
            </B>
          )}
          {rightActions}
        </div>
        {/* Hidden file inputs live outside the menus: closing a menu must not
          unmount the input while the OS file dialog is still open. */}
        <input
          ref={imgRef}
          type='file'
          accept='image/*'
          hidden
          onChange={onImage}
        />
        <input
          ref={bgImgRef}
          type='file'
          accept='image/*'
          hidden
          onChange={onBgImage}
        />

        {/* Persistent styling row. */}
        <div
          css={styles.pane}
          role='toolbar'
          aria-label='Text formatting'
          onMouseDownCapture={captureTextRangeForToolbar}
          onMouseUpCapture={(e) => {
            if (
              (e.target as HTMLElement).matches('input[type="color"], select')
            )
              return;
            store.setTextToolbarPointer(false);
          }}
        >
          {/* The text/fill cluster is hidden when it does not apply (a picture,
            or a table with no active cell) so the contextual tools have room. */}
          {!hideTextCluster && (
            <>
              <select
                disabled={!isText}
                value={run?.font || 'Arial'}
                onChange={(e) => applyText({ font: e.target.value })}
                css={styles.select}
                title='Font'
                aria-label='Font'
              >
                {FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <input
                disabled={!isText}
                type='number'
                min={6}
                max={200}
                value={Math.round(run?.sizePt || 18)}
                onChange={(e) => applyText({ sizePt: Number(e.target.value) })}
                css={styles.num()}
                title='Size'
                aria-label='Size'
              />
              <span css={styles.sep} />
              <B
                disabled={!isText}
                on={!!run?.bold}
                onClick={() => applyText({ bold: !run?.bold })}
                title={withShortcut('Bold', 'B')}
              >
                <b>B</b>
              </B>
              <B
                disabled={!isText}
                on={!!run?.italic}
                onClick={() => applyText({ italic: !run?.italic })}
                title={withShortcut('Italic', 'I')}
              >
                <i>I</i>
              </B>
              <B
                disabled={!isText}
                on={!!run?.underline}
                onClick={() => applyText({ underline: !run?.underline })}
                title={withShortcut('Underline', 'U')}
              >
                <span css={{ textDecoration: 'underline' }}>U</span>
              </B>
              <B
                disabled={!isText}
                on={!!run?.strike}
                onClick={() => applyText({ strike: !run?.strike })}
                title='Strikethrough'
              >
                <span css={{ textDecoration: 'line-through' }}>S</span>
              </B>
              <B
                disabled={!isText}
                on={(run?.baselinePct || 0) > 0}
                onClick={() =>
                  applyText({
                    baselinePct: (run?.baselinePct || 0) > 0 ? 0 : 30
                  })
                }
                title='Superscript'
              >
                <span
                  css={{ display: 'inline-flex', alignItems: 'flex-start' }}
                >
                  x
                  <span css={{ fontSize: 9, transform: 'translateY(-3px)' }}>
                    2
                  </span>
                </span>
              </B>
              <B
                disabled={!isText}
                on={(run?.baselinePct || 0) < 0}
                onClick={() =>
                  applyText({
                    baselinePct: (run?.baselinePct || 0) < 0 ? 0 : -30
                  })
                }
                title='Subscript'
              >
                <span css={{ display: 'inline-flex', alignItems: 'flex-end' }}>
                  x
                  <span css={{ fontSize: 9, transform: 'translateY(3px)' }}>
                    2
                  </span>
                </span>
              </B>
              <ColorControl
                disabled={!isText}
                value={`#${run?.color || '000000'}`}
                onCommit={(value) =>
                  applyText({ color: value.replace('#', '') })
                }
                title='Text color'
              >
                A
              </ColorControl>
              {/* Word-style split control: the button half toggles the highlight
              (pressed = the selection is highlighted), the caret half opens
              the picker for a different color. */}
              <span css={{ display: 'inline-flex', alignItems: 'stretch' }}>
                <button
                  type='button'
                  title={run?.highlight ? 'Remove highlight' : 'Highlight'}
                  disabled={!isText}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    applyText({
                      highlight: run?.highlight ? null : lastHighlight
                    })
                  }
                  css={{
                    ...styles.btn(!!run?.highlight, !isText),
                    flexDirection: 'column',
                    gap: 1,
                    padding: '2px 6px 3px',
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0
                  }}
                >
                  <span
                    css={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 15
                    }}
                  >
                    <svg
                      viewBox='0 0 24 24'
                      width={14}
                      height={14}
                      css={{
                        stroke: 'currentColor',
                        fill: 'none',
                        strokeWidth: 1.9,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round'
                      }}
                    >
                      <path d='m9 11-6 6v3h9l3-3' />
                      <path d='m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4l8 8Z' />
                    </svg>
                  </span>
                  <span
                    css={{
                      width: 16,
                      height: 4,
                      borderRadius: 1,
                      background: `#${run?.highlight || lastHighlight}`,
                      boxShadow: `inset 0 0 0 1px ${ZINC[200]}`
                    }}
                  />
                </button>
                <span
                  css={{
                    ...styles.btn(false, !isText),
                    position: 'relative',
                    minWidth: 14,
                    padding: 0,
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    fontSize: 9,
                    color: ZINC[500]
                  }}
                  aria-label='Highlight color'
                >
                  ▾
                  <CommitColorInput
                    disabled={!isText}
                    value={`#${run?.highlight || lastHighlight}`}
                    onCommit={(value) => {
                      const color = value.replace('#', '');
                      setLastHighlight(color);
                      applyText({ highlight: color });
                    }}
                    title='Text highlight color'
                    bare
                  />
                </span>
              </span>
              <span css={styles.sep} />
              <B
                disabled={!isText}
                on={align0 === 'l'}
                onClick={() => applyAlign('l')}
                title='Left'
              >
                <AlignLeftIcon width={16} height={16} />
              </B>
              <B
                disabled={!isText}
                on={align0 === 'ctr'}
                onClick={() => applyAlign('ctr')}
                title='Center'
              >
                <AlignCenterIcon width={16} height={16} />
              </B>
              <B
                disabled={!isText}
                on={align0 === 'r'}
                onClick={() => applyAlign('r')}
                title='Right'
              >
                <AlignRightIcon width={16} height={16} />
              </B>
              <B
                disabled={!isText}
                on={align0 === 'just'}
                onClick={() => applyAlign('just')}
                title='Justify'
              >
                <AlignJustifyIcon width={16} height={16} />
              </B>
              <span css={styles.sep} />
              <B
                disabled={!sh?.text}
                on={bulletValue.startsWith('char:')}
                onClick={() =>
                  applyBullet(
                    bulletValue.startsWith('char:') ? 'none' : 'char:•'
                  )
                }
                title='Bullets'
              >
                <BulletListIcon width={16} height={16} />
              </B>
              <B
                disabled={!sh?.text}
                on={bulletValue.startsWith('auto:')}
                onClick={() =>
                  applyBullet(
                    bulletValue.startsWith('auto:')
                      ? 'none'
                      : 'auto:arabicPeriod'
                  )
                }
                title='Numbering'
              >
                <NumberListIcon width={16} height={16} />
              </B>
              <span css={styles.sep} />
              <ColorControl
                disabled={!canFillShape}
                value={`#${sh?.fillColor || 'FFFFFF'}`}
                onCommit={(value) => {
                  if (!slide || !sh) return;
                  executeCommand(
                    {
                      type: 'set-shape-fill',
                      slideId: slide.path,
                      shapeId: sh.id,
                      color: value.replace('#', '').toUpperCase()
                    },
                    'Change fill color'
                  );
                }}
                title='Shape fill color'
              >
                <ShadingIcon width={14} height={14} />
              </ColorControl>
              <span css={styles.sep} />
            </>
          )}
          <B
            disabled={!hasSel}
            onClick={() => reorder('front')}
            title='Bring to front'
          >
            ⤒
          </B>
          <B
            disabled={!hasSel}
            onClick={() => reorder('forward')}
            title='Forward'
          >
            ↑
          </B>
          <B
            disabled={!hasSel}
            onClick={() => reorder('backward')}
            title='Backward'
          >
            ↓
          </B>
          <B
            disabled={!hasSel}
            onClick={() => reorder('back')}
            title='Send to back'
          >
            ⤓
          </B>
          <span css={styles.sep} />
          <B
            disabled={!hasSel}
            onClick={() => {
              if (slide && selectedIds.length) {
                executeCommand(
                  {
                    type: 'delete-shapes',
                    slideId: slide.path,
                    shapeIds: selectedIds
                  },
                  selectedIds.length > 1 ? 'Delete shapes' : 'Delete shape'
                );
                select(null);
              }
            }}
            title='Delete (Del)'
          >
            <svg
              viewBox='0 0 24 24'
              width={16}
              height={16}
              css={{
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.8,
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              }}
            >
              <path d='M4 7h16' />
              <path d='M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2' />
              <path d='M6 7l1 12a2 2 0 0 0 2 1.8h6A2 2 0 0 0 17 19l1-12' />
              <path d='M10 11v6M14 11v6' />
            </svg>
          </B>
          <span css={styles.sep} />
          {/* Deck-wide slide-number toggle: not tied to the selection, so it
            lives on the persistent row rather than the Insert menu. Active
            state is shown as red text (no heavy grey fill). */}
          <button
            type='button'
            disabled={!slide}
            aria-pressed={!!slideNumberShape}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              executeCommand(
                {
                  type: 'toggle-deck-slide-numbers',
                  enabled: !slideNumberShape
                },
                slideNumberShape ? 'Remove slide numbers' : 'Add slide numbers'
              )
            }
            title={
              slideNumberShape
                ? 'Remove slide numbers from every slide'
                : 'Add slide numbers to every slide (delete the box on a slide to opt just that slide out)'
            }
            css={{
              ...styles.btn(false, !slide),
              color: slideNumberShape ? FEATHERY_RED : ZINC[700],
              fontWeight: slideNumberShape ? 600 : 500
            }}
          >
            Slide #
          </button>
          {sh?.type === 'pic' && pictureCrop && (
            <>
              <span css={styles.sep} />
              <span css={styles.label}>Picture crop</span>
              <B
                on={pictureCropModeId === sh.id}
                onClick={() =>
                  setPictureCropMode(pictureCropModeId === sh.id ? null : sh.id)
                }
                title={
                  pictureCropModeId === sh.id
                    ? 'Finish cropping picture'
                    : 'Crop picture on slide'
                }
              >
                {pictureCropModeId === sh.id ? 'Done' : 'Crop'}
              </B>
              <select
                value={
                  pictureCrop.clipGeometry === 'ellipse' &&
                  sh.xfrm &&
                  Math.abs(sh.xfrm.cx - sh.xfrm.cy) < 2
                    ? 'circle'
                    : pictureCrop.clipGeometry
                }
                onChange={(event) =>
                  applyPictureGeometry(
                    event.target.value as 'rect' | 'ellipse' | 'circle'
                  )
                }
                css={styles.select}
                title='Crop shape'
                aria-label='Crop shape'
              >
                <option value='rect'>Rectangle</option>
                <option value='ellipse'>Ellipse</option>
                <option value='circle'>Circle</option>
              </select>
              {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
                <label key={`${sh.id}-${edge}`} css={styles.cropLabel}>
                  {edge[0].toUpperCase()}
                  <input
                    key={`${sh.id}-${edge}-${pictureCrop.cropPct[edge]}`}
                    type='number'
                    min='0'
                    max='99'
                    step='1'
                    defaultValue={+pictureCrop.cropPct[edge].toFixed(2)}
                    onChange={(event) =>
                      applyPictureCrop({
                        cropPct: {
                          ...pictureCrop.cropPct,
                          [edge]: Number(event.target.value)
                        }
                      })
                    }
                    css={styles.num()}
                    title={`${edge} source crop percent`}
                  />
                </label>
              ))}
              <B
                onClick={() =>
                  applyPictureCrop({
                    cropPct: { left: 0, top: 0, right: 0, bottom: 0 }
                  })
                }
                title='Reset source crop'
              >
                Reset
              </B>
            </>
          )}
          {isTable &&
            sh &&
            slide &&
            deck &&
            (() => {
              const rangeIsSingle =
                !selectedTableRange ||
                (selectedTableRange.startRow === selectedTableRange.endRow &&
                  selectedTableRange.startCol === selectedTableRange.endCol);
              const selectedIsMerged =
                !!selectedCell &&
                (tableCellGridSpan(selectedCell) > 1 ||
                  tableCellRowSpan(selectedCell) > 1);
              return (
                <>
                  <span css={styles.sep} />
                  {/* Contextual table tools: appear while a table is selected. */}
                  <span
                    role='group'
                    aria-label='Table tools'
                    css={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                      flex: '0 0 auto'
                    }}
                  >
                    <span css={styles.label}>Table</span>
                    <B
                      onClick={() =>
                        editTable([{ kind: 'fit-rows' }], 'Fit table rows')
                      }
                      title='Fit each row to its content'
                    >
                      Fit rows
                    </B>
                    <B
                      disabled={!selectedTableRange || rangeIsSingle}
                      onClick={() => {
                        if (!selectedTableRange) return;
                        const mergedRow = Math.min(
                          selectedTableRange.startRow,
                          selectedTableRange.endRow
                        );
                        const mergedCol = Math.min(
                          selectedTableRange.startCol,
                          selectedTableRange.endCol
                        );
                        const result = editTable(
                          [{ kind: 'merge-cells', range: selectedTableRange }],
                          'Merge table cells'
                        );
                        if (result?.changed)
                          store.setTableSelection({
                            shapeId: sh.id,
                            startRow: mergedRow,
                            startCol: mergedCol,
                            endRow: mergedRow,
                            endCol: mergedCol
                          });
                      }}
                      title='Merge cells'
                    >
                      Merge
                    </B>
                    <B
                      disabled={!selectedTableRange || !selectedIsMerged}
                      onClick={() =>
                        selectedTableRange &&
                        editTable(
                          [
                            {
                              kind: 'unmerge-cells',
                              range: selectedTableRange
                            }
                          ],
                          'Unmerge table cells'
                        )
                      }
                      title='Unmerge cells'
                    >
                      Unmerge
                    </B>
                    {selectedTableRange &&
                      (
                        [
                          [
                            't',
                            'Align text to the top',
                            'M4 5h16M4 9h16M4 13h10'
                          ],
                          [
                            'ctr',
                            'Center text vertically',
                            'M4 8h16M4 12h16M4 16h10'
                          ],
                          [
                            'b',
                            'Align text to the bottom',
                            'M4 11h10M4 15h16M4 19h16'
                          ]
                        ] as const
                      ).map(([vertical, label, linesPath]) => (
                        <B
                          key={vertical}
                          on={verticalAlign0 === vertical}
                          onClick={() => applyTableVerticalAlign(vertical)}
                          title={label}
                        >
                          {/* Word's Align Text icons: a line stack anchored
                              at the top, middle, or bottom of the glyph box. */}
                          <svg
                            viewBox='0 0 24 24'
                            width={16}
                            height={16}
                            css={{
                              fill: 'none',
                              stroke: 'currentColor',
                              strokeWidth: 2,
                              strokeLinecap: 'round'
                            }}
                          >
                            <path d={linesPath} />
                          </svg>
                        </B>
                      ))}
                    <ColorControl
                      value={`#${tableCellFill(selectedCell) || 'FFFFFF'}`}
                      onCommit={(value) =>
                        editTable(
                          selectedTableRange
                            ? [
                                {
                                  kind: 'style-cells',
                                  range: selectedTableRange,
                                  style: { fill: value.replace('#', '') }
                                }
                              ]
                            : [
                                {
                                  kind: 'set-table-style',
                                  fill: value.replace('#', '')
                                }
                              ],
                          'Fill table cells'
                        )
                      }
                      title={
                        selectedTableRange
                          ? 'Selected cell fill'
                          : 'Table cell fill'
                      }
                    >
                      <ShadingIcon width={14} height={14} />
                    </ColorControl>
                    <MenuButton
                      title='Table borders'
                      label='Borders'
                      width={216}
                    >
                      {(close) => (
                        <>
                          <div css={styles.menuRow}>
                            <select
                              value={borderTarget}
                              onChange={(e) =>
                                setBorderTarget(
                                  e.target.value as typeof borderTarget
                                )
                              }
                              css={{ ...styles.select, width: '100%' }}
                              title='Borders to apply'
                              aria-label='Borders to apply'
                            >
                              <option value='all'>All borders</option>
                              <option value='outside'>Outside</option>
                              <option value='inside'>Inside</option>
                              <option value='top'>Top</option>
                              <option value='bottom'>Bottom</option>
                              <option value='left'>Left</option>
                              <option value='right'>Right</option>
                              <option value='none'>No borders</option>
                            </select>
                          </div>
                          <div css={styles.menuRow}>
                            <select
                              value={borderDash}
                              onChange={(e) =>
                                setBorderDash(
                                  e.target.value as typeof borderDash
                                )
                              }
                              css={styles.select}
                              title='Border style'
                              aria-label='Border style'
                            >
                              <option value='solid'>Solid</option>
                              <option value='dash'>Dashed</option>
                              <option value='dot'>Dotted</option>
                            </select>
                            <input
                              type='number'
                              min='0.25'
                              max='12'
                              step='0.25'
                              value={borderWidth}
                              onChange={(e) =>
                                setBorderWidth(Number(e.target.value))
                              }
                              css={styles.num()}
                              title='Border width (pt)'
                              aria-label='Border width (pt)'
                            />
                            <input
                              type='color'
                              value={borderColor}
                              onChange={(e) => setBorderColor(e.target.value)}
                              css={styles.color}
                              title='Border color'
                              aria-label='Border color'
                            />
                          </div>
                          <div css={styles.menuRow}>
                            <B
                              onClick={() => {
                                editTable(
                                  [
                                    {
                                      kind: 'set-borders',
                                      range: selectedTableRange,
                                      target: borderTarget,
                                      color: borderColor.replace('#', ''),
                                      widthPt: borderWidth,
                                      dash: borderDash
                                    }
                                  ],
                                  'Style table borders'
                                );
                                close();
                              }}
                              title='Apply borders'
                            >
                              Apply
                            </B>
                          </div>
                        </>
                      )}
                    </MenuButton>
                  </span>
                </>
              );
            })()}
        </div>
      </div>
    </InstantTooltips>
  );
}
