/**
 * Background colour for every token, drawn over the canvas.
 *
 * HTML over the document rather than formatting inside it: nothing to strip
 * on export, and it cannot leak into the file a recipient opens. Colour is
 * derived from state on every frame, so it can never contradict the token.
 *
 *   input     blue      editable
 *   computed  grey      derived, read-only
 *   invalid   red       fails its own validation, blocks save
 *   focused   stronger  the token the caret is inside
 *
 * A requestAnimationFrame loop measures and diffs: the editor virtual-scrolls,
 * so there is no scroll event to subscribe to, and text also moves on zoom,
 * resize, pagination and every edit. Enumerating those is an invitation to
 * miss one; measuring a handful of rectangles is microseconds.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { TokenCycle, TokenState } from './tokenCycle';
import {
  findViewerSurface,
  measureTokenRects,
  sameRects,
  TokenRect
} from './tokenRects';

const FILL = {
  input: 'rgba(37, 99, 235, 0.30)',
  inputFocused: 'rgba(37, 99, 235, 0.52)',
  computed: 'rgba(107, 114, 128, 0.28)',
  computedFocused: 'rgba(107, 114, 128, 0.48)',
  invalid: 'rgba(185, 28, 28, 0.34)',
  invalidFocused: 'rgba(185, 28, 28, 0.55)'
};

const fillFor = (state: TokenState, id: string, computed: boolean): string => {
  const focused = state.focused === id;
  if (state.invalid.has(id) || state.errors.has(id)) {
    return focused ? FILL.invalidFocused : FILL.invalid;
  }
  if (computed) return focused ? FILL.computedFocused : FILL.computed;
  return focused ? FILL.inputFocused : FILL.input;
};

export default function TokenOverlay({
  editor,
  cycle,
  hostRef
}: {
  editor: any;
  cycle: TokenCycle;
  hostRef: React.RefObject<HTMLElement | null>;
}) {
  const [state, setState] = useState<TokenState>(() => cycle.getState());
  const [rects, setRects] = useState<TokenRect[]>([]);
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  const rectsRef = useRef<TokenRect[]>([]);

  useEffect(() => cycle.subscribe(setState), [cycle]);

  // Wait for the editor's scrolling surface to exist before drawing.
  useEffect(() => {
    let frame = 0;
    const find = () => {
      const found = findViewerSurface(hostRef.current);
      if (found) setSurface(found);
      else frame = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [hostRef]);

  useEffect(() => {
    if (!editor) return undefined;
    let frame = 0;

    const tick = () => {
      const ids = state.specs.map((spec) => spec.id);
      const next = measureTokenRects(editor, ids);
      if (!sameRects(rectsRef.current, next)) {
        rectsRef.current = next;
        setRects(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [editor, state.specs]);

  if (!surface || rects.length === 0) return null;

  const computedIds = new Set(
    state.specs.filter((spec) => spec.formula).map((spec) => spec.id)
  );

  // Rendered INTO the editor's scrolling surface, not the wrapper: the
  // measured coordinates are relative to that surface, and living inside it
  // means the overlay tracks scrolling with no scroll maths of its own.
  //
  // No z-index: making this a stacking context would blend the fill against
  // the layer instead of the canvas beneath it, hiding the text.
  return createPortal(
    <div
      data-testid='docx-token-overlay'
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none'
      }}
    >
      {rects.map((rect) => (
        <div
          key={rect.id}
          style={{
            position: 'absolute',
            left: rect.left - 1.5 * rect.zoom,
            top: rect.top,
            width: rect.width + 3 * rect.zoom,
            height: rect.height,
            background: fillFor(state, rect.id, computedIds.has(rect.id)),
            borderRadius: 3 * rect.zoom,
            mixBlendMode: 'multiply',
            transition: 'background 120ms ease'
          }}
        />
      ))}
    </div>,
    surface
  );
}
