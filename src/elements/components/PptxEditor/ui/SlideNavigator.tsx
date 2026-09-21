import React, { useEffect, useRef } from 'react';
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

export function SlideNavigator() {
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  const { deck, activeSlide, rev } = state;

  if (!deck) return <div css={navStyle} />;

  return (
    <div css={navStyle}>
      {deck.slides.map((slide, i) => (
        <button
          key={slide.path}
          type='button'
          aria-label={`Slide ${i + 1}`}
          aria-current={i === activeSlide}
          onClick={() => store.setActiveSlide(i)}
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
      ))}
    </div>
  );
}

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
