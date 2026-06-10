import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CloseIcon,
  FloatingIcon,
  FullscreenIcon,
  MinusIcon,
  SidebarLeftIcon,
  SidebarRightIcon
} from '../icons';
import { GRAY_200 } from '../colors';
import { featheryDoc, featheryWindow } from '../../utils/browser';
import type { AssistantLayoutState, AssistantMode } from '../types';

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 500;

const DEFAULT_STORAGE_KEY_PREFIX = 'feathery.assistant.';
const MODE_STORAGE_KEY_SUFFIX = 'mode';
const SIDEBAR_WIDTH_STORAGE_KEY_SUFFIX = 'sidebarWidth';
const DEFAULT_MODE: AssistantMode = 'current';

function isAssistantMode(v: unknown): v is AssistantMode {
  return (
    v === 'current' ||
    v === 'sidebar-left' ||
    v === 'sidebar-right' ||
    v === 'fullscreen'
  );
}

function readStoredMode(modeStorageKey: string): AssistantMode {
  try {
    const raw = featheryWindow().localStorage.getItem(modeStorageKey);
    return isAssistantMode(raw) ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function writeStoredMode(modeStorageKey: string, mode: AssistantMode) {
  try {
    featheryWindow().localStorage.setItem(modeStorageKey, mode);
  } catch {
    // localStorage unavailable, mode stays in component state for the session
  }
}

const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_ABS = 800;
const SIDEBAR_MAX_VIEWPORT_RATIO = 0.6;
const DEFAULT_SIDEBAR_WIDTH = 400;

function getSidebarMaxWidth(): number {
  try {
    return Math.min(
      SIDEBAR_MAX_ABS,
      Math.floor(featheryWindow().innerWidth * SIDEBAR_MAX_VIEWPORT_RATIO)
    );
  } catch {
    return SIDEBAR_MAX_ABS;
  }
}

function clampSidebarWidth(w: number): number {
  const max = Math.max(SIDEBAR_MIN_WIDTH, getSidebarMaxWidth());
  if (w < SIDEBAR_MIN_WIDTH) return SIDEBAR_MIN_WIDTH;
  if (w > max) return max;
  return w;
}

function readStoredSidebarWidth(sidebarWidthStorageKey: string): number {
  try {
    const raw = featheryWindow().localStorage.getItem(sidebarWidthStorageKey);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? clampSidebarWidth(parsed)
      : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function writeStoredSidebarWidth(
  sidebarWidthStorageKey: string,
  w: number
): void {
  try {
    featheryWindow().localStorage.setItem(sidebarWidthStorageKey, String(w));
  } catch {
    // localStorage unavailable, width stays in component state for the session
  }
}

type Params = {
  isOpen: boolean;
  bottom: number;
  onLayoutChange?: null | ((state: AssistantLayoutState) => void);
  storageKeyPrefix?: string;
};

// Panel display mode, resizable sidebar width, and derived geometry
export default function useAssistantLayout({
  isOpen,
  bottom,
  onLayoutChange,
  storageKeyPrefix = DEFAULT_STORAGE_KEY_PREFIX
}: Params) {
  const modeStorageKey = `${storageKeyPrefix}${MODE_STORAGE_KEY_SUFFIX}`;
  const sidebarWidthStorageKey = `${storageKeyPrefix}${SIDEBAR_WIDTH_STORAGE_KEY_SUFFIX}`;

  const [mode, setModeState] = useState<AssistantMode>(() =>
    readStoredMode(modeStorageKey)
  );
  const setMode = useCallback(
    (next: AssistantMode) => {
      setModeState(next);
      writeStoredMode(modeStorageKey, next);
    },
    [modeStorageKey]
  );

  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readStoredSidebarWidth(sidebarWidthStorageKey)
  );
  const [isResizing, setIsResizing] = useState(false);

  // Keep the sidebar within bounds when the window resizes
  useEffect(() => {
    const onWindowResize = () => {
      setSidebarWidth((w) => {
        const newWidth = clampSidebarWidth(w);
        if (newWidth !== w)
          writeStoredSidebarWidth(sidebarWidthStorageKey, newWidth);
        return newWidth;
      });
    };
    featheryWindow().addEventListener('resize', onWindowResize);
    return () => featheryWindow().removeEventListener('resize', onWindowResize);
  }, [sidebarWidthStorageKey]);

  const handleResizePointerDown = useCallback(
    (side: 'left' | 'right') => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setIsResizing(true);

      const body = featheryDoc().body;
      body.style.cursor = 'col-resize';
      body.style.userSelect = 'none';

      let currentWidth = sidebarWidth;
      const handleMove = (moveEvent: PointerEvent) => {
        const raw =
          side === 'right'
            ? featheryWindow().innerWidth - moveEvent.clientX
            : moveEvent.clientX;
        currentWidth = clampSidebarWidth(raw);
        setSidebarWidth(currentWidth);
      };
      const handleUp = () => {
        featheryWindow().removeEventListener('pointermove', handleMove);
        featheryWindow().removeEventListener('pointerup', handleUp);
        featheryWindow().removeEventListener('pointercancel', handleUp);
        setIsResizing(false);
        body.style.cursor = '';
        body.style.userSelect = '';
        writeStoredSidebarWidth(sidebarWidthStorageKey, currentWidth);
      };
      featheryWindow().addEventListener('pointermove', handleMove);
      featheryWindow().addEventListener('pointerup', handleUp);
      featheryWindow().addEventListener('pointercancel', handleUp);
    },
    [sidebarWidth, sidebarWidthStorageKey]
  );

  const handleResizeDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    writeStoredSidebarWidth(sidebarWidthStorageKey, DEFAULT_SIDEBAR_WIDTH);
  }, [sidebarWidthStorageKey]);

  const layoutSide: 'left' | 'right' | null =
    mode === 'sidebar-left'
      ? 'left'
      : mode === 'sidebar-right'
      ? 'right'
      : null;
  const layoutWidth = isOpen && layoutSide ? sidebarWidth : 0;

  // Tell the host when the layout changes so it can reflow around the panel
  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;
  useEffect(() => {
    onLayoutChangeRef.current?.({
      mode,
      isOpen,
      side: layoutSide,
      width: layoutWidth,
      isResizing
    });
  }, [mode, isOpen, layoutSide, layoutWidth, isResizing]);

  const CollapseIcon =
    mode === 'sidebar-left'
      ? ChevronsLeftIcon
      : mode === 'sidebar-right'
      ? ChevronsRightIcon
      : mode === 'fullscreen'
      ? CloseIcon
      : MinusIcon;

  const ModeTriggerIcon =
    mode === 'sidebar-left'
      ? SidebarLeftIcon
      : mode === 'sidebar-right'
      ? SidebarRightIcon
      : mode === 'fullscreen'
      ? FullscreenIcon
      : FloatingIcon;

  const fabOnLeft = mode === 'sidebar-left';
  const fabSide = fabOnLeft ? { left: '20px' } : { right: '20px' };
  const fabBottom = fabOnLeft ? 20 : bottom;

  const panelGeometry =
    mode === 'sidebar-left'
      ? {
          top: 0,
          left: 0,
          width: `${sidebarWidth}px`,
          height: '100vh',
          borderRadius: 0,
          boxShadow: '4px 0 24px rgba(0, 0, 0, 0.12)'
        }
      : mode === 'sidebar-right'
      ? {
          top: 0,
          right: 0,
          width: `${sidebarWidth}px`,
          height: '100vh',
          borderRadius: 0,
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.12)'
        }
      : mode === 'fullscreen'
      ? {
          inset: 0,
          borderRadius: 0,
          boxShadow: 'none',
          border: 'none'
        }
      : {
          bottom: `${bottom}px`,
          right: '20px',
          width: `${PANEL_WIDTH}px`,
          height: `${PANEL_HEIGHT}px`,
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
          border: `1px solid ${GRAY_200}`
        };

  return {
    mode,
    setMode,
    sidebarWidth,
    isResizing,
    handleResizePointerDown,
    handleResizeDoubleClick,
    layoutSide,
    layoutWidth,
    panelGeometry,
    CollapseIcon,
    ModeTriggerIcon,
    fabOnLeft,
    fabSide,
    fabBottom
  };
}
