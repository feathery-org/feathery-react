import React, { useEffect, useRef, useState } from 'react';
import { featheryDoc } from '../../../../utils/browser';
import { renderSlideSvg } from '../core/render/svg';
import {
  INK,
  INK_3,
  LINE,
  PANEL,
  PAPER
} from '../../DocxEditor/TrackedChangeGroups/styles';
import {
  usePptxEditorState,
  usePptxEditorStore
} from '../state/PptxEditorContext';

// Left slide navigator: real SVG thumbnails from the same renderer, cached per
// slide revision. Virtualize only if large decks show a measurable need.

const NAV_WIDTH = 200;

function SlideThumbnail({
  slideIndex,
  rev
}: {
  slideIndex: number;
  rev: number;
}) {
  const store = usePptxEditorStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<{ rev: number; svg: SVGSVGElement } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const { deck } = store.getState();
    const slide = deck?.slides[slideIndex];
    if (!host || !deck || !slide) return;
    if (!cacheRef.current || cacheRef.current.rev !== rev) {
      const svg = renderSlideSvg(deck, slide);
      svg.setAttribute('width', '100%');
      svg.style.pointerEvents = 'none';
      cacheRef.current = { rev, svg };
    }
    host.replaceChildren(cacheRef.current.svg);
  }, [store, slideIndex, rev]);

  return (
    <div
      ref={hostRef}
      css={{
        width: '100%',
        background: PAPER,
        borderRadius: 4,
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    />
  );
}

export function SlideNavigator({ readOnly = false }: { readOnly?: boolean }) {
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  const { deck, activeSlide, rev } = state;
  // Right-click menu: { x, y, index } in viewport coordinates (fixed panel).
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    index: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Drag-to-reorder: `from` is the dragged index, `gap` the insertion point
  // (0..slideCount) shown as a drop line.
  const [drag, setDrag] = useState<{ from: number; gap: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const doc = featheryDoc();
    // A React onMouseDown+stopPropagation on the panel would NOT stop this
    // native document listener (React re-dispatches, native bubbling still
    // reaches document), so the menu must ignore mousedowns inside itself.
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('keydown', onKey);
    return () => {
      doc.removeEventListener('mousedown', onDown);
      doc.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!deck) return <div css={navStyle} />;

  const canDelete = deck.slides.length > 1;

  return (
    <div css={navStyle}>
      {!readOnly && (
        <button
          type='button'
          title='Add a blank slide after the current one'
          onClick={() => store.addSlide(activeSlide + 1)}
          css={addButtonStyle}
        >
          <svg
            viewBox='0 0 24 24'
            width={15}
            height={15}
            css={{
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round'
            }}
          >
            <path d='M12 5v14M5 12h14' />
          </svg>
          New slide
        </button>
      )}
      {deck.slides.map((slide, i) => (
        <React.Fragment key={slide.path}>
          {drag && drag.gap === i && <div css={dropLine} />}
          <button
            type='button'
            aria-label={`Slide ${i + 1}`}
            aria-current={i === activeSlide}
            draggable={!readOnly}
            onClick={() => store.setActiveSlide(i)}
            onDragStart={
              readOnly
                ? undefined
                : (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                    setDrag({ from: i, gap: i });
                  }
            }
            onDragOver={
              readOnly
                ? undefined
                : (e) => {
                    if (!drag) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const r = e.currentTarget.getBoundingClientRect();
                    const gap = e.clientY > r.top + r.height / 2 ? i + 1 : i;
                    setDrag((d) => (d && d.gap !== gap ? { ...d, gap } : d));
                  }
            }
            onDrop={
              readOnly
                ? undefined
                : (e) => {
                    e.preventDefault();
                    if (drag) {
                      const to = drag.gap > drag.from ? drag.gap - 1 : drag.gap;
                      store.moveSlide(drag.from, to);
                    }
                    setDrag(null);
                  }
            }
            onDragEnd={() => setDrag(null)}
            onContextMenu={
              readOnly
                ? undefined
                : (e) => {
                    e.preventDefault();
                    store.setActiveSlide(i);
                    setMenu({ x: e.clientX, y: e.clientY, index: i });
                  }
            }
            onKeyDown={(e) => {
              if (readOnly) return;
              if ((e.key === 'Delete' || e.key === 'Backspace') && canDelete) {
                e.preventDefault();
                store.deleteSlide(slide.path);
              }
            }}
            css={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              width: '100%',
              padding: 6,
              border: 'none',
              borderRadius: 8,
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              opacity: drag?.from === i ? 0.4 : 1,
              '&:hover': { background: 'rgba(43, 49, 52, 0.06)' }
            }}
          >
            <span
              css={{
                flex: '0 0 auto',
                fontSize: 11,
                fontWeight: 600,
                color: i === activeSlide ? INK : INK_3,
                width: 16,
                paddingTop: 2
              }}
            >
              {i + 1}
            </span>
            <span
              css={{
                flex: 1,
                minWidth: 0,
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow:
                  i === activeSlide ? '0 0 0 2px #e2467a' : `0 0 0 1px ${LINE}`,
                display: 'block'
              }}
            >
              <SlideThumbnail slideIndex={i} rev={rev} />
            </span>
          </button>
        </React.Fragment>
      ))}
      {drag && drag.gap === deck.slides.length && <div css={dropLine} />}
      {menu && (
        <div
          ref={menuRef}
          role='menu'
          aria-label='Slide actions'
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 60,
            minWidth: 168,
            padding: 4,
            background: '#fff',
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            boxShadow: '0 6px 18px rgba(23,26,28,.13)',
            display: 'flex',
            flexDirection: 'column'
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type='button'
            css={navMenuItem}
            onClick={() => {
              store.addSlide(menu.index + 1);
              setMenu(null);
            }}
          >
            New slide
          </button>
          <button
            type='button'
            css={navMenuItem}
            onClick={() => {
              store.addSlide(menu.index + 1, deck.slides[menu.index].path);
              setMenu(null);
            }}
          >
            Duplicate slide
          </button>
          <button
            type='button'
            disabled={!canDelete}
            css={{
              ...navMenuItem,
              borderTop: `1px solid ${LINE}`,
              color: canDelete ? '#dc3a4b' : INK_3,
              cursor: canDelete ? 'pointer' : 'default'
            }}
            onClick={() => {
              if (canDelete) store.deleteSlide(deck.slides[menu.index].path);
              setMenu(null);
            }}
          >
            Delete slide
          </button>
        </div>
      )}
    </div>
  );
}

const dropLine = {
  height: 2,
  margin: '-1px 4px',
  borderRadius: 2,
  background: '#e2467a',
  flex: '0 0 auto'
};

const addButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  flex: '0 0 auto',
  width: '100%',
  padding: '8px 10px',
  marginBottom: 2,
  border: `1px solid ${LINE}`,
  borderRadius: 8,
  background: PAPER,
  color: INK,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  '&:hover': { background: 'rgba(43, 49, 52, 0.06)' }
};

const navMenuItem = {
  display: 'block',
  width: '100%',
  padding: '7px 10px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: '#3f3f46',
  fontSize: 12.5,
  textAlign: 'left' as const,
  cursor: 'pointer',
  '&:hover:not(:disabled)': { background: '#f4f4f5' }
};

const navStyle = {
  flex: '0 0 auto',
  width: NAV_WIDTH,
  minWidth: NAV_WIDTH,
  alignSelf: 'stretch' as const,
  overflowY: 'auto' as const,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  padding: 8,
  background: PANEL,
  borderRight: `1px solid ${LINE}`
};
