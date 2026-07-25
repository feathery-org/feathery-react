import React, {
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { FONTS, FONT_SIZES, ZOOM_PRESETS } from './constants';
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  BulletListIcon,
  ChevronDownIcon,
  DownloadIcon,
  FitToPageIcon,
  FontColorIcon,
  HeadingOneIcon,
  HeadingThreeIcon,
  HeadingTwoIcon,
  InsertImageIcon,
  ItalicIcon,
  LinkIcon,
  MinusIcon,
  NumberListIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  SignatureIcon,
  SpinnerIcon,
  StrikeIcon,
  TableIcon,
  TextIcon,
  UndoIcon
} from './icons';

const ZINC = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  700: '#3f3f46',
  900: '#18181b'
};
// Feathery primary button colors (matches the dashboard Core Button default).
const FEATHERY_RED = '#e2626e';
const FEATHERY_RED_HOVER = '#dc3a4b';

const STYLES = [
  { label: 'Text', value: 'Normal', Icon: TextIcon },
  { label: 'Heading 1', value: 'Heading 1', Icon: HeadingOneIcon },
  { label: 'Heading 2', value: 'Heading 2', Icon: HeadingTwoIcon },
  { label: 'Heading 3', value: 'Heading 3', Icon: HeadingThreeIcon }
];
const ALIGNMENTS = [
  { value: 'Left', Icon: AlignLeftIcon },
  { value: 'Center', Icon: AlignCenterIcon },
  { value: 'Right', Icon: AlignRightIcon },
  { value: 'Justify', Icon: AlignJustifyIcon }
] as const;

// Inline order of the tool groups, mirroring Word/Google Docs compact
// toolbars. When the row runs out of space, groups collapse tail-first into
// the "More" dropdown — so the most essential controls come first.
const GROUP_KEYS = [
  'history',
  'zoom',
  'style',
  'font',
  'format',
  'align',
  'insert',
  'lists'
] as const;
type GroupKey = typeof GROUP_KEYS[number];
// Slot key for the More trigger in the measurement row.
const MORE_KEY = '__more';
// Gap between group spans in the tool row (and between controls in a group).
const ROW_GAP = 2;
const groupSpan = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: ROW_GAP,
  flex: '0 0 auto'
};

const iconBtn = (active = false, disabled = false) => ({
  display: 'flex',
  height: 32,
  width: 32,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: 'none',
  background: active ? ZINC[200] : 'transparent',
  color: active ? ZINC[900] : ZINC[700],
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  transition: 'background 0.12s',
  '&:hover': disabled ? {} : { background: active ? ZINC[200] : ZINC[100] }
});
const triggerBtn = {
  display: 'flex',
  height: 32,
  alignItems: 'center',
  gap: 4,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  padding: '0 8px',
  fontSize: 14,
  color: ZINC[700],
  cursor: 'pointer',
  transition: 'background 0.12s',
  '&:hover': { background: ZINC[100] }
};
// Panels render in a portal on document.body with fixed positioning (anchored
// to the trigger). Absolute panels inside the toolbar get clipped by the tool
// row's overflow:hidden, and their autoFocus inputs then force-scroll that
// hidden container (breaking the whole row).
const menuPanel = (align: 'start' | 'center' | 'end') => ({
  position: 'fixed' as const,
  transform:
    align === 'center'
      ? 'translateX(-50%)'
      : align === 'end'
      ? 'translateX(-100%)'
      : 'none',
  minWidth: 160,
  background: '#fff',
  border: `1px solid ${ZINC[200]}`,
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  padding: 4,
  maxWidth: 'calc(100vw - 16px)',
  zIndex: 10000
});
const menuItem = (active = false) => ({
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  gap: 8,
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 14,
  textAlign: 'left' as const,
  border: 'none',
  background: active ? ZINC[200] : 'transparent',
  color: ZINC[700],
  cursor: 'pointer',
  '&:hover': { background: ZINC[100] }
});
// Secondary action button (Download) pinned in the toolbar's right region.
const downloadBtn = {
  display: 'flex',
  height: 32,
  alignItems: 'center',
  gap: 6,
  borderRadius: 6,
  border: `1px solid ${ZINC[300]}`,
  background: '#fff',
  padding: '0 10px',
  fontSize: 14,
  fontWeight: 500,
  color: ZINC[700],
  cursor: 'pointer',
  '&:hover': { background: ZINC[50] }
};
// Primary (red) terminal-action button: Download / Sign.
const terminalBtn = (disabled = false) => ({
  display: 'flex',
  height: 32,
  alignItems: 'center',
  gap: 6,
  borderRadius: 6,
  border: 'none',
  background: FEATHERY_RED,
  padding: '0 10px',
  fontSize: 14,
  fontWeight: 500,
  color: '#fff',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  '&:hover': disabled ? {} : { background: FEATHERY_RED_HOVER }
});
const textInput = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box' as const,
  borderRadius: 8,
  border: `1px solid ${ZINC[300]}`,
  background: '#fff',
  padding: '8px 12px',
  fontSize: 14,
  color: ZINC[900],
  outline: 'none',
  '&::placeholder': { color: ZINC[400] },
  '&:focus': {
    borderColor: FEATHERY_RED,
    boxShadow: `0 0 0 1px ${FEATHERY_RED}`
  }
};

