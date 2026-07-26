import {
  Fragment,
  KeyboardEvent,
  MouseEvent,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Chat, useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls
} from 'ai';
import {
  ChatIcon,
  ChevronDownIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CloseIcon,
  FloatingIcon,
  FullscreenIcon,
  MicIcon,
  MinusIcon,
  PaperclipIcon,
  SendIcon,
  SidebarLeftIcon,
  SidebarRightIcon,
  WaveformIcon
} from './icons';
import {
  ACCEPT_ATTR,
  getFilePart,
  isTerminalStatus,
  setChatSessionId
} from './attachments';
import {
  AttachmentChip,
  AttachmentPreview,
  AttachmentPreviewOverlay,
  MessageAttachment
} from './AttachmentParts';
import { useChatAttachments } from './useChatAttachments';
import { useAssistantVoice } from './voice/useAssistantVoice';
import {
  DEFAULT_CHAT_COLOR,
  getChatColors,
  GRAY_50,
  GRAY_100,
  GRAY_200,
  GRAY_400,
  GRAY_800
} from './colors';
import {
  ToolChunk,
  ToolChunkPlaceholder,
  readPartType,
  type ToolRow
} from './ToolStatus';
import MarkdownText from './MarkdownText';
import {
  AssistantHeaders,
  AssistantThreadDetail,
  deleteThread,
  generateThreadTitle,
  getThreadDetail,
  getThreadList
} from './utils';
import { initInfo } from '../utils/init';
import { featheryDoc, featheryWindow, getCookie } from '../utils/browser';
import {
  ensureCompletedSteps,
  getCurrentStepKey,
  getPanelRuntimeSnapshot
} from './tools/panelRuntime';
import { dispatchSetFieldValue } from './tools/setFieldValue';
import { dispatchClickElement } from './tools/clickElement';
import { dispatchNavigate } from './tools/navigate';
import { dispatchTriggerTableAction } from './tools/triggerTableAction';
import {
  dispatchAddTableRow,
  dispatchDeleteTableRow,
  dispatchSetTableCellValue
} from './tools/tableMutations';
import {
  buildCallableRules,
  dispatchAssistantTool
} from './tools/assistantToolDispatch';
import {
  createDocxEditorBridge,
  readDocxSelection
} from './tools/docxEditorBridge';
import { getDocxEditor } from './tools/docxEditorRegistry';
import { useDocumentIndex } from './tools/documentIndex';
import { runLogicRuleById } from '../Form/logic';
import internalState from '../utils/internalState';

const FAB_SIZE = 56;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 500;

export type AssistantMode =
  | 'current'
  | 'sidebar-left'
  | 'sidebar-right'
  | 'fullscreen';

const MODE_STORAGE_KEY = 'feathery.assistant.mode';
const DEFAULT_MODE: AssistantMode = 'current';

const isAssistantMode = (v: unknown): v is AssistantMode =>
  v === 'current' ||
  v === 'sidebar-left' ||
  v === 'sidebar-right' ||
  v === 'fullscreen';

const readStoredMode = (): AssistantMode => {
  try {
    const raw = featheryWindow().localStorage.getItem(MODE_STORAGE_KEY);
    return isAssistantMode(raw) ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
};

const writeStoredMode = (mode: AssistantMode) => {
  try {
    featheryWindow().localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable, mode stays in component state for the session
  }
};

const SIDEBAR_WIDTH_STORAGE_KEY = 'feathery.assistant.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 280;
const SIDEBAR_MAX_ABS = 800;
const SIDEBAR_MAX_VIEWPORT_RATIO = 0.6;
const DEFAULT_SIDEBAR_WIDTH = 400;

const getSidebarMaxWidth = (): number => {
  try {
    return Math.min(
      SIDEBAR_MAX_ABS,
      Math.floor(featheryWindow().innerWidth * SIDEBAR_MAX_VIEWPORT_RATIO)
    );
  } catch {
    return SIDEBAR_MAX_ABS;
  }
};

const clampSidebarWidth = (w: number): number => {
  const max = Math.max(SIDEBAR_MIN_WIDTH, getSidebarMaxWidth());
  if (w < SIDEBAR_MIN_WIDTH) return SIDEBAR_MIN_WIDTH;
  if (w > max) return max;
  return w;
};

const readStoredSidebarWidth = (): number => {
  try {
    const raw = featheryWindow().localStorage.getItem(
      SIDEBAR_WIDTH_STORAGE_KEY
    );
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? clampSidebarWidth(parsed)
      : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
};

const writeStoredSidebarWidth = (w: number): void => {
  try {
    featheryWindow().localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w));
  } catch {
    // localStorage unavailable, width stays in component state for the session
  }
};

type AssistantChunk =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tools'; key: string; rows: ToolRow[] };

const mergeAssistantParts = (parts: any[]): AssistantChunk[] => {
  const chunks: AssistantChunk[] = [];
  parts.forEach((part: any, index: number) => {
    if (part.type === 'text' && part.text.trim()) {
      const prev = chunks[chunks.length - 1];
      if (prev && prev.kind === 'text') {
        prev.text = `${prev.text}\n\n${part.text}`;
      } else {
        chunks.push({ kind: 'text', key: `text-${index}`, text: part.text });
      }
      return;
    }
    const meta = readPartType(part);
    if (!meta || meta.kind !== 'tool' || !meta.toolName) return;
    const row: ToolRow = {
      key: `tool-${index}`,
      toolName: meta.toolName,
      state: part.state as string,
      input: part.input,
      output: part.output
    };
    const prev = chunks[chunks.length - 1];
    if (prev && prev.kind === 'tools') {
      prev.rows.push(row);
    } else {
      chunks.push({
        kind: 'tools',
        key: `tools-${index}`,
        rows: [row]
      });
    }
  });
  return chunks;
};

// Title seed from the first user message: its first text part, else a framed list of attached filenames
const titleSeedFromMessage = (message: any): string | undefined => {
  const parts: any[] = message?.parts ?? [];
  const textPart = parts.find(
    (p) => p?.type === 'text' && typeof p.text === 'string' && p.text.trim()
  );
  if (textPart) return textPart.text;
  const names = parts
    .filter((p) => p?.type === 'file')
    .map((p) => p.filename)
    .filter(Boolean);
  return names.length ? `Attached file(s): ${names.join(', ')}` : undefined;
};

