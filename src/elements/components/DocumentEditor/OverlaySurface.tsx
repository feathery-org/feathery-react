import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Toolbar, { ToolbarAction } from './Toolbar';
import { trapTabKey, isEditableTarget } from './keyboard';
import { featheryDoc, runningInClient } from '../../../utils/browser';

interface OverlaySurfaceProps {
  title: string;
  onClose: () => void;
  // Right-aligned toolbar actions; `busyKey` names the in-flight one (spinner
  // + disable-all), and while any action runs every close path is gated —
  // closing mid-action would hide the surface while the action's side effect
  // (save/sign/send) still completes in the background, invisibly, and after
  // the surrounding flow was told the session was cancelled.
  actions: ToolbarAction[];
  busyKey: string | null;
  // Banners rendered between the toolbar and the content (errors, expiry).
  banners?: React.ReactNode;
  // Document-level keys the surface doesn't own (Escape, Tab) are offered to
  // the content — e.g. the pdf viewer's PageUp/PageDown paging.
  onSurfaceKeyDown?: (e: KeyboardEvent) => void;
  children: React.ReactNode;
}

// The full-screen modal shell a document editor renders into: a body-level
// portal with every sibling made `inert`, a Tab trap, Escape-to-close, and the
// title/actions toolbar. Which editor renders inside is the caller's business.
export default function OverlaySurface({
  title,
  onClose,
  actions,
  busyKey,
  banners,
  onSurfaceKeyDown,
  children
}: OverlaySurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The keydown listener binds once but must see the latest values — the
  // parent passes fresh closures on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyKeyRef = useRef(busyKey);
  busyKeyRef.current = busyKey;
  const onSurfaceKeyDownRef = useRef(onSurfaceKeyDown);
  onSurfaceKeyDownRef.current = onSurfaceKeyDown;
  // Dedicated body-level node so the surface renders in its own subtree and
  // the rest of the page can be made `inert` while it is open.
  const portalElRef = useRef<HTMLElement | null>(null);
  if (portalElRef.current === null && runningInClient()) {
    portalElRef.current = featheryDoc().createElement('div');
  }

  // Mount the portal node on the document body and make every sibling `inert`
  // so assistive tech (and Tab) can't reach the form behind this modal. The
  // Tab trap alone doesn't constrain a screen reader's virtual cursor.
  useEffect(() => {
    const node = portalElRef.current;
    if (!node) return undefined;
    const body = featheryDoc().body;
    body.appendChild(node);
    const siblings = Array.from(body.children).filter(
      (c) => c !== node
    ) as HTMLElement[];
    const hadInert = siblings.map((el) => el.hasAttribute('inert'));
    siblings.forEach((el) => el.setAttribute('inert', ''));
    return () => {
      siblings.forEach((el, i) => {
        if (!hadInert[i]) el.removeAttribute('inert');
      });
      if (node.parentNode) node.parentNode.removeChild(node);
    };
  }, []);

  useEffect(() => {
    // Restore focus to whatever was focused before the surface opened when it
    // closes, so keyboard/SR users don't get dropped onto <body>.
    const previouslyFocused = featheryDoc().activeElement as HTMLElement | null;
    containerRef.current?.focus();
    const doc = featheryDoc();
    const onKeyDown = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (e.key === 'Escape') {
        if (isEditableTarget(e.target)) {
          // First Esc leaves the field; the next Esc closes the surface.
          (e.target as HTMLElement).blur();
          return;
        }
        // The toolbar's Back button applies the same in-flight gate.
        if (busyKeyRef.current !== null) return;
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        trapTabKey(container, e);
      } else {
        onSurfaceKeyDownRef.current?.(e);
      }
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  if (!portalElRef.current) return null;
  return createPortal(
    <div
      ref={containerRef}
      role='dialog'
      aria-modal='true'
      aria-label={title}
      tabIndex={-1}
      css={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f4f5f8',
        outline: 'none'
      }}
    >
      <Toolbar
        title={title}
        onBack={onClose}
        actions={actions}
        busyKey={busyKey}
      />
      {banners}
      {children}
    </div>,
    portalElRef.current
  );
}
