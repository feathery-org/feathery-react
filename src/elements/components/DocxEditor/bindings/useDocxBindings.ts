// The React half of the binding integration: attach once the document is open,
// detach when the editor goes away.
//
// Deliberately thin. Everything that could break lives in attachBindings, which
// is tested against a real editor; this only decides when to call it.

import { useEffect, useRef, useState } from 'react';
import {
  attachBindings,
  AttachedBindings,
  BindingsOptions
} from './attachBindings';
import { Diagnostic } from './core/sfdtTypes';
import { SyncfusionEditorLike } from './editorAdapter';

export interface UseDocxBindingsOptions extends BindingsOptions {
  /** Nothing happens at all while false - the prop-absent case costs nothing. */
  enabled?: boolean;
  /** The live editor, or null before it exists. */
  editor: SyncfusionEditorLike | null;
  /** True while the host is creating or opening a document. */
  loading: boolean;
  /**
   * Read-only documents are left untouched. Reconciliation writes to the
   * document, and a finalized or signed envelope is not ours to rewrite.
   */
  readOnly?: boolean;
}

export interface DocxBindingsState {
  /** True once bindings are live on the current document. */
  ready: boolean;
  diagnostics: Diagnostic[];
  /** True when diagnostics would make a save persist a document with errors. */
  blocked: boolean;
  /** Reconcile anything uncommitted; false when the save must not proceed. */
  commitForSave: () => boolean;
  fieldValues: Record<string, string>;
}

const IDLE: DocxBindingsState = {
  ready: false,
  diagnostics: [],
  blocked: false,
  commitForSave: () => true,
  fieldValues: {}
};

export function useDocxBindings({
  enabled = false,
  editor,
  loading,
  readOnly = false,
  onDiagnostics,
  onFieldValues,
  ...options
}: UseDocxBindingsOptions): DocxBindingsState {
  const attachedRef = useRef<AttachedBindings | null>(null);
  const [state, setState] = useState<DocxBindingsState>(IDLE);

  // Host callbacks live in refs so changing an inline arrow prop cannot tear the
  // bindings down and re-run the initial reconcile.
  const onDiagnosticsRef = useRef(onDiagnostics);
  onDiagnosticsRef.current = onDiagnostics;
  const onFieldValuesRef = useRef(onFieldValues);
  onFieldValuesRef.current = onFieldValues;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!enabled || !editor || loading || readOnly) return undefined;

    let attached: AttachedBindings;
    try {
      attached = attachBindings(editor, {
        ...optionsRef.current,
        onDiagnostics: (diagnostics) => {
          onDiagnosticsRef.current?.(diagnostics);
          setState((previous) => ({
            ...previous,
            diagnostics,
            blocked: diagnostics.some((entry) => entry.severity === 'error')
          }));
        },
        onFieldValues: (values) => {
          onFieldValuesRef.current?.(values);
          setState((previous) => ({ ...previous, fieldValues: values }));
        }
      });
    } catch (error) {
      // A document the engine cannot read must not take the editor down with it.
      console.error('Feathery: document bindings failed to attach', error);
      return undefined;
    }

    attachedRef.current = attached;
    setState({
      ready: true,
      diagnostics: attached.diagnostics(),
      blocked: attached
        .diagnostics()
        .some((entry) => entry.severity === 'error'),
      commitForSave: () => attached.commitForSave(),
      fieldValues: attached.fieldValues()
    });

    return () => {
      attached.dispose();
      attachedRef.current = null;
      setState(IDLE);
    };
    // `editor` identity changes on every recreation, which is exactly when the
    // bindings must be rebuilt; `loading` gates on the document being open.
  }, [enabled, editor, loading, readOnly]);

  return state;
}