export type ResourceRef = { type: string; id: string };

export type WorkflowAction = {
  name: string;
  description?: string;
  instructions: string;
};

export type AssistantStepDefault = 'closed' | 'floating' | 'sidebar_right';
export type AssistantStepSettings = Record<string, AssistantStepDefault>;

export type AssistantLayoutState = {
  mode: AssistantMode;
  isOpen: boolean;
  side: 'left' | 'right' | null;
  width: number;
  isResizing: boolean;
};

const DEFAULT_MODES: AssistantMode[] = [
  'current',
  'sidebar-left',
  'sidebar-right',
  'fullscreen'
];

export type AssistantChatProps = {
  instanceId?: string;
  baseUrl: string;
  getTargets: () => ResourceRef[];
  getJwt?: () => string;
  bottom?: number;
  color?: string;
  voiceEnabled?: boolean;
  workflowActions?: WorkflowAction[];
  allowedModes?: AssistantMode[];
  stepSettings?: AssistantStepSettings;
  activeStepId?: string;
  onLayoutChange?: null | ((state: AssistantLayoutState) => void);
};

const AssistantChat = ({
  instanceId,
  getTargets,
  getJwt,
  baseUrl,
  bottom = 20,
  color,
  voiceEnabled = false,
  workflowActions = [],
  allowedModes = DEFAULT_MODES,
  stepSettings = {},
  activeStepId,
  onLayoutChange
}: AssistantChatProps) => {
  const headers = useMemo<AssistantHeaders>(() => {
    if (getJwt) return () => ({ Authorization: `Bearer ${getJwt()}` });
    const { sdkKey } = initInfo();
    return () => {
      const headers: Record<string, string> = {
        Authorization: `Token ${sdkKey}`
      };
      const sessionJwt = getCookie('feathery_session_token');
      if (sessionJwt) headers['X-Feathery-Session'] = sessionJwt;
      return headers;
    };
  }, [getJwt]);

  // form_key drives backend form auth on the SDK surface, the session only
  // resolves an account after validating against this form's auth settings
  const formKey = !getJwt
    ? getTargets().find((t) => t.type === 'panel')?.id
    : undefined;

  // ai-services requires a populated semantic index before every bulk document
  // edit and nothing else fills it on the in-form path, so the index POST lives
  // here: this is the one place that already holds the chat's target manifest and
  // its auth, guaranteeing the index is keyed and authenticated exactly like the
  // query that reads it. Fire-and-forget - it never gates the chat or the editor.
  useDocumentIndex({ baseUrl, getTargets, headers });

  const buildChatBody = (): Record<string, unknown> => {
    // ai-services reads assistant scope exclusively from body.context;
    // form_key stays top-level because backend form auth reads body params.
    const body: Record<string, unknown> = {};
    if (formKey) body.form_key = formKey;
    const context: Record<string, unknown> = {};
    const targets = getTargets();
    if (targets.length > 0) context.targets = targets;

    if (instanceId) {
      const panelRuntime = getPanelRuntimeSnapshot(instanceId);
      if (panelRuntime) context.panel_runtime = panelRuntime;
      context.selection = readDocxSelection(getDocxEditor(instanceId));
      const callableRules = buildCallableRules(
        internalState[instanceId]?.logicRules ?? []
      );
      if (callableRules.length > 0) context.callable_rules = callableRules;
    }
    body.context = context;
    return body;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setModeState] = useState<AssistantMode>(readStoredMode);
  const setMode = useCallback((next: AssistantMode) => {
    setModeState(next);
    writeStoredMode(next);
  }, []);

  // Whitelist: no steps configured = available everywhere, otherwise the
  // assistant is hidden on steps absent from the map (kept mounted, see render)
  const whitelistActive = Object.keys(stepSettings).length > 0;
  const hiddenByWhitelist =
    whitelistActive && (!activeStepId || !(activeStepId in stepSettings));

  // Apply the creator's open default once per step entry, close/switch still sticks
  const forcedStepRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeStepId || activeStepId === forcedStepRef.current) return;
    forcedStepRef.current = activeStepId;
    const stepDefault = stepSettings[activeStepId];
    if (stepDefault === 'floating' || stepDefault === 'sidebar_right') {
      setIsOpen(true);
      setModeState(
        stepDefault === 'sidebar_right' ? 'sidebar-right' : 'current'
      );
    }
  }, [activeStepId, stepSettings]);

  const [sidebarWidth, setSidebarWidth] = useState<number>(
    readStoredSidebarWidth
  );
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const onWindowResize = () => {
      setSidebarWidth((w) => {
        const newWidth = clampSidebarWidth(w);
        if (newWidth !== w) writeStoredSidebarWidth(newWidth);
        return newWidth;
      });
    };
    featheryWindow().addEventListener('resize', onWindowResize);
    return () => featheryWindow().removeEventListener('resize', onWindowResize);
  }, []);

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
        writeStoredSidebarWidth(currentWidth);
      };
      featheryWindow().addEventListener('pointermove', handleMove);
      featheryWindow().addEventListener('pointerup', handleUp);
      featheryWindow().addEventListener('pointercancel', handleUp);
    },
    [sidebarWidth]
  );

  const handleResizeDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    writeStoredSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);

  const [input, setInput] = useState('');
  const [threads, setThreads] = useState<AssistantThreadDetail[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [actionTooltip, setActionTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Suppresses auto-scroll when the user has scrolled up to read earlier content
  const atBottomRef = useRef(true);
  const BOTTOM_THRESHOLD_PX = 60;

  // Voice state read while sending a request and while routing its streamed data parts
  const voiceActiveRef = useRef(false);
  const pendingAudioRef = useRef<Blob | null>(null);
  const voiceDataRef = useRef<
    | ((part: {
        type: string;
        data?: { text?: string; audio?: string };
      }) => void)
    | null
  >(null);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distance < BOTTOM_THRESHOLD_PX;
  }, []);

  // Keep the newest content anchored at the bottom, pushing older content up
  const pinToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const colors = useMemo(
    () => getChatColors(color || DEFAULT_CHAT_COLOR),
    [color]
  );

  const makeChat = (
    threadId: string | null,
    initialMessages: any[] = [],
    initialTitle?: string
  ): Chat<any> => {
    // Attachment session key, a new chat sends the minted id as thread_id
    // and the server adopts it on first message (builder convention) so
    // pre-thread uploads land in the right thread
    const sessionId = threadId ?? uuidv4();
    let resolvedThreadId = threadId;
    let titleGenerated = !!initialTitle;

    // Title the thread from its first user message, whether typed or a voice transcript
    const triggerTitle = (userText?: string) => {
      if (titleGenerated || !userText) return;
      titleGenerated = true;
      const currentThreadId = resolvedThreadId || null;
      const titleContext: {
        targets?: ResourceRef[];
        current_step?: string;
      } = {};
      const targets = getTargets();
      if (targets.length > 0) titleContext.targets = targets;
      if (instanceId) {
        const stepKey = getCurrentStepKey(instanceId);
        if (stepKey) titleContext.current_step = stepKey;
      }
      generateThreadTitle(
        baseUrl,
        headers,
        currentThreadId,
        userText,
        titleContext,
        formKey
      ).then((title) => {
        if (!title) return;
        setThreads((prev) =>
          prev.map((t) =>
            t.id === currentThreadId || t.chat === chat ? { ...t, title } : t
          )
        );
      });
    };

    const chatTransport = new DefaultChatTransport({
      api: baseUrl,
      headers: headers,
      body: () => ({
        ...buildChatBody(),
        thread_id: resolvedThreadId || sessionId
      }),
      fetch: async (url: any, init?: any) => {
        let res: Response;
        if (voiceActiveRef.current) {
          const form = new FormData();
          form.append(
            'payload',
            typeof init?.body === 'string'
              ? init.body
              : JSON.stringify(init?.body ?? {})
          );
          const audio = pendingAudioRef.current;
          if (audio) {
            form.append('audio', audio, 'speech.wav');
            pendingAudioRef.current = null;
          }
          if (formKey) form.append('form_key', formKey);
          res = await fetch(`${baseUrl}voice/turn/`, {
            method: 'POST',
            headers: headers(),
            body: form,
            signal: init?.signal
          });
        } else {
          res = await fetch(url, init);
        }
        const threadId = res.headers.get('X-Thread-Id');
        if (threadId && !resolvedThreadId) {
          resolvedThreadId = threadId;
          setThreads((prev) =>
            prev.map((t) =>
              t.chat === chat ? { ...t, id: threadId, isTemporary: false } : t
            )
          );
          setActiveThreadId(threadId);
          getThreadDetail(baseUrl, headers, threadId, formKey).then((t) => {
            if (t)
              setThreads((prev) =>
                prev.map((thread) =>
                  thread.id === threadId
                    ? { ...t, chat, title: thread.title || t.title }
                    : thread
                )
              );
          });
        }
        triggerTitle(
          titleSeedFromMessage(
            chat.messages.find((m: any) => m.role === 'user')
          )
        );
        return res;
      }
    });

    const chat: Chat<any> = new Chat<any>({
      transport: chatTransport,
      messages: initialMessages,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onData: (part: any) => {
        if (part?.type === 'data-transcript') triggerTitle(part.data?.text);
        voiceDataRef.current?.(part);
      },
      onToolCall: async ({ toolCall }: any) => {
        const dispatched = await dispatchAssistantTool(
          toolCall.toolName,
          toolCall.input ?? {},
          {
            docxBridge: createDocxEditorBridge(() => getDocxEditor(instanceId)),
            callableRules: buildCallableRules(
              internalState[instanceId ?? '']?.logicRules ?? []
            ),
            runLogicRule: (ruleId, inputParams) =>
              runLogicRuleById(ruleId, inputParams, instanceId)
          }
        );
        if (dispatched.handled) {
          chat.addToolOutput({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            output: dispatched.output
          });
          return;
        }
        if (toolCall.dynamic) return;

        if (toolCall.toolName === 'setFieldValue') {
          const input = (toolCall.input ?? {}) as {
            fields?: Array<{
              fieldKey?: unknown;
              value?: unknown;
              repeatIndex?: unknown;
            }>;
          };
          const fields = Array.isArray(input.fields) ? input.fields : [];
          const output = await dispatchSetFieldValue(instanceId, fields);
          chat.addToolOutput({
            tool: 'setFieldValue',
            toolCallId: toolCall.toolCallId,
            output
          });
        } else if (toolCall.toolName === 'clickElement') {
          const input = (toolCall.input ?? {}) as {
            elementId?: unknown;
            repeatIndex?: unknown;
          };
          const elementId =
            typeof input.elementId === 'string' ? input.elementId : '';
          const output = await dispatchClickElement(
            instanceId,
            elementId,
            input.repeatIndex
          );
          chat.addToolOutput({
            tool: 'clickElement',
            toolCallId: toolCall.toolCallId,
            output
          });
        } else if (toolCall.toolName === 'navigateToStep') {
          const input = (toolCall.input ?? {}) as { stepKey?: unknown };
          const stepKey =
            typeof input.stepKey === 'string' ? input.stepKey : '';
          const output = await dispatchNavigate(instanceId, stepKey);
          chat.addToolOutput({
            tool: 'navigateToStep',
            toolCallId: toolCall.toolCallId,
            output
          });
        } else if (toolCall.toolName === 'triggerTableAction') {
          const input = (toolCall.input ?? {}) as {
            tableId?: unknown;
            rowIndex?: unknown;
            actionLabel?: unknown;
          };
          const tableId =
            typeof input.tableId === 'string' ? input.tableId : '';
          const rowIndex =
            typeof input.rowIndex === 'number' ? input.rowIndex : NaN;
          const actionLabel =
            typeof input.actionLabel === 'string'
              ? input.actionLabel
              : undefined;
          const output = await dispatchTriggerTableAction(
            instanceId,
            tableId,
            rowIndex,
            actionLabel
          );
          chat.addToolOutput({
            tool: 'triggerTableAction',
            toolCallId: toolCall.toolCallId,
            output
          });
        } else if (toolCall.toolName === 'addTableRow') {
          const input = (toolCall.input ?? {}) as { tableId?: unknown };
          const tableId =
            typeof input.tableId === 'string' ? input.tableId : '';
          const output = await dispatchAddTableRow(instanceId, tableId);
          chat.addToolOutput({
            tool: 'addTableRow',
            toolCallId: toolCall.toolCallId,
            output
          });
        } else if (toolCall.toolName === 'deleteTableRow') {
          const input = (toolCall.input ?? {}) as {
            tableId?: unknown;
            rowIndex?: unknown;
          };
          const tableId =
            typeof input.tableId === 'string' ? input.tableId : '';
          const rowIndex =
            typeof input.rowIndex === 'number' ? input.rowIndex : NaN;
          const output = await dispatchDeleteTableRow(
            instanceId,
            tableId,
            rowIndex
          );
          chat.addToolOutput({
            tool: 'deleteTableRow',
            toolCallId: toolCall.toolCallId,
            output
          });
        } else if (toolCall.toolName === 'setTableCellValue') {
          const input = (toolCall.input ?? {}) as {
            tableId?: unknown;
            cells?: unknown;
          };
          const tableId =
            typeof input.tableId === 'string' ? input.tableId : '';
          const cells = Array.isArray(input.cells)
            ? (input.cells as Array<{
                rowIndex: unknown;
                fieldKey: unknown;
                value: unknown;
              }>)
            : [];
          const output = await dispatchSetTableCellValue(
            instanceId,
            tableId,
            cells
          );
          chat.addToolOutput({
            tool: 'setTableCellValue',
            toolCallId: toolCall.toolCallId,
            output
          });
        }
      },
      onFinish: ({ isAbort, isError }: any) => {
        if (isAbort || isError || !resolvedThreadId) return;
        setThreads((prev) => {
          const thread = prev.find((t) => t.id === resolvedThreadId);
          if (!thread) return prev;
          return [
            { ...thread, updated_at: new Date().toISOString() },
            ...prev.filter((t) => t.id !== resolvedThreadId)
          ];
        });
      }
    });

    setChatSessionId(chat, sessionId);

    return chat;
  };

  const readyChat = useMemo(
    () => makeChat(null),
    [headers, getTargets, getJwt]
  );
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const activeChat = activeThread?.chat ?? readyChat;

  const {
    messages: rawMessages,
    sendMessage,
    setMessages,
    status,
    error
  } = useChat({
    chat: activeChat
  });

  const {
    attachments,
    attachmentError,
    attachmentsInFlight,
    isDragging,
    fileInputRef,
    addFiles,
    removeFile,
    takeAttachments,
    handlePaste: handleComposerPaste,
    handleDragOver,
    handleDragLeave,
    handleDrop
  } = useChatAttachments({ activeChat, baseUrl, headers, formKey });

  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreview | null>(null);
  // A send fired while attachments were indexing, the message shows
  // optimistically and the real request replaces it via messageId once its
  // batch is terminal, files attached meanwhile stay for the next message
  const [pendingSubmit, setPendingSubmit] = useState<{
    tempId: string;
    text: string;
    previewUrls: string[];
  } | null>(null);
  useEffect(() => setPendingSubmit(null), [activeChat]);

  const stagedAttachments = pendingSubmit
    ? attachments.filter(
        (a) => !pendingSubmit.previewUrls.includes(a.previewUrl)
      )
    : attachments;
  const showAttachmentBar = stagedAttachments.length > 0 || !!attachmentError;

  const messages = useMemo(() => {
    const combined: typeof rawMessages = [];
    for (const m of rawMessages) {
      const prev = combined[combined.length - 1] as any;
      if (
        prev &&
        prev.role === 'assistant' &&
        (m as any).role === 'assistant'
      ) {
        combined[combined.length - 1] = {
          ...prev,
          parts: [...(prev.parts ?? []), ...((m as any).parts ?? [])]
        } as any;
      } else {
        combined.push(m);
      }
    }
    return combined;
  }, [rawMessages]);

  useEffect(() => {
    pinToBottom();
  }, [messages, pinToBottom]);

  useEffect(() => {
    if (status !== 'ready') return;
    const id = featheryWindow().requestAnimationFrame(pinToBottom);
    return () => featheryWindow().cancelAnimationFrame(id);
  }, [status, pinToBottom]);

  const fetchThreads = useCallback(async () => {
    const data = await getThreadList(baseUrl, headers, formKey);
    if (!data) return;
    setThreads((prev) => [
      ...data.map((d) => ({
        ...d,
        chat: prev.find((p) => p.id === d.id)?.chat
      })),
      ...prev.filter((p) => !data.find((d) => d.id === p.id))
    ]);
  }, [headers, baseUrl, formKey]);

  useEffect(() => {
    if (isOpen) fetchThreads();
  }, [isOpen, fetchThreads]);

  const handleNewThread = () => {
    if (pendingSubmit) return;
    stopVoice();
    atBottomRef.current = true;
    const id = uuidv4();
    const now = new Date().toISOString();
    const chat = makeChat(null);
    setThreads((prev) => [
      {
        id,
        title: '',
        created_at: now,
        updated_at: now,
        isTemporary: true,
        chat
      },
      ...prev.filter((t) => !t.isTemporary || t.title)
    ]);
    setActiveThreadId(id);
  };

  const handleSelectThread = async (id: string) => {
    if (pendingSubmit) return;
    stopVoice();
    atBottomRef.current = true;
    if (threads.find((t) => t.id === id)?.chat) {
      setActiveThreadId(id);
      setIsDropdownOpen(false);
      return;
    }
    const thread = await getThreadDetail(baseUrl, headers, id, formKey);
    if (!thread) return;
    const chat = makeChat(id, thread.messages ?? [], thread.title);
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...thread, chat } : t))
    );
    setActiveThreadId(id);
    setIsDropdownOpen(false);
  };

  const handleDeleteThread = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    const thread = threads.find((t) => t.id === id);
    if (!thread?.isTemporary) {
      await deleteThread(baseUrl, headers, id, formKey);
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) handleNewThread();
  };

  // First send of a thread registers it as a real entry, for both text and voice
  const registerActiveThread = useCallback(() => {
    atBottomRef.current = true;
    const now = new Date().toISOString();
    if (!activeThreadId) {
      const id = uuidv4();
      setThreads((prev) => [
        {
          id,
          title: 'New Chat',
          created_at: now,
          updated_at: now,
          isTemporary: true,
          chat: activeChat
        },
        ...prev
      ]);
      setActiveThreadId(id);
    } else if (activeThread && !activeThread.title) {
      setThreads((prev) => [
        { ...activeThread, title: 'New Chat', updated_at: now },
        ...prev.filter((t) => t.id !== activeThreadId)
      ]);
    }
  }, [activeThreadId, activeThread, activeChat]);

  const {
    voiceState,
    voiceActive,
    micAvailable,
    spokenChars,
    audioDraining,
    startVoice,
    stopVoice,
    skipSpeaking
  } = useAssistantVoice({
    status,
    sendMessage: async (message) => {
      await ensureCompletedSteps(instanceId);
      return sendMessage(message);
    },
    setMessages,
    ensureThread: registerActiveThread,
    voiceActiveRef,
    pendingAudioRef,
    voiceDataRef
  });

  // Stop the mic if the assistant becomes hidden on a whitelisted step
  useEffect(() => {
    if (hiddenByWhitelist) stopVoice();
  }, [hiddenByWhitelist, stopVoice]);

  // Voice: keep the view pinned to the bottom as the reply reveals during playback
  useEffect(() => {
    pinToBottom();
  }, [spokenChars, audioDraining, pinToBottom]);

  const handleSend = async () => {
    if (status !== 'ready' || pendingSubmit) return;
    const hasText = !!input.trim();
    if (!hasText && attachments.length === 0) return;
    registerActiveThread();

    // Show the message now with local previews, the resolver fires the
    // real request once the batch is terminal
    if (attachmentsInFlight) {
      const tempId = uuidv4();
      const parts: any[] = [];
      if (hasText) parts.push({ type: 'text', text: input });
      attachments.forEach((a) => parts.push(getFilePart(a)));
      setMessages([
        ...(rawMessages as any[]),
        { id: tempId, role: 'user', parts } as any
      ]);
      setPendingSubmit({
        tempId,
        text: input,
        previewUrls: attachments.map((a) => a.previewUrl)
      });
      setInput('');
      return;
    }

    await ensureCompletedSteps(instanceId);
    const staged = takeAttachments();
    const fileParts = staged.filter((a) => a.id).map(getFilePart);
    sendMessage({
      text: input,
      ...(fileParts.length > 0 ? { files: fileParts } : {})
    } as any);
    setInput('');
    staged.forEach((a) => URL.revokeObjectURL(a.previewUrl));
  };

  // Optimistic-submit resolver: swap the placeholder for the real send once
  // the batch is terminal, pendingSubmit clears only when the swap lands so
  // the dim+spinner holds through the pre-send flush
  const resolvingRef = useRef(false);
  useEffect(() => {
    if (!pendingSubmit || resolvingRef.current) return;
    const submitted = attachments.filter((a) =>
      pendingSubmit.previewUrls.includes(a.previewUrl)
    );
    if (submitted.some((a) => !isTerminalStatus(a.processingStatus))) return;
    resolvingRef.current = true;
    const { tempId, text, previewUrls } = pendingSubmit;
    const staged = takeAttachments(previewUrls);
    const fileParts = staged.filter((a) => a.id).map(getFilePart);
    if (!text.trim() && fileParts.length === 0) {
      // Every upload failed outright, drop the placeholder
      setMessages((prev: any[]) => prev.filter((m) => m.id !== tempId));
      staged.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      resolvingRef.current = false;
      setPendingSubmit(null);
      return;
    }
    (async () => {
      await ensureCompletedSteps(instanceId);
      // sendMessage swaps the placeholder synchronously before the request
      const sent = sendMessage({
        text,
        ...(fileParts.length > 0 ? { files: fileParts } : {}),
        messageId: tempId
      } as any);
      resolvingRef.current = false;
      setPendingSubmit(null);
      // Revoke the local previews only after the send settles, the
      // placeholder renders from them until the swap lands, send errors
      // surface via the chat's own error path
      await sent.catch(() => {});
      staged.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    })();
  }, [pendingSubmit, attachments]);

  const handleWorkflowAction = async (action: WorkflowAction) => {
    if (status !== 'ready') return;
    registerActiveThread();
    await ensureCompletedSteps(instanceId);
    sendMessage({
      parts: [
        { type: 'text', text: action.name },
        {
          type: 'text',
          text: action.instructions,
          hidden: true,
          interpolate: true
        }
      ]
    } as any);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
  };

  // Only show threads that have had at least one message sent
  const visibleThreads = threads.filter((t) => t.title);

  const isLoading = status === 'submitted' || status === 'streaming';

  const composerButtonCss = {
    padding: '10px',
    backgroundColor: colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s',
    ':hover:not(:disabled)': { backgroundColor: colors.hover },
    ':disabled': { backgroundColor: colors.disabled, cursor: 'not-allowed' }
  } as const;

  const layoutSide: 'left' | 'right' | null =
    mode === 'sidebar-left'
      ? 'left'
      : mode === 'sidebar-right'
      ? 'right'
      : null;
  const layoutOpen = isOpen && !hiddenByWhitelist;
  const layoutWidth = layoutOpen && layoutSide ? sidebarWidth : 0;

  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;
  useEffect(() => {
    onLayoutChangeRef.current?.({
      mode,
      isOpen: layoutOpen,
      side: hiddenByWhitelist ? null : layoutSide,
      width: layoutWidth,
      isResizing
    });
  }, [
    mode,
    layoutOpen,
    layoutSide,
    layoutWidth,
    isResizing,
    hiddenByWhitelist
  ]);

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

  // Stay mounted so chat/thread state survives navigating hidden steps
  if (hiddenByWhitelist) return null;

  const fabOnLeft = mode === 'sidebar-left';
  const fabSide = fabOnLeft ? { left: '20px' } : { right: '20px' };
  const fabBottom = fabOnLeft ? 20 : bottom;
  if (!isOpen) {
    return (
      <button
        type='button'
        onClick={() => setIsOpen(true)}
        css={{
          position: 'fixed',
          bottom: `${fabBottom}px`,
          ...fabSide,
          width: `${FAB_SIZE}px`,
          height: `${FAB_SIZE}px`,
          borderRadius: '50%',
          backgroundColor: colors.primary,
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow:
            '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.2s',
          zIndex: 1000,
          ':hover': {
            backgroundColor: colors.hover,
            transform: 'scale(1.05)',
            boxShadow:
              '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
          }
        }}
      >
        <ChatIcon />
      </button>
    );
  }

  // Expanded state - show full chat panel
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

  return (
    <div
      css={{
        position: 'fixed',
        backgroundColor: 'white',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 1000,
        ...panelGeometry
      }}
    >
      {layoutSide && (
        <div
          role='separator'
          aria-orientation='vertical'
          aria-label='Resize assistant panel'
          title='Drag to resize, double-click to reset'
          onPointerDown={handleResizePointerDown(layoutSide)}
          onDoubleClick={handleResizeDoubleClick}
          css={{
            position: 'absolute',
            top: 0,
            [layoutSide === 'right' ? 'left' : 'right']: 0,
            width: '6px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 2,
            touchAction: 'none',
            userSelect: 'none',
            '::after': {
              content: '""',
              position: 'absolute',
              top: 0,
              [layoutSide === 'right' ? 'left' : 'right']: '2px',
              width: '2px',
              height: '100%',
              backgroundColor: 'transparent',
              transition: 'background-color 120ms ease'
            },
            ':hover::after': {
              backgroundColor: 'rgba(0, 0, 0, 0.15)'
            }
          }}
        />
      )}

      {/* Header */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '2px',
          padding: '12px 16px',
          backgroundColor: colors.primary,
          color: 'white',
          position: 'relative',
          ...(layoutSide
            ? {
                minHeight: 'var(--main-nav-height, 55px)',
                boxSizing: 'border-box'
              }
            : {})
        }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            flex: 1,
            overflow: 'hidden'
          }}
        >
          <ChatIcon />
          <button
            type='button'
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            css={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              minWidth: 0,
              maxWidth: '100%',
              ':hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' }
            }}
          >
            <span
              css={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
            >
              {activeThread?.title || 'AI Assistant'}
            </span>
            <span css={{ display: 'flex', opacity: 0.8, flexShrink: 0 }}>
              <ChevronDownIcon />
            </span>
          </button>
        </div>
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            position: 'relative',
            flexShrink: 0
          }}
        >
          <button
            type='button'
            onClick={() => setIsModeMenuOpen((prev) => !prev)}
            css={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              ':hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' }
            }}
          >
            <ModeTriggerIcon />
          </button>
          <button
            type='button'
            onClick={() => {
              stopVoice();
              setIsOpen(false);
            }}
            css={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              ':hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)'
              }
            }}
          >
            <CollapseIcon />
          </button>
          {isModeMenuOpen && (
            <>
              <div
                css={{ position: 'fixed', inset: 0, zIndex: 1000 }}
                onClick={() => setIsModeMenuOpen(false)}
              />
              <div
                css={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  minWidth: '180px',
                  backgroundColor: 'white',
                  border: `1px solid ${GRAY_200}`,
                  borderRadius: '8px',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
                  zIndex: 1001,
                  overflow: 'hidden'
                }}
              >
                {(
                  [
                    { value: 'current', label: 'Floating', Icon: FloatingIcon },
                    {
                      value: 'sidebar-left',
                      label: 'Sidebar left',
                      Icon: SidebarLeftIcon
                    },
                    {
                      value: 'sidebar-right',
                      label: 'Sidebar right',
                      Icon: SidebarRightIcon
                    },
                    {
                      value: 'fullscreen',
                      label: 'Fullscreen',
                      Icon: FullscreenIcon
                    }
                  ] as Array<{
                    value: AssistantMode;
                    label: string;
                    Icon: typeof FloatingIcon;
                  }>
                )
                  .filter(({ value }) => allowedModes.includes(value))
                  .map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type='button'
                      onClick={() => {
                        setMode(value);
                        setIsModeMenuOpen(false);
                      }}
                      css={{
                        width: '100%',
                        padding: '10px 14px',
                        background: value === mode ? colors.light : 'white',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: GRAY_800,
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        ':hover': { backgroundColor: GRAY_50 }
                      }}
                    >
                      <span
                        css={{
                          display: 'flex',
                          color: GRAY_400,
                          flexShrink: 0
                        }}
                      >
                        <Icon />
                      </span>
                      <span>{label}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>

        {/* Thread dropdown */}
        {isDropdownOpen && (
          <>
            <div
              css={{ position: 'fixed', inset: 0, zIndex: 1000 }}
              onClick={() => setIsDropdownOpen(false)}
            />
            <div
              css={{
                position: 'absolute',
                top: '100%',
                left: 0,
                width: '100%',
                backgroundColor: 'white',
                border: `1px solid ${GRAY_200}`,
                borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
                zIndex: 1001,
                maxHeight: '240px',
                overflowY: 'scroll'
              }}
            >
              <button
                type='button'
                onClick={() => {
                  handleNewThread();
                  setIsDropdownOpen(false);
                }}
                css={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'none',
                  border: 'none',
                  borderBottom: `1px solid ${GRAY_100}`,
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: colors.primary,
                  textAlign: 'left',
                  ':hover': { backgroundColor: GRAY_50 }
                }}
              >
                + New Chat
              </button>

              {visibleThreads.length === 0 && (
                <div
                  css={{
                    padding: '12px 14px',
                    fontSize: '13px',
                    color: GRAY_400
                  }}
                >
                  No chats yet
                </div>
              )}
              {visibleThreads.map((thread) => (
                <div
                  key={thread.id}
                  onClick={() => handleSelectThread(thread.id)}
                  css={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    backgroundColor:
                      thread.id === activeThreadId ? colors.light : 'white',
                    ':hover': { backgroundColor: GRAY_50 }
                  }}
                >
                  <div css={{ flex: 1, minWidth: 0 }}>
                    <div
                      css={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: GRAY_800,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {thread.title || 'Untitled conversation'}
                    </div>
                    <div
                      css={{
                        fontSize: '11px',
                        color: GRAY_400,
                        marginTop: '2px'
                      }}
                    >
                      {new Date(thread.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    type='button'
                    onClick={(e) => handleDeleteThread(thread.id, e)}
                    css={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: GRAY_400,
                      fontSize: '16px',
                      padding: '2px 6px',
                      marginLeft: '8px',
                      borderRadius: '4px',
                      lineHeight: 1,
                      ':hover': {
                        color: '#dc2626',
                        backgroundColor: '#fef2f2'
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        css={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {messages.length === 0 && (
          <div
            css={{
              textAlign: 'center',
              color: GRAY_400,
              fontSize: '14px',
              marginTop: '40px'
            }}
          >
            How can I help?
          </div>
        )}

        {messages.map((message, mIdx) =>
          message.role === 'user' ? (
            // Show the bubble only once its transcript or attachments land,
            // not as an empty placeholder
            (message.parts ?? []).some(
              (p: any) =>
                (p.type === 'text' && (p.text ?? '').trim()) ||
                p.type === 'file'
            ) ? (
              <div
                key={message.id}
                css={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: '6px'
                }}
              >
                <div
                  css={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
                    gap: '6px'
                  }}
                >
                  {(message.parts ?? [])
                    .filter((part: any) => part.type === 'file')
                    .map((part: any, index: number) => (
                      <MessageAttachment
                        key={`file-${index}`}
                        mediaType={part.mediaType ?? ''}
                        filename={part.filename}
                        url={part.url}
                        inFlight={pendingSubmit?.tempId === message.id}
                        onOpen={() =>
                          setAttachmentPreview({
                            url: part.url,
                            mediaType: part.mediaType ?? '',
                            filename: part.filename
                          })
                        }
                      />
                    ))}
                </div>
                {(message.parts ?? []).some(
                  (p: any) => p.type === 'text' && (p.text ?? '').trim()
                ) && (
                  <div
                    css={{
                      maxWidth: '80%',
                      padding: '10px 14px',
                      borderRadius: '12px',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      backgroundColor: colors.primary,
                      color: 'white',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word'
                    }}
                  >
                    {message.parts
                      .filter((part: any) => !part.hidden)
                      .map((part: any, index: number) =>
                        part.type === 'text' ? (
                          <span key={index}>{part.text}</span>
                        ) : null
                      )}
                  </div>
                )}
              </div>
            ) : null
          ) : (
            <Fragment key={message.id}>
              {(() => {
                const isLastMsg = mIdx === messages.length - 1;
                const chunks = mergeAssistantParts(message.parts);
                const lastPart = message.parts[message.parts.length - 1];
                const turnFinished =
                  !isLastMsg ||
                  (status === 'ready' && lastPart?.type === 'text');
                // Voice: reveal parts top-to-bottom, paced by how much audio has played
                const paceByAudio =
                  voiceActiveRef.current &&
                  isLastMsg &&
                  (isLoading || audioDraining);
                let revealable = paceByAudio ? spokenChars : Infinity;
                let blocked = false;
                return chunks.map((chunk, chunkIdx) => {
                  if (blocked) return null;
                  if (chunk.kind === 'text') {
                    // Reveal up to the spoken budget, whitespace is free so the trailing "?" isn't held back
                    let revealLen = 0;
                    while (
                      revealLen < chunk.text.length &&
                      (revealable > 0 || /\s/.test(chunk.text[revealLen]))
                    ) {
                      if (!/\s/.test(chunk.text[revealLen])) revealable -= 1;
                      revealLen += 1;
                    }
                    if (revealLen < chunk.text.length) blocked = true;
                    if (revealLen <= 0) return null;
                    return (
                      <div
                        key={chunk.key}
                        css={{
                          display: 'flex',
                          justifyContent: 'flex-start'
                        }}
                      >
                        <div
                          css={{
                            maxWidth: '80%',
                            padding: '10px 14px',
                            borderRadius: '12px',
                            fontSize: '14px',
                            lineHeight: '1.5',
                            backgroundColor: colors.light,
                            color: GRAY_800,
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word'
                          }}
                        >
                          <MarkdownText
                            text={chunk.text.slice(0, revealLen)}
                            isStreaming={
                              isLoading &&
                              isLastMsg &&
                              chunkIdx === chunks.length - 1
                            }
                          />
                        </div>
                      </div>
                    );
                  }
                  const followedByText = chunks
                    .slice(chunkIdx + 1)
                    .some((c) => c.kind === 'text');
                  // Hold the tool's working state until the followup reply's audio begins
                  const audioPending =
                    paceByAudio && followedByText && revealable <= 0;
                  return (
                    <div
                      key={chunk.key}
                      css={{
                        display: 'flex',
                        justifyContent: 'flex-start',
                        maxWidth: '80%',
                        minWidth: 0
                      }}
                    >
                      <ToolChunk
                        rows={chunk.rows}
                        turnFinished={turnFinished}
                        followedByText={followedByText}
                        audioPending={audioPending}
                        linkColor={colors.primary}
                        isFirstChunk={chunkIdx === 0}
                      />
                    </div>
                  );
                });
              })()}
            </Fragment>
          )
        )}

        {(() => {
          if (!isLoading) return null;
          const last = messages[messages.length - 1] as
            | { role?: string; parts?: any[] }
            | undefined;
          if (!last) return null;
          const parts = last.parts || [];
          const isContent = (p: any) => {
            if (p?.type === 'text') return (p.text ?? '').trim().length > 0;
            const t = typeof p?.type === 'string' ? p.type : '';
            return t.startsWith('tool-') || t === 'dynamic-tool';
          };
          const hasContent = parts.some(isContent);
          if (last.role === 'user') {
            // Wait for the user's (transcribed) message to be visible before showing the indicator
            if (!hasContent) return null;
          } else {
            // Voice: keep the indicator up while a leading reply is held waiting for its audio
            const held =
              voiceActiveRef.current &&
              spokenChars <= 0 &&
              parts.find(isContent)?.type === 'text';
            if (hasContent && !held) return null;
          }
          return <ToolChunkPlaceholder />;
        })()}

        {pendingSubmit && <ToolChunkPlaceholder label='Uploading...' />}

        {error && (
          <div
            css={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              fontSize: '14px'
            }}
          >
            Something went wrong. Please try again.
          </div>
        )}
      </div>

      {/* Workflow action buttons */}
      {workflowActions.length > 0 && (
        <div
          css={{
            position: 'relative',
            zIndex: 1,
            borderTop: `1px solid ${GRAY_200}`,
            backgroundColor: GRAY_50,
            padding: '8px 16px',
            display: 'flex',
            gap: '6px',
            overflowX: 'auto'
          }}
        >
          {workflowActions.map((action, index) => (
            <button
              key={index}
              type='button'
              disabled={isLoading}
              onClick={() => handleWorkflowAction(action)}
              onMouseEnter={(e: React.MouseEvent) => {
                if (!action.description) return;
                const r = e.currentTarget.getBoundingClientRect();
                setActionTooltip({
                  text: action.description,
                  x: r.left + r.width / 2,
                  y: r.top
                });
              }}
              onMouseLeave={() => setActionTooltip(null)}
              css={{
                flexShrink: 0,
                padding: '4px 10px',
                fontSize: '12px',
                border: `1px solid ${colors.primary}`,
                borderRadius: '12px',
                backgroundColor: 'white',
                color: colors.primary,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
                ':hover:not(:disabled)': { backgroundColor: colors.light },
                transition: 'background-color 0.15s, color 0.15s'
              }}
            >
              {action.name}
            </button>
          ))}
          {actionTooltip && (
            <div
              css={{
                position: 'fixed',
                top: actionTooltip.y - 34,
                left: actionTooltip.x,
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0,0,0,0.9)',
                color: 'white',
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 10000
              }}
            >
              {actionTooltip.text}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      {showAttachmentBar && (
        <div
          css={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '10px 16px 0',
            borderTop: `1px solid ${GRAY_200}`,
            backgroundColor: GRAY_50
          }}
        >
          {attachmentError && (
            <div css={{ fontSize: '12px', color: '#dc2626', width: '100%' }}>
              {attachmentError}
            </div>
          )}
          {stagedAttachments.map((attachment) => (
            <AttachmentChip
              key={attachment.previewUrl}
              attachment={attachment}
              onRemove={() => removeFile(attachment.previewUrl)}
            />
          ))}
        </div>
      )}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderTop: showAttachmentBar ? 'none' : `1px solid ${GRAY_200}`,
          backgroundColor: GRAY_50,
          ...(isDragging
            ? { outline: `2px dashed ${colors.primary}`, outlineOffset: '-4px' }
            : {})
        }}
      >
        {!voiceActive && (
          <>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept={ACCEPT_ATTR}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) addFiles(files);
                e.target.value = '';
              }}
              css={{ display: 'none' }}
            />
            <button
              type='button'
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              aria-label='Attach files'
              css={{
                padding: '10px',
                backgroundColor: 'transparent',
                color: GRAY_800,
                border: `1px solid ${GRAY_200}`,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s',
                ':hover:not(:disabled)': { backgroundColor: GRAY_100 },
                ':disabled': { cursor: 'not-allowed', color: GRAY_400 }
              }}
            >
              <PaperclipIcon />
            </button>
          </>
        )}
        {voiceActive ? (
          <button
            type='button'
            onClick={voiceState === 'speaking' ? skipSpeaking : undefined}
            css={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 14px',
              border: `1px solid ${GRAY_200}`,
              borderRadius: '8px',
              backgroundColor: 'white',
              fontSize: '14px',
              color: GRAY_800,
              cursor: voiceState === 'speaking' ? 'pointer' : 'default'
            }}
          >
            <WaveformIcon css={{ color: colors.primary }} />
            {voiceState === 'loading'
              ? 'Loading…'
              : voiceState === 'transcribing'
              ? 'Transcribing…'
              : voiceState === 'thinking'
              ? 'Thinking…'
              : voiceState === 'speaking'
              ? 'Tap to skip'
              : 'Listening…'}
          </button>
        ) : (
          <input
            type='text'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handleComposerPaste}
            placeholder='Type a message...'
            css={{
              flex: 1,
              padding: '10px 14px',
              border: `1px solid ${GRAY_200}`,
              borderRadius: '8px',
              fontSize: '14px',
              outline: 'none',
              transition: 'border-color 0.2s',
              ':focus': {
                borderColor: colors.primary
              }
            }}
          />
        )}
        {voiceActive ? (
          <button
            type='button'
            onClick={stopVoice}
            aria-label='Exit voice mode'
            css={composerButtonCss}
          >
            <CloseIcon />
          </button>
        ) : !voiceEnabled || input.trim() || attachments.length > 0 ? (
          <button
            type='button'
            onClick={handleSend}
            disabled={
              isLoading ||
              !!pendingSubmit ||
              (!input.trim() && attachments.length === 0)
            }
            css={composerButtonCss}
          >
            <SendIcon />
          </button>
        ) : (
          <button
            type='button'
            onClick={startVoice}
            disabled={isLoading || !micAvailable}
            aria-label='Start voice mode'
            title={micAvailable ? undefined : 'Microphone unavailable'}
            css={composerButtonCss}
          >
            <MicIcon />
          </button>
        )}
      </div>
      {attachmentPreview && (
        <AttachmentPreviewOverlay
          preview={attachmentPreview}
          onClose={() => setAttachmentPreview(null)}
        />
      )}
    </div>
  );
};

export default AssistantChat;