function Divider() {
  return (
    <span
      css={{ margin: '0 4px', height: 20, width: 1, background: ZINC[200] }}
    />
  );
}

const MoreIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    width='24'
    height='24'
    viewBox='0 0 24 24'
    fill='currentColor'
    xmlns='http://www.w3.org/2000/svg'
    {...p}
  >
    <circle cx='5' cy='12' r='2' />
    <circle cx='12' cy='12' r='2' />
    <circle cx='19' cy='12' r='2' />
  </svg>
);

interface MenuProps {
  trigger: (o: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'center' | 'end';
  onClose?: () => void;
}

function Menu({ trigger, children, align = 'start', onClose }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const doc = featheryDoc();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      // Ignore clicks on the trigger or inside ANY toolbar menu panel (panels
      // are portaled to body, incl. menus nested inside the "More" panel).
      if (ref.current?.contains(t) || t.closest?.('[data-docx-menu]')) return;
      setOpen(false);
      onClose?.();
    };
    doc.addEventListener('mousedown', onDown);
    return () => doc.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 4,
        left:
          align === 'start'
            ? r.left
            : align === 'center'
            ? r.left + r.width / 2
            : r.right
      });
    }
    setOpen((o) => !o);
  };

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <div css={{ position: 'relative' }} ref={ref}>
      {trigger({ open, toggle })}
      {open &&
        createPortal(
          <div
            data-docx-menu=''
            css={menuPanel(align)}
            style={{ top: pos.top, left: pos.left }}
          >
            {children(close)}
          </div>,
          featheryDoc().body
        )}
    </div>
  );
}

// Word-style grid picker: hover to size, click to insert an R×C table.
function TableGridPicker({
  onPick
}: {
  onPick: (rows: number, cols: number) => void;
}) {
  const MAX = 8;
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <div css={{ padding: 4 }} onMouseLeave={() => setHover({ r: 0, c: 0 })}>
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: `repeat(${MAX}, 18px)`,
          gap: 2
        }}
      >
        {Array.from({ length: MAX * MAX }).map((_, i) => {
          const r = Math.floor(i / MAX);
          const c = i % MAX;
          const active = r <= hover.r && c <= hover.c;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(r + 1, c + 1)}
              css={{
                width: 18,
                height: 18,
                borderRadius: 2,
                cursor: 'pointer',
                border: `1px solid ${active ? FEATHERY_RED : ZINC[300]}`,
                background: active ? `${FEATHERY_RED}33` : '#fff'
              }}
            />
          );
        })}
      </div>
      <div
        css={{
          marginTop: 6,
          fontSize: 13,
          color: ZINC[700],
          textAlign: 'center'
        }}
      >
        {hover.r + 1} × {hover.c + 1}
      </div>
    </div>
  );
}

