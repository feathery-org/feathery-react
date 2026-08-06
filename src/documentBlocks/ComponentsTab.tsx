/**
 * The "Components" surface: a second Syncfusion editor, SFDT-only (no
 * source/serviceUrl — nothing ever leaves the browser), that renders one
 * styled sample per block type. It opens the theme's current formatting
 * exactly once; from then on it is the user editing the samples, and every
 * edit (debounced) is read back into the theme via `extractTheme`.
 *
 * This editor is never reopened by the block-sync loop — the main document's
 * sync loop only reopens the MAIN editor. Reopening the Components doc here
 * too would fight the user's own in-progress edit and lose their caret.
 */
import React, { useEffect, useRef } from 'react';

import { useDocxEditor } from '../elements/components/DocxEditor/useDocxEditor';
import { componentsSfdt, extractTheme } from './theme';
import { BlockStore, setTheme } from './store';

const CONTENT_CHANGE_DEBOUNCE_MS = 600;

export default function ComponentsTab({ store }: { store: BlockStore }) {
  const { containerRef, editor } = useDocxEditor({ builtinToolbar: true });
  const openedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open the sample document once, seeded from whatever theme the store held
  // when this editor first became ready. Never reopened afterward.
  useEffect(() => {
    if (!editor || openedRef.current) return;
    openedRef.current = true;
    editor.open(componentsSfdt(store.getData().theme));
  }, [editor, store]);

  useEffect(() => {
    if (!editor) return undefined;
    const onContentChange = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const extracted = extractTheme(editor.serialize());
        store.apply(setTheme(extracted), 'theme');
      }, CONTENT_CHANGE_DEBOUNCE_MS);
    };
    editor.addEventListener('contentChange', onContentChange);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      editor.removeEventListener?.('contentChange', onContentChange);
    };
  }, [editor, store]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  );
}
