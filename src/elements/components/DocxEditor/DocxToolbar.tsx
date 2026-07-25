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
// selectionChange / zoomFactorChange events. When the toolbar is too narrow the
// non-essential groups collapse into a "More" dropdown.
export default function DocxToolbar({
  editor,
  onSave,
  onDownload,
  terminalAction,
  onTerminalAction,
  terminalActionDisabled,
  terminalActionLoading,
  saving,
  dirty,
  readOnly
}: DocxToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Which edges have more tools beyond them, so a shadow can hint at the
  // scrollable overflow on that side. Both true (= no shadows) until the row
  // actually overflows.
  const [scrollEdges, setScrollEdges] = useState({
    atStart: true,
    atEnd: true
  });
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

  // Collapse non-essential groups into "More" if the full tool row doesn't fit.
  // Measured once, synchronously before paint — the editor's container has a
  // fixed size once placed, so no resize observation is needed (and observing
  // caused collapse→expand render loops).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth + 1) setCollapsed(true);
  }, []);

  // +1 tolerance for sub-pixel rounding. When the row doesn't overflow,
  // maxScrollLeft is 0 so both edges read "at" and the shadows stay hidden.
  const updateScrollEdges = () => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft >= maxScrollLeft - 1;
    setScrollEdges((current) =>
      current.atStart === atStart && current.atEnd === atEnd
        ? current
        : { atStart, atEnd }
    );
  };

  // Track overflow from the live scroll metrics — on scroll and on any resize
  // of the row or its content. In hosted forms the editor's container can get
  // its final (narrower) size after this mounts, so a mount-time measurement
  // alone goes stale and would leave overflowing tools without shadows.
  // Observing is safe here: updateScrollEdges only toggles shadow opacity
  // (absolutely positioned), which can't change layout and re-trigger it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollEdges();
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
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

  // Grouping mirrors Word/Google Docs compact toolbars: navigation (zoom) and
  // core text controls (style, font, format, alignment) stay inline; insert
  // actions and lists collapse into "More" first when space runs out.
  const groups = [
    { key: 'history', essential: true, node: historyGroup },
    { key: 'zoom', essential: true, node: zoomGroup },
    { key: 'style', essential: true, node: styleGroup },
    { key: 'font', essential: true, node: fontGroup },
    { key: 'format', essential: true, node: formatGroup },
    { key: 'align', essential: true, node: alignGroup },
    { key: 'insert', essential: false, node: insertGroup },
    { key: 'lists', essential: false, node: listsGroup }
  ];
  const overflowGroups = groups.filter((g) => !g.essential);
  const visibleGroups = collapsed ? groups.filter((g) => g.essential) : groups;
  const renderRow = (gs: typeof groups) =>
    gs.map((g, i) => (
      <React.Fragment key={g.key}>
        {i > 0 && <Divider />}
        {g.node}
      </React.Fragment>
    ));

  return (
    <div
      css={{
        display: 'flex',
        height: 44,
        flex: '0 0 auto',
        alignItems: 'center',
        borderBottom: `1px solid ${ZINC[200]}`,
        background: '#fff',
        padding: '0 12px'
      }}
    >
      {/* Left spacer balances the right action group so the tool cluster stays
          horizontally centered on the page (which is centered in the editor
          below). Both regions grow equally, so the tools sit at true center. */}
      <div aria-hidden css={{ flex: '1 1 0', minWidth: 0 }} />
      {/* Tool row: content-sized and centered by the flanking spacers;
          non-essential groups collapse into a "More" dropdown when the space is
          too narrow. The wrapper is the positioning context for the shadows. */}
      <div
        css={{
          position: 'relative',
          flex: '0 1 auto',
          minWidth: 0,
          display: 'flex'
        }}
      >
        <div
          ref={scrollRef}
          onScroll={updateScrollEdges}
          css={{
            flex: '1 1 auto',
            minWidth: 0,
            // Always keep the row bounded to the container: scroll horizontally
            // when the tools overflow rather than spilling past the editor —
            // never gated on a mount-time measurement, which goes stale when
            // the container gets its final size after mount (hosted forms).
            overflowX: 'auto',
            overflowY: 'hidden',
            display: 'flex',
            alignItems: 'center',
            scrollbarWidth: 'thin' as const,
            '&::-webkit-scrollbar': { height: 6 },
            '&::-webkit-scrollbar-thumb': {
              background: ZINC[300],
              borderRadius: 3
            }
          }}
        >
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: 2
              // No auto-margin centering here: the toolbar's outer spacers
              // center this row, and auto margins inside a scroll container
              // would make the overflowing left edge unreachable.
            }}
          >
            {renderRow(visibleGroups)}
            {collapsed && (
              <>
                <Divider />
                <Menu
                  align='end'
                  trigger={({ toggle }) => (
                    <button
                      type='button'
                      css={triggerBtn}
                      onClick={toggle}
                      title='More tools'
                      disabled={readOnly}
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
                        minWidth: 220
                      }}
                    >
                      {overflowGroups.map((g) => (
                        <div
                          key={g.key}
                          css={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            flexWrap: 'wrap'
                          }}
                        >
                          {g.node}
                        </div>
                      ))}
                    </div>
                  )}
                </Menu>
              </>
            )}
          </div>
        </div>
        {/* Edge shadows: hint at scrollable overflow on whichever side still
            has tools beyond it. Pinned to the wrapper, outside the scroll area
            so they don't move with the content. */}
        <div
          aria-hidden
          css={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 24,
            pointerEvents: 'none',
            background:
              'linear-gradient(to right, rgba(0, 0, 51, 0.1), transparent)',
            opacity: scrollEdges.atStart ? 0 : 1,
            transition: 'opacity 120ms ease'
          }}
        />
        <div
          aria-hidden
          css={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 24,
            pointerEvents: 'none',
            background:
              'linear-gradient(to left, rgba(0, 0, 51, 0.1), transparent)',
            opacity: scrollEdges.atEnd ? 0 : 1,
            transition: 'opacity 120ms ease'
          }}
        />
      </div>

      {/* Save / Download / Sign — right-aligned within a region that grows to
          match the left spacer, keeping the tool cluster centered. */}
      <div
        css={{
          display: 'flex',
          flex: '1 1 0',
          alignItems: 'center',
          paddingLeft: 8,
          justifyContent: 'flex-end',
          gap: 8
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
        {onDownload && (
          <button
            type='button'
            css={{
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
            }}
            onClick={onDownload}
          >
            <DownloadIcon width={16} height={16} />
            Download
          </button>
        )}
        {terminalAction && onTerminalAction && (
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
              padding: '0 10px',
              fontSize: 14,
              fontWeight: 500,
              color: '#fff',
              cursor: terminalDisabled ? 'default' : 'pointer',
              opacity: terminalDisabled ? 0.5 : 1,
              '&:hover': terminalDisabled
                ? {}
                : { background: FEATHERY_RED_HOVER }
            }}
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
        )}
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