export interface DocxToolbarProps {
  /** Live Syncfusion DocumentEditor instance. */
  editor: any;
  onSave?: () => void;
  onDownload?: () => void;
  /** When provided, Download becomes a DOCX / PDF menu. */
  onDownloadPdf?: () => void;
  /** True while a download/export is running (disables the control). */
  downloadBusy?: boolean;
  /** PDF variant of the 'download' terminal action. When provided, the red
   *  terminal Download button becomes a DOCX / PDF menu. */
  onTerminalActionPdf?: () => void;
  terminalAction?: 'download' | 'sign';
  onTerminalAction?: () => void;
  terminalActionDisabled?: boolean;
  terminalActionLoading?: boolean;
  saving?: boolean;
  /** Unsaved edits since the last successful save — surfaces an indicator. */
  dirty?: boolean;
  readOnly?: boolean;
}

// Flat toolbar driving the Syncfusion documentEditor API directly (the built-in
// toolbar is disabled on the container). Active states track the editor's
// selectionChange / zoomFactorChange events. When the toolbar is too narrow,
// tool groups collapse tail-first into a "More" dropdown, and they return
// inline as space allows (measured against a hidden copy of the full row).
export default function DocxToolbar({
  editor,
  onSave,
  onDownload,
  onDownloadPdf,
  downloadBusy,
  terminalAction,
  onTerminalAction,
  onTerminalActionPdf,
  terminalActionDisabled,
  terminalActionLoading,
  saving,
  dirty,
  readOnly
}: DocxToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLDivElement | null>(null);
  const measureRowRef = useRef<HTMLDivElement | null>(null);
  // Group spans in the hidden measurement row, keyed by group key (plus
  // MORE_KEY for the More trigger). Elements rather than widths — widths are
  // read fresh on every recompute so in-place resizes can't go stale.
  const measureElsRef = useRef(new Map<string, HTMLElement>());
  const [actionWidth, setActionWidth] = useState(0);
  // How many leading tool groups render inline; the rest live in "More".
  const [visibleCount, setVisibleCount] = useState(GROUP_KEYS.length);
  const [zoom, setZoom] = useState(100);
  const [zoomInput, setZoomInput] = useState('100');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [strike, setStrike] = useState(false);
  const [fontFamily, setFontFamily] = useState('Calibri');
  const [fontSize, setFontSize] = useState(11);
  const [styleName, setStyleName] = useState('Normal');
  const [alignment, setAlignment] = useState('Left');
  const [fontColor, setFontColor] = useState('#000000');
  const [fontQuery, setFontQuery] = useState('');

  useEffect(() => {
    const syncSelection = () => {
      const cf = editor.selection.characterFormat;
      const pf = editor.selection.paragraphFormat;
      setBold(cf.bold);
      setItalic(cf.italic);
      setStrike(cf.strikethrough !== 'None');
      if (cf.fontFamily) setFontFamily(cf.fontFamily);
      if (cf.fontSize) setFontSize(cf.fontSize);
      if (cf.fontColor) setFontColor(cf.fontColor);
      setStyleName(pf.styleName || 'Normal');
      setAlignment(pf.textAlignment || 'Left');
    };
    const syncZoom = () => {
      const pct = Math.round(editor.zoomFactor * 100);
      setZoom(pct);
      setZoomInput(String(pct));
    };

    editor.addEventListener('selectionChange', syncSelection);
    editor.addEventListener('zoomFactorChange', syncZoom);
    syncSelection();
    syncZoom();
    return () => {
      editor.removeEventListener('selectionChange', syncSelection);
      editor.removeEventListener('zoomFactorChange', syncZoom);
    };
  }, [editor]);

  useLayoutEffect(() => {
    const el = actionRef.current;
    if (!el) {
      setActionWidth(0);
      return;
    }
    const updateActionWidth = () =>
      setActionWidth(Math.ceil(el.getBoundingClientRect().width));
    updateActionWidth();
    const observer = new ResizeObserver(updateActionWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dirty, onDownload, onSave, terminalAction, onTerminalAction]);

  // How many leading groups fit in the centered layer, keeping room for the
  // More trigger whenever anything is hidden. Widths come from the hidden
  // measurement row (which always renders every group at natural size), so
  // the result is a pure function of observed sizes — rendering fewer groups
  // can never feed back into the inputs and loop.
  const recompute = () => {
    const center = centerRef.current;
    if (!center) return;
    // -1 tolerance for sub-pixel rounding: err toward collapsing a group one
    // pixel early rather than ever overlapping the action buttons.
    const available = center.getBoundingClientRect().width - 1;
    const els = measureElsRef.current;
    const widths = GROUP_KEYS.map(
      (k) => els.get(k)?.getBoundingClientRect().width ?? 0
    );
    const moreWidth = els.get(MORE_KEY)?.getBoundingClientRect().width ?? 0;
    const rowWidth = (count: number) => {
      let w = 0;
      for (let i = 0; i < count; i++) w += widths[i] + (i > 0 ? ROW_GAP : 0);
      if (count < GROUP_KEYS.length) {
        w += (count > 0 ? ROW_GAP : 0) + moreWidth;
      }
      return w;
    };
    let n = GROUP_KEYS.length;
    while (n > 0 && rowWidth(n) > available) n--;
    setVisibleCount((current) => (current === n ? current : n));
  };

  // Runs pre-paint on mount and again when the action inset lands (at mount
  // the centered layer is measured before actionWidth has flushed, i.e. too
  // wide), so the first paint already shows the fitted row — no overflow
  // flash. In hosted forms the container often gets its final size only
  // after mount, so a one-shot measurement is not enough:
  useLayoutEffect(() => {
    recompute();
  }, [actionWidth]);

  // ...the ResizeObserver keeps the row fitted from then on. The centered
  // layer tracks container/window resizes; the hidden row tracks natural
  // width changes of the tools themselves (e.g. the font-size trigger's
  // label). Neither size depends on visibleCount, so this cannot loop.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(recompute);
    if (centerRef.current) observer.observe(centerRef.current);
    if (measureRowRef.current) observer.observe(measureRowRef.current);
    return () => observer.disconnect();
  }, []);

  const applyZoom = (pct: number) => {
    editor.zoomFactor = Math.min(500, Math.max(50, pct)) / 100;
  };

  const insertImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new (featheryWindow().Image)();
      img.onload = () => editor.editor.insertImage(src, img.width, img.height);
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const insertLink = () => {
    const url = featheryWindow().prompt('Link URL');
    if (url) editor.editor.insertHyperlink(url, editor.selection.text || url);
  };

  const StyleIcon = STYLES.find((s) => s.value === styleName)?.Icon ?? TextIcon;
  const AlignIcon =
    ALIGNMENTS.find((a) => a.value === alignment)?.Icon ?? AlignLeftIcon;
  const filteredFonts = FONTS.filter((f) =>
    f.toLowerCase().includes(fontQuery.toLowerCase())
  );
  const terminalDisabled = !!terminalActionDisabled || !!terminalActionLoading;

  // Tool groups. Essential ones stay inline; the rest collapse into "More".
  const historyGroup = (
    <>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editorHistory.undo()}
        title='Undo'
      >
        <UndoIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editorHistory.redo()}
        title='Redo'
      >
        <RedoIcon width={16} height={16} />
      </button>
    </>
  );

  const zoomGroup = (
    <>
      <button
        type='button'
        css={iconBtn()}
        onClick={() => applyZoom(zoom - 10)}
        title='Zoom out'
      >
        <MinusIcon width={16} height={16} />
      </button>
      <Menu
        align='center'
        onClose={() => setZoomInput(String(zoom))}
        trigger={({ toggle }) => (
          <button
            type='button'
            css={{
              ...triggerBtn,
              width: 56,
              justifyContent: 'center',
              fontVariantNumeric: 'tabular-nums'
            }}
            onClick={toggle}
          >
            {zoom}%
          </button>
        )}
      >
        {(close) => (
          <div css={{ width: 176 }}>
            <input
              css={{ ...textInput, marginBottom: 4 }}
              value={zoomInput}
              autoFocus
              onChange={(e) => setZoomInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const pct = parseInt(zoomInput, 10);
                  if (Number.isFinite(pct)) applyZoom(pct);
                  close();
                }
              }}
            />
            <button
              type='button'
              css={menuItem()}
              onClick={() => {
                editor.fitPage('FitPageWidth');
                const pct = Math.round(editor.zoomFactor * 100);
                setZoom(pct);
                setZoomInput(String(pct));
                close();
              }}
            >
              <FitToPageIcon width={16} height={16} />
              Fit to page
            </button>
            <div css={{ margin: '4px 0', height: 1, background: ZINC[200] }} />
            {ZOOM_PRESETS.map((p) => (
              <button
                type='button'
                key={p}
                css={menuItem(p === zoom)}
                onClick={() => {
                  applyZoom(p);
                  close();
                }}
              >
                {p}%
              </button>
            ))}
          </div>
        )}
      </Menu>
      <button
        type='button'
        css={iconBtn()}
        onClick={() => applyZoom(zoom + 10)}
        title='Zoom in'
      >
        <PlusIcon width={16} height={16} />
      </button>
    </>
  );

  const styleGroup = (
    <Menu
      trigger={({ toggle }) => (
        <button
          type='button'
          css={triggerBtn}
          onClick={toggle}
          title='Text style'
          disabled={readOnly}
        >
          <StyleIcon width={16} height={16} />
          <ChevronDownIcon width={14} height={14} />
        </button>
      )}
    >
      {(close) => (
        <div css={{ width: 176 }}>
          {STYLES.map(({ label, value, Icon }) => (
            <button
              type='button'
              key={value}
              css={menuItem(value === styleName)}
              onClick={() => {
                editor.editor.applyStyle(value, true);
                close();
              }}
            >
              <Icon width={16} height={16} />
              {label}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );

  const fontGroup = (
    <>
      <Menu
        onClose={() => setFontQuery('')}
        trigger={({ toggle }) => (
          <button
            type='button'
            css={{ ...triggerBtn, width: 128, justifyContent: 'space-between' }}
            onClick={toggle}
            disabled={readOnly}
          >
            <span
              css={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              style={{ fontFamily }}
            >
              {fontFamily}
            </span>
            <ChevronDownIcon width={14} height={14} />
          </button>
        )}
      >
        {(close) => (
          <div css={{ width: 224 }}>
            <input
              css={{ ...textInput, marginBottom: 4 }}
              placeholder='Search fonts'
              value={fontQuery}
              autoFocus
              onChange={(e) => setFontQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div css={{ maxHeight: 284, overflowY: 'auto' }}>
              {filteredFonts.map((f) => (
                <button
                  type='button'
                  key={f}
                  css={{ ...menuItem(f === fontFamily), minHeight: 32 }}
                  style={{ fontFamily: f }}
                  onClick={() => {
                    editor.selection.characterFormat.fontFamily = f;
                    close();
                  }}
                >
                  {f}
                </button>
              ))}
              {filteredFonts.length === 0 && (
                <div
                  css={{ padding: '6px 8px', fontSize: 14, color: ZINC[400] }}
                >
                  No fonts
                </div>
              )}
            </div>
          </div>
        )}
      </Menu>
      <select
        css={{ ...triggerBtn, width: 64, cursor: 'pointer' }}
        value={fontSize}
        disabled={readOnly}
        onChange={(e) => {
          const size = Number(e.target.value);
          setFontSize(size);
          editor.selection.characterFormat.fontSize = size;
        }}
      >
        {(FONT_SIZES.includes(fontSize)
          ? FONT_SIZES
          : [...FONT_SIZES, fontSize].sort((a, b) => a - b)
        ).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </>
  );

  const formatGroup = (
    <>
      <button
        type='button'
        css={iconBtn(bold, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.toggleBold()}
        title='Bold'
      >
        <BoldIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(italic, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.toggleItalic()}
        title='Italic'
      >
        <ItalicIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(strike, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.toggleStrikethrough()}
        title='Strikethrough'
      >
        <StrikeIcon width={16} height={16} />
      </button>
      <label
        css={{ ...iconBtn(false, readOnly), position: 'relative' }}
        title='Text color'
      >
        <FontColorIcon width={16} height={16} />
        <span
          css={{
            position: 'absolute',
            bottom: 4,
            height: 2,
            width: 16,
            borderRadius: 2
          }}
          style={{ backgroundColor: fontColor }}
        />
        <input
          type='color'
          css={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none'
          }}
          value={fontColor}
          disabled={readOnly}
          onChange={(e) => {
            setFontColor(e.target.value);
            editor.selection.characterFormat.fontColor = e.target.value;
          }}
        />
      </label>
    </>
  );

  const insertGroup = (
    <>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={insertLink}
        title='Insert link'
      >
        <LinkIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => fileInputRef.current?.click()}
        title='Insert image'
      >
        <InsertImageIcon width={16} height={16} />
      </button>
      <Menu
        trigger={({ toggle }) => (
          <button
            type='button'
            css={iconBtn(false, readOnly)}
            disabled={readOnly}
            onClick={toggle}
            title='Insert table'
          >
            <TableIcon width={16} height={16} />
          </button>
        )}
      >
        {(close) => (
          <TableGridPicker
            onPick={(rows, cols) => {
              editor.editor.insertTable(rows, cols);
              close();
            }}
          />
        )}
      </Menu>
    </>
  );

  const listsGroup = (
    <>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.applyBullet('', 'Symbol')}
        title='Bullet list'
      >
        <BulletListIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.applyNumbering('%1.', 'Arabic')}
        title='Numbered list'
      >
        <NumberListIcon width={16} height={16} />
      </button>
    </>
  );

  const alignGroup = (
    <Menu
      trigger={({ toggle }) => (
        <button
          type='button'
          css={triggerBtn}
          onClick={toggle}
          title='Alignment'
          disabled={readOnly}
        >
          <AlignIcon width={16} height={16} />
          <ChevronDownIcon width={14} height={14} />
        </button>
      )}
    >
      {(close) => (
        <div css={{ display: 'flex', gap: 2 }}>
          {ALIGNMENTS.map(({ value, Icon }) => (
            <button
              type='button'
              key={value}
              css={iconBtn(value === alignment)}
              title={value}
              onClick={() => {
                editor.selection.paragraphFormat.textAlignment = value;
                close();
              }}
            >
              <Icon width={16} height={16} />
            </button>
          ))}
        </div>
      )}
    </Menu>
  );

  const groupNodes: Record<GroupKey, ReactNode> = {
    history: historyGroup,
    zoom: zoomGroup,
    style: styleGroup,
    font: fontGroup,
    format: formatGroup,
    align: alignGroup,
    insert: insertGroup,
    lists: listsGroup
  };

  const setMeasureEl = (key: string) => (el: HTMLSpanElement | null) => {
    if (el) measureElsRef.current.set(key, el);
  };
  // Shared by the visible row and the hidden measurement row so their
  // structures (spans, dividers, gaps) can never drift apart. Collapse is
  // tail-first, so the visible subset is always a prefix of GROUP_KEYS and
  // the index-based leading dividers line up in both rows.
  const renderGroupRow = (keys: readonly GroupKey[], measure: boolean) =>
    keys.map((k, i) => (
      <span key={k} css={groupSpan} ref={measure ? setMeasureEl(k) : undefined}>
        {i > 0 && <Divider />}
        {groupNodes[k]}
      </span>
    ));
  // Breathing room at both toolbar edges so pinned buttons never sit flush
  // against the border. The centered layer mirrors the action side's full
  // clearance (edge padding + action width + gap) on the left, keeping the
  // tool cluster centered.
  const EDGE_PAD = 12;
  const centerSideInset = EDGE_PAD + (actionWidth ? actionWidth + 8 : 0);

  return (
    <div
      css={{
        position: 'relative',
        height: 44,
        flex: '0 0 auto',
        borderBottom: `1px solid ${ZINC[200]}`,
        background: '#fff'
      }}
    >
      {/* Center the editing controls against the editor itself. The right-side
          terminal action is pinned independently, so it gets mirrored as a safe
          inset on the left and cannot pull the tool cluster off-center. */}
      <div
        ref={centerRef}
        css={{
          position: 'absolute',
          left: centerSideInset,
          right: centerSideInset,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 0
        }}
      >
        {/* Hidden measurement row: always renders every group (plus the More
            trigger) at natural width so recompute() can read true sizes even
            while the visible row shows fewer. width: max-content is
            load-bearing — without it this absolutely-positioned row would
            shrink-to-fit and squeeze the spans, corrupting the measurements.
            The clip wrapper keeps the overflowing copy out of the document's
            scrollable area. */}
        <div
          aria-hidden
          css={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            visibility: 'hidden',
            pointerEvents: 'none'
          }}
        >
          <div
            ref={measureRowRef}
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: ROW_GAP,
              width: 'max-content'
            }}
          >
            {renderGroupRow(GROUP_KEYS, true)}
            <span css={groupSpan} ref={setMeasureEl(MORE_KEY)}>
              <Divider />
              <button type='button' css={triggerBtn} tabIndex={-1}>
                <MoreIcon width={16} height={16} />
                <ChevronDownIcon width={14} height={14} />
              </button>
            </span>
          </div>
        </div>

        {/* Visible row: the first visibleCount groups; the rest render inside
            "More". overflow: clip is a safety net only (recompute keeps the
            content within bounds) — clip rather than hidden because a hidden
            box is still programmatically scrollable, so focusing a sub-pixel
            clipped button would shift scrollLeft and misalign the row. */}
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: ROW_GAP,
            maxWidth: '100%',
            overflow: 'clip'
          }}
        >
          {renderGroupRow(GROUP_KEYS.slice(0, visibleCount), false)}
          {visibleCount < GROUP_KEYS.length && (
            <span css={groupSpan}>
              {visibleCount > 0 && <Divider />}
              {/* Remount when membership changes mid-resize: the panel's
                  fixed position is captured at open time and would go stale
                  (and list the wrong groups) otherwise. */}
              <Menu
                key={visibleCount}
                align='end'
                trigger={({ toggle }) => (
                  <button
                    type='button'
                    css={triggerBtn}
                    onClick={toggle}
                    title='More tools'
                  >
                    <MoreIcon width={16} height={16} />
                    <ChevronDownIcon width={14} height={14} />
                  </button>
                )}
              >
                {() => (
                  <div
                    css={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      minWidth: 220,
                      maxHeight: 'min(60vh, 480px)',
                      overflowY: 'auto'
                    }}
                  >
                    {GROUP_KEYS.slice(visibleCount).map((k) => (
                      <div
                        key={k}
                        css={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          flexWrap: 'wrap'
                        }}
                      >
                        {groupNodes[k]}
                      </div>
                    ))}
                  </div>
                )}
              </Menu>
            </span>
          )}
        </div>
      </div>

      {/* Hoisted out of insertGroup: that group renders in both the hidden
          measurement row and the visible row/More panel, and two mounted
          copies would fight over this single ref. */}
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        css={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) insertImageFile(file);
          e.target.value = '';
        }}
      />

      {/* Save / Download / Sign — pinned to the right and measured above so the
          centered editor controls get symmetric clearance on both sides. */}
      <div
        ref={actionRef}
        css={{
          position: 'absolute',
          right: EDGE_PAD,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          justifyContent: 'flex-end',
          gap: 8,
          background: '#fff',
          zIndex: 1
        }}
      >
        {dirty && (
          <span
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: ZINC[500],
              whiteSpace: 'nowrap'
            }}
            title='You have unsaved changes'
          >
            <span
              css={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: FEATHERY_RED,
                flex: '0 0 auto'
              }}
            />
            Unsaved changes
          </span>
        )}
        {onDownload && onDownloadPdf ? (
          <Menu
            align='end'
            trigger={({ toggle }) => (
              <button
                type='button'
                css={{ ...downloadBtn, opacity: downloadBusy ? 0.6 : 1 }}
                onClick={toggle}
                disabled={downloadBusy}
                title={downloadBusy ? 'Preparing download…' : 'Download'}
              >
                {downloadBusy ? (
                  <SpinnerIcon width={16} height={16} />
                ) : (
                  <DownloadIcon width={16} height={16} />
                )}
                Download
                <ChevronDownIcon width={14} height={14} />
              </button>
            )}
          >
            {(close) => (
              <div css={{ width: 200 }}>
                <button
                  type='button'
                  css={menuItem()}
                  onClick={() => {
                    onDownload();
                    close();
                  }}
                >
                  Download as DOCX
                </button>
                <button
                  type='button'
                  css={menuItem()}
                  onClick={() => {
                    onDownloadPdf();
                    close();
                  }}
                >
                  Download as PDF
                </button>
              </div>
            )}
          </Menu>
        ) : onDownload ? (
          <button type='button' css={downloadBtn} onClick={onDownload}>
            <DownloadIcon width={16} height={16} />
            Download
          </button>
        ) : null}
        {terminalAction &&
          onTerminalAction &&
          (terminalAction === 'download' && onTerminalActionPdf ? (
            <Menu
              align='end'
              trigger={({ toggle }) => (
                <button
                  type='button'
                  css={terminalBtn(terminalDisabled)}
                  disabled={terminalDisabled}
                  onClick={toggle}
                  title='Saves changes before downloading'
                >
                  {terminalActionLoading ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <DownloadIcon width={16} height={16} />
                  )}
                  Download
                  <ChevronDownIcon width={14} height={14} />
                </button>
              )}
            >
              {(close) => (
                <div css={{ width: 200 }}>
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onTerminalAction();
                      close();
                    }}
                  >
                    Download as DOCX
                  </button>
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onTerminalActionPdf();
                      close();
                    }}
                  >
                    Download as PDF
                  </button>
                </div>
              )}
            </Menu>
          ) : (
            <button
              type='button'
              css={terminalBtn(terminalDisabled)}
              disabled={terminalDisabled}
              onClick={onTerminalAction}
              title='Saves changes before continuing'
            >
              {terminalActionLoading ? (
                <SpinnerIcon width={16} height={16} />
              ) : terminalAction === 'download' ? (
                <DownloadIcon width={16} height={16} />
              ) : (
                <SignatureIcon width={16} height={16} />
              )}
              {terminalAction === 'download' ? 'Download' : 'Sign'}
            </button>
          ))}
        {onSave && (
          <button
            type='button'
            css={{
              display: 'flex',
              height: 32,
              alignItems: 'center',
              gap: 6,
              borderRadius: 6,
              border: 'none',
              background: FEATHERY_RED,
              padding: '0 12px',
              fontSize: 14,
              fontWeight: 500,
              color: '#fff',
              cursor: saving ? 'default' : 'pointer',
              '&:hover': {
                background: saving ? FEATHERY_RED : FEATHERY_RED_HOVER
              }
            }}
            disabled={saving}
            onClick={onSave}
          >
            {/* Icon slot is a fixed 16px in both states, and the label stays
                "Save", so swapping in the spinner never resizes the button
                (no flicker on quick saves). */}
            {saving ? (
              <SpinnerIcon width={16} height={16} />
            ) : (
              <SaveIcon width={16} height={16} />
            )}
            Save
          </button>
        )}
      </div>
    </div>
  );
}
