import { useCallback, useEffect, useRef, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';
import {
  DocumentPacket,
  DocumentTab,
  EditorEnvelope,
  envelopeSourceUrl,
  packetTabs
} from './documentPacket';

const DRAFTS_KEY = '__featheryDocxEditorDrafts';
const REFRESH_EVENT = 'feathery-docx-editor-refresh';

const pendingPacket = (containerId?: string): DocumentPacket | undefined =>
  containerId
    ? (featheryWindow() as any)[DRAFTS_KEY]?.[containerId]
    : undefined;

export function useDocumentPacket({
  containerId,
  documents,
  editMode,
  load,
  beforeReplace,
  saveOnSwitch = true
}: {
  containerId?: string;
  documents?: DocumentPacket['documents'];
  editMode?: boolean;
  load: (documentId: string) => Promise<any>;
  beforeReplace: () => Promise<unknown>;
  saveOnSwitch?:
    | boolean
    | ((envelope: EditorEnvelope | null, next: EditorEnvelope) => boolean);
}) {
  const [tabs, setTabs] = useState(() =>
    packetTabs(pendingPacket(containerId) ?? { documents })
  );
  const [activeId, setActiveId] = useState<string | undefined>(tabs[0]?.id);
  const [envelope, updateEnvelope] = useState<EditorEnvelope | null>(
    tabs[0]?.envelope ?? null
  );
  const [sourceUrl, setSourceUrl] = useState(envelopeSourceUrl(envelope));
  const [loading, setLoading] = useState(
    !envelope && !editMode && tabs.length > 0
  );
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const busy = useRef<number | null>(null);
  const generation = useRef(0);
  const current = useRef({
    tabs,
    activeId,
    envelope,
    load,
    beforeReplace,
    saveOnSwitch
  });
  current.current = {
    tabs,
    activeId,
    envelope,
    load,
    beforeReplace,
    saveOnSwitch
  };

  const resolveTab = async (tab?: DocumentTab) => {
    if (tab?.envelope) return tab.envelope;
    if (!tab?.documentId) return null;
    const value = await current.current.load(tab.documentId);
    if (!value) throw new Error(`Could not load ${tab.label}. Please retry.`);
    return value?.id
      ? ({
          ...value,
          document: value.document ?? tab.documentId
        } as EditorEnvelope)
      : null;
  };

  const open = (tab: DocumentTab | undefined, value: EditorEnvelope | null) => {
    updateEnvelope(value);
    setSourceUrl(envelopeSourceUrl(value));
    setActiveId(tab?.id);
    setError(null);
    setLoading(false);
    if (tab && value)
      setTabs((items) =>
        items.map((item) =>
          item.id === tab.id ? { ...item, envelope: value } : item
        )
      );
  };

  useEffect(() => {
    if (editMode) return;
    const sequence = ++generation.current;
    resolveTab(current.current.tabs[0])
      .then((value) => {
        if (sequence === generation.current)
          open(current.current.tabs[0], value);
      })
      .catch((err) => {
        if (sequence !== generation.current) return;
        setError(err?.message || String(err));
        setLoading(false);
      });
    return () => {
      generation.current++;
      busy.current = null;
      setSwitching(false);
    };
  }, [containerId, editMode]);

  const selectTab = useCallback(async (id: string) => {
    if (busy.current || id === current.current.activeId) return;
    const tab = current.current.tabs.find((item) => item.id === id);
    if (!tab) return;
    setSwitching(true);
    const sequence = ++generation.current;
    busy.current = sequence;
    try {
      const value = await resolveTab(tab);
      if (sequence !== generation.current) return;
      if (!value?.file) throw new Error(`No generated file for ${tab.label}`);
      const saveBeforeSwitch =
        typeof current.current.saveOnSwitch === 'function'
          ? current.current.saveOnSwitch(current.current.envelope, value)
          : current.current.saveOnSwitch;
      if (saveBeforeSwitch) await current.current.beforeReplace();
      if (sequence !== generation.current) return;
      open(tab, value);
      setOperationError(null);
    } catch (err) {
      if (sequence !== generation.current) return;
      setOperationError(
        `Could not switch documents. Your current document is still open. ${
          err instanceof Error ? err.message : ''
        }`
      );
    } finally {
      if (busy.current === sequence) {
        busy.current = null;
        setSwitching(false);
      }
    }
  }, []);

  useEffect(() => {
    if (editMode) return;
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<DocumentPacket>).detail;
      if (!detail || (detail.containerId && detail.containerId !== containerId))
        return;
      const sequence = ++generation.current;
      busy.current = sequence;
      setSwitching(true);
      try {
        await current.current.beforeReplace();
        const nextTabs = packetTabs(
          detail.envelopes?.length
            ? detail
            : { documents: detail.documents ?? documents }
        );
        const value = await resolveTab(nextTabs[0]);
        if (sequence !== generation.current) return;
        setTabs(nextTabs);
        open(nextTabs[0], value);
        setOperationError(null);
        setReloadKey((key) => key + 1);
      } catch (err) {
        if (sequence !== generation.current) return;
        setOperationError(
          `The new documents could not be opened because your current edits could not be saved. ${
            err instanceof Error ? err.message : ''
          }`
        );
      } finally {
        if (busy.current === sequence) {
          busy.current = null;
          setSwitching(false);
        }
      }
    };
    const win = featheryWindow();
    win.addEventListener(REFRESH_EVENT, handler);
    return () => win.removeEventListener(REFRESH_EVENT, handler);
  }, [containerId, documents, editMode]);

  const setEnvelope = useCallback(
    (
      value:
        | EditorEnvelope
        | null
        | ((previous: EditorEnvelope | null) => EditorEnvelope | null)
    ) => {
      const next =
        typeof value === 'function' ? value(current.current.envelope) : value;
      current.current.envelope = next;
      updateEnvelope(next);
      if (!next) return;
      setTabs((items) =>
        items.map((tab) =>
          tab.envelope?.id === next.id || tab.id === current.current.activeId
            ? { ...tab, envelope: next }
            : tab
        )
      );
      const pending = pendingPacket(containerId);
      if (pending?.envelopes)
        pending.envelopes = pending.envelopes.map((item) =>
          item.id === next.id ? next : item
        );
    },
    [containerId]
  );

  const updateTabEnvelope = useCallback(
    (value: EditorEnvelope) => {
      const nextTabs = current.current.tabs.map((tab) =>
        tab.envelope?.id === value.id ? { ...tab, envelope: value } : tab
      );
      current.current.tabs = nextTabs;
      setTabs(nextTabs);
      if (current.current.envelope?.id === value.id) {
        current.current.envelope = value;
        updateEnvelope(value);
      }
      const pending = pendingPacket(containerId);
      if (pending?.envelopes)
        pending.envelopes = pending.envelopes.map((item) =>
          item.id === value.id ? value : item
        );
    },
    [containerId]
  );

  const resolveEnvelopes = useCallback(
    async (onUnavailable?: (label: string, error: unknown) => void) => {
      const resolved = [];
      for (const tab of current.current.tabs) {
        try {
          const value = await resolveTab(tab);
          if (!value?.file)
            throw new Error(`No generated file for ${tab.label}`);
          resolved.push(value);
        } catch (error) {
          if (!onUnavailable) throw error;
          onUnavailable(tab.label, error);
        }
      }
      return resolved;
    },
    []
  );

  const filesForSave = useCallback(async (saved: EditorEnvelope) => {
    const values = await Promise.all(
      current.current.tabs.map(async (tab) => {
        if (tab.id === current.current.activeId) return saved.file;
        const value = await resolveTab(tab);
        if (!value?.file) throw new Error(`No generated file for ${tab.label}`);
        return value.file;
      })
    );
    return values.length === 1 ? values[0] : values;
  }, []);

  return {
    tabs,
    activeId,
    documentId: tabs.find((tab) => tab.id === activeId)?.documentId,
    envelope,
    setEnvelope,
    sourceUrl,
    setSourceUrl,
    loading,
    switching,
    error,
    setError,
    operationError,
    setOperationError,
    reloadKey,
    setReloadKey,
    selectTab,
    filesForSave,
    updateTabEnvelope,
    resolveEnvelopes
  };
}
