import React, { useEffect, useRef, useState } from 'react';
import { featheryWindow } from '../../../../utils/browser';
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
  tableCellVerticalAlign,
  tableColumns,
  tableRows
} from '../core/model/table';
import { child, descendant, getAttr } from '../core/opc/xml';
import { selectedTextRanges } from './textSelection';
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
const AMBER_WASH = '#fdf6e7';

type TabKey = 'home' | 'insert' | 'slide' | 'table';

const TAB_LABELS: Record<Exclude<TabKey, 'table'>, string> = {
  home: 'Home',
  insert: 'Insert',
  slide: 'Slide'
};

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#fff'
  },
  tabRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    minHeight: TOOLBAR_HEIGHT,
    padding: '4px 8px 0',
    borderBottom: `1px solid ${ZINC[200]}`
  },
  tab: (active: boolean, contextual = false) => ({
    border: 'none',
    background: 'transparent',
    fontSize: 12.5,
    fontWeight: 600,
    color: active ? ZINC[900] : contextual ? AMBER : ZINC[500],
    padding: '10px 12px',
    borderRadius: '7px 7px 0 0',
    cursor: 'pointer',
    borderBottom: `2px solid ${
      active ? (contextual ? AMBER : FEATHERY_RED) : 'transparent'
    }`,
    transition: 'background .12s',
    '&:hover': { background: ZINC[100], color: ZINC[900] }
  }),
  // Fixed height: every tab's pane is the same size, so switching tabs never
  // shifts the editor below. Only the Insert pane opts out of scroll-clipping
  // (its dropdown menus must escape the row).
  pane: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    height: 42,
    flex: '0 0 auto',
    padding: '4px 8px',
    overflowX: 'auto' as const
  },
  paneWithMenus: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    height: 42,
    flex: '0 0 auto',
    padding: '4px 8px',
    overflow: 'visible' as const
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
    />
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
  const isTable = sh?.type === 'table';

  const [tab, setTab] = useState<TabKey>('home');
  // The Table tab is contextual: it appears (and takes focus) when a table is
  // selected, and hands back to Home when the selection leaves the table.
  const wasTableRef = useRef(false);
  useEffect(() => {
    if (isTable && !wasTableRef.current) setTab('table');
    else if (!isTable)
      setTab((current) => (current === 'table' ? 'home' : current));
    wasTableRef.current = isTable;
  }, [isTable]);
  const activeTab: TabKey = tab === 'table' && !isTable ? 'home' : tab;

  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [tableHover, setTableHover] = useState({ rows: 3, cols: 3 });
  const [columnIndex, setColumnIndex] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);
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

  const tabButton = (key: Exclude<TabKey, 'table'>) => (
    <button
      key={key}
      type='button'
      role='tab'
      aria-selected={activeTab === key}
      onClick={() => setTab(key)}
      css={styles.tab(activeTab === key)}
    >
      {TAB_LABELS[key]}
    </button>
  );

  return (
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
      {/* Tab row: history is always reachable; the Table tab is contextual. */}
      <div css={styles.tabRow} role='tablist' aria-label='Editor tools'>
        <B
          historyAction
          disabled={!undoStack.length && !commitSvgTextEdit}
          onClick={undo}
          title={
            undoStack.length
              ? `Undo ${undoStack[undoStack.length - 1].label}`
              : commitSvgTextEdit
              ? 'Undo current text edit'
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
              ? `Redo ${redoStack[redoStack.length - 1].label}`
              : 'Nothing to redo'
          }
        >
          <RedoIcon width={16} height={16} />
        </B>
        <span css={styles.sep} />
        {tabButton('home')}
        {tabButton('insert')}
        {tabButton('slide')}
        {isTable && (
          <button
            type='button'
            role='tab'
            aria-selected={activeTab === 'table'}
            onClick={() => setTab('table')}
            css={styles.tab(activeTab === 'table', true)}
          >
            Table
          </button>
        )}
        <span css={{ flex: 1 }} />
        {devJson && (
          <B on={showJson} onClick={toggleJson} title='Live JSON panel'>
            {'{ }'}
          </B>
        )}
        {rightActions}
      </div>

      {/* ---- Home ---- */}
      {activeTab === 'home' && (
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
          <select
            disabled={!isText}
            value={run?.font || 'Arial'}
            onChange={(e) => applyText({ font: e.target.value })}
            css={styles.select}
            title='Font'
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
          />
          <span css={styles.sep} />
          <B
            disabled={!isText}
            on={!!run?.bold}
            onClick={() => applyText({ bold: !run?.bold })}
            title='Bold'
          >
            <b>B</b>
          </B>
          <B
            disabled={!isText}
            on={!!run?.italic}
            onClick={() => applyText({ italic: !run?.italic })}
            title='Italic'
          >
            <i>I</i>
          </B>
          <B
            disabled={!isText}
            on={!!run?.underline}
            onClick={() => applyText({ underline: !run?.underline })}
            title='Underline'
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
              applyText({ baselinePct: (run?.baselinePct || 0) > 0 ? 0 : 30 })
            }
            title='Superscript'
          >
            <span css={{ display: 'inline-flex', alignItems: 'flex-start' }}>
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
              applyText({ baselinePct: (run?.baselinePct || 0) < 0 ? 0 : -30 })
            }
            title='Subscript'
          >
            <span css={{ display: 'inline-flex', alignItems: 'flex-end' }}>
              x
              <span css={{ fontSize: 9, transform: 'translateY(3px)' }}>2</span>
            </span>
          </B>
          <ColorControl
            disabled={!isText}
            value={`#${run?.color || '000000'}`}
            onCommit={(value) => applyText({ color: value.replace('#', '') })}
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
              applyBullet(bulletValue.startsWith('char:') ? 'none' : 'char:•')
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
                bulletValue.startsWith('auto:') ? 'none' : 'auto:arabicPeriod'
              )
            }
            title='Numbering'
          >
            <NumberListIcon width={16} height={16} />
          </B>
          <span css={styles.sep} />
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
            title='Delete'
          >
            🗑
          </B>
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
        </div>
      )}

      {/* ---- Insert ---- */}
      {activeTab === 'insert' && (
        <div css={styles.paneWithMenus} role='toolbar' aria-label='Insert'>
          <B
            disabled={!slide}
            onClick={() =>
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
              )
            }
          >
            +Text
          </B>
          <div css={styles.tableInsert}>
            <B
              disabled={!slide}
              on={shapePickerOpen}
              onClick={() => {
                setTablePickerOpen(false);
                setShapePickerOpen((open) => !open);
              }}
              title='Insert shape'
            >
              +Shape ▾
            </B>
            {shapePickerOpen && (
              <div
                css={{ ...styles.tableMenu, width: 200 }}
                onMouseLeave={() => setShapePickerOpen(false)}
              >
                <span css={styles.tableLabel}>Shapes</span>
                <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {SHAPE_PRESETS.map((preset) => (
                    <button
                      key={preset.geometry}
                      type='button'
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
                        setShapePickerOpen(false);
                      }}
                      css={{
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
                </div>
              </div>
            )}
          </div>
          <div css={styles.tableInsert}>
            <B
              disabled={!slide}
              on={tablePickerOpen}
              onClick={() => {
                setShapePickerOpen(false);
                setTablePickerOpen((open) => !open);
              }}
              title='Insert table'
            >
              +Table ▾
            </B>
            {tablePickerOpen && (
              <div
                css={styles.tableMenu}
                onMouseLeave={() => setTablePickerOpen(false)}
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
                          setTablePickerOpen(false);
                        }}
                        css={styles.tableCell(active)}
                        aria-label={`${col} columns by ${row} rows`}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <B disabled={!slide} onClick={() => imgRef.current?.click()}>
            +Image
          </B>
          <input
            ref={imgRef}
            type='file'
            accept='image/*'
            hidden
            onChange={onImage}
          />
          <B
            disabled={!slide}
            on={!!slideNumberShape}
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
          >
            Slide #
          </B>
        </div>
      )}

      {/* ---- Slide ---- */}
      {activeTab === 'slide' && (
        <div css={styles.pane} role='toolbar' aria-label='Slide setup'>
          <span css={styles.label}>Size</span>
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
            css={styles.select}
            title='Size preset for this slide'
          >
            {Object.entries(SLIDE_SIZE_PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
            <option value='custom'>Custom</option>
          </select>
          <input
            disabled={!slide}
            key={`sw-${activeSlide}-${currentSlideSize?.cx}`}
            type='number'
            min='1'
            step='0.1'
            defaultValue={((currentSlideSize?.cx || 0) / 914400).toFixed(2)}
            onChange={(e) =>
              resizeSlide(
                Number(e.target.value) * 914400,
                currentSlideSize?.cy || 6858000
              )
            }
            css={styles.num(true)}
            title='Slide width (inches)'
          />
          <span css={styles.label}>×</span>
          <input
            disabled={!slide}
            key={`sh-${activeSlide}-${currentSlideSize?.cy}`}
            type='number'
            min='1'
            step='0.1'
            defaultValue={((currentSlideSize?.cy || 0) / 914400).toFixed(2)}
            onChange={(e) =>
              resizeSlide(
                currentSlideSize?.cx || 12192000,
                Number(e.target.value) * 914400
              )
            }
            css={styles.num(true)}
            title='Slide height (inches)'
          />
          <span css={styles.sep} />
          <span css={styles.label}>Background</span>
          <select
            value={backgroundMode}
            onChange={(event) =>
              setBackgroundMode(
                event.target.value as 'solid' | 'gradient' | 'image'
              )
            }
            css={styles.select}
            title='Background type'
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
          {backgroundMode === 'gradient' && (
            <>
              {/* Figma-style gradient editor: a live preview bar with a color
                  stop at each end; picking a stop's color applies at once. */}
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
                      top: 3,
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
              >
                <option value='0'>→</option>
                <option value='45'>↘</option>
                <option value='90'>↓</option>
                <option value='135'>↙</option>
                <option value='270'>↑</option>
              </select>
            </>
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
          <input
            ref={bgImgRef}
            type='file'
            accept='image/*'
            hidden
            onChange={onBgImage}
          />
        </div>
      )}

      {/* ---- Table (contextual) ---- */}
      {activeTab === 'table' &&
        isTable &&
        sh &&
        slide &&
        deck &&
        (() => {
          const cols = tableColumns(sh);
          const rows = tableRows(sh);
          const activeColumn = Math.min(
            columnIndex,
            Math.max(0, cols.length - 1)
          );
          const activeRow = Math.min(rowIndex, Math.max(0, rows.length - 1));
          const col = cols[activeColumn];
          const row = rows[activeRow];
          const rangeIsSingle =
            !selectedTableRange ||
            (selectedTableRange.startRow === selectedTableRange.endRow &&
              selectedTableRange.startCol === selectedTableRange.endCol);
          const selectedIsMerged =
            !!selectedCell &&
            (tableCellGridSpan(selectedCell) > 1 ||
              tableCellRowSpan(selectedCell) > 1);
          return (
            <div
              css={{ ...styles.pane, background: AMBER_WASH }}
              role='toolbar'
              aria-label='Table tools'
            >
              <B
                onClick={() =>
                  editTable([{ kind: 'add-row' }], 'Add table row')
                }
                title='Add row'
              >
                +R
              </B>
              <B
                onClick={() =>
                  editTable([{ kind: 'remove-row' }], 'Remove table row')
                }
                title='Remove last row'
              >
                −R
              </B>
              <B
                onClick={() =>
                  editTable([{ kind: 'add-column' }], 'Add table column')
                }
                title='Add column'
              >
                +C
              </B>
              <B
                onClick={() =>
                  editTable([{ kind: 'remove-column' }], 'Remove table column')
                }
                title='Remove last column'
              >
                −C
              </B>
              <span css={styles.sep} />
              <select
                value={activeColumn}
                onChange={(e) => setColumnIndex(Number(e.target.value))}
                css={styles.select}
                title='Column to resize'
              >
                {cols.map((_, i) => (
                  <option key={i} value={i}>
                    C{i + 1}
                  </option>
                ))}
              </select>
              <input
                key={`cw-${sh.id}-${activeColumn}`}
                type='number'
                min='0.1'
                step='0.1'
                defaultValue={((Number(col?.[':@']?.w) || 0) / 914400).toFixed(
                  2
                )}
                onChange={(e) =>
                  editTable(
                    [
                      {
                        kind: 'set-column-width',
                        index: activeColumn,
                        width: Number(e.target.value) * 914400
                      }
                    ],
                    'Resize table column'
                  )
                }
                css={styles.num(true)}
                title='Column width (inches)'
              />
              <select
                value={activeRow}
                onChange={(e) => setRowIndex(Number(e.target.value))}
                css={styles.select}
                title='Row to resize'
              >
                {rows.map((_, i) => (
                  <option key={i} value={i}>
                    R{i + 1}
                  </option>
                ))}
              </select>
              <input
                key={`rh-${sh.id}-${activeRow}`}
                type='number'
                min='0.1'
                step='0.1'
                defaultValue={((Number(row?.[':@']?.h) || 0) / 914400).toFixed(
                  2
                )}
                onChange={(e) =>
                  editTable(
                    [
                      {
                        kind: 'set-row-height',
                        index: activeRow,
                        height: Number(e.target.value) * 914400
                      }
                    ],
                    'Resize table row'
                  )
                }
                css={styles.num(true)}
                title='Row height (inches)'
              />
              <B
                onClick={() =>
                  editTable([{ kind: 'fit-rows' }], 'Fit table rows')
                }
                title='Fit each row to its content'
              >
                Fit rows
              </B>
              <span css={styles.sep} />
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
                    [{ kind: 'unmerge-cells', range: selectedTableRange }],
                    'Unmerge table cells'
                  )
                }
                title='Unmerge cells'
              >
                Unmerge
              </B>
              <span css={styles.sep} />
              {selectedTableRange && (
                <>
                  <B
                    on={verticalAlign0 === 't'}
                    onClick={() => applyTableVerticalAlign('t')}
                    title='Align cell top'
                  >
                    ⇡
                  </B>
                  <B
                    on={verticalAlign0 === 'ctr'}
                    onClick={() => applyTableVerticalAlign('ctr')}
                    title='Align cell middle'
                  >
                    ↕
                  </B>
                  <B
                    on={verticalAlign0 === 'b'}
                    onClick={() => applyTableVerticalAlign('b')}
                    title='Align cell bottom'
                  >
                    ⇣
                  </B>
                  <span css={styles.sep} />
                </>
              )}
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
                  selectedTableRange ? 'Selected cell fill' : 'Table cell fill'
                }
              >
                <ShadingIcon width={14} height={14} />
              </ColorControl>
              <span css={styles.label}>Borders</span>
              <select
                value={borderTarget}
                onChange={(e) =>
                  setBorderTarget(e.target.value as typeof borderTarget)
                }
                css={styles.select}
                title='Borders to apply'
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
              <select
                value={borderDash}
                onChange={(e) =>
                  setBorderDash(e.target.value as typeof borderDash)
                }
                css={styles.select}
                title='Border style'
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
                onChange={(e) => setBorderWidth(Number(e.target.value))}
                css={styles.num()}
                title='Border width (pt)'
              />
              <input
                type='color'
                value={borderColor}
                onChange={(e) => setBorderColor(e.target.value)}
                css={styles.color}
                title='Border color'
              />
              <B
                onClick={() =>
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
                  )
                }
                title='Apply borders'
              >
                Apply
              </B>
            </div>
          );
        })()}
    </div>
  );
}
