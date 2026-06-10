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
  MinusIcon,
  SendIcon,
  SidebarLeftIcon,
  SidebarRightIcon
} from './icons';
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
  getCurrentStepKey,
  getPanelRuntimeSnapshot
} from './tools/panelRuntime';
import { dispatchSetFieldValue } from './tools/setFieldValue';
import { dispatchClickElement } from './tools/clickElement';
import { dispatchTriggerTableAction } from './tools/triggerTableAction';
import {
  dispatchAddTableRow,
  dispatchDeleteTableRow,
  dispatchSetTableCellValue
} from './tools/tableMutations';

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

export type ResourceRef = { type: string; id: string };

export type WorkflowAction = {
  name: string;
  description?: string;
  instructions: string;
};

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
  workflowActions?: WorkflowAction[];
  allowedModes?: AssistantMode[];
  onLayoutChange?: null | ((state: AssistantLayoutState) => void);
};

const AssistantChat = ({
  instanceId,
  getTargets,
  getJwt,
  baseUrl,
  bottom = 20,
  color,
  workflowActions = [],
  allowedModes = DEFAULT_MODES,
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

  const buildChatBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    const targets = getTargets();
    if (targets.length > 0) body.targets = targets;

    if (instanceId) {
      const panelRuntime = getPanelRuntimeSnapshot(instanceId);
      if (panelRuntime) body.panel_runtime = panelRuntime;
    }
    return body;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setModeState] = useState<AssistantMode>(readStoredMode);
  const setMode = useCallback((next: AssistantMode) => {
    setModeState(next);
    writeStoredMode(next);
  }, []);

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Suppresses auto-scroll when the user has scrolled up to read earlier content
  const atBottomRef = useRef(true);
  const BOTTOM_THRESHOLD_PX = 60;

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distance < BOTTOM_THRESHOLD_PX;
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
    let resolvedThreadId = threadId;
    let titleGenerated = !!initialTitle;

    const chatTransport = new DefaultChatTransport({
      api: baseUrl,
      headers: headers,
      body: () => ({
        ...buildChatBody(),
        thread_id: resolvedThreadId || null
      }),
      fetch: async (url: any, init?: any) => {
        const res = await fetch(url, init);
        const threadId = res.headers.get('X-Thread-Id');
        if (threadId && !resolvedThreadId) {
          resolvedThreadId = threadId;
          setThreads((prev) =>
            prev.map((t) =>
              t.chat === chat ? { ...t, id: threadId, isTemporary: false } : t
            )
          );
          setActiveThreadId(threadId);
          getThreadDetail(baseUrl, headers, threadId).then((t) => {
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
        if (!titleGenerated) {
          const titleMessage = chat.messages.find((m: any) => m.role === 'user')
            ?.parts?.[0]?.text;
          if (titleMessage) {
            titleGenerated = true;
            const currentThreadId = resolvedThreadId || threadId || null;
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
              titleMessage,
              titleContext
            ).then((title) => {
              if (!title) return;
              if (currentThreadId) {
                setThreads((prev) =>
                  prev.map((t) =>
                    t.id === currentThreadId ? { ...t, title } : t
                  )
                );
              } else {
                setThreads((prev) =>
                  prev.map((t) => (t.chat === chat ? { ...t, title } : t))
                );
              }
            });
          }
        }
        return res;
      }
    });

    const chat: Chat<any> = new Chat<any>({
      transport: chatTransport,
      messages: initialMessages,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onToolCall: async ({ toolCall }: any) => {
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
    status,
    error
  } = useChat({
    chat: activeChat
  });

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
    if (!atBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!atBottomRef.current) return;
    const id = featheryWindow().requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end'
      });
    });
    return () => featheryWindow().cancelAnimationFrame(id);
  }, [status]);

  const fetchThreads = useCallback(async () => {
    const data = await getThreadList(baseUrl, headers);
    if (!data) return;
    setThreads((prev) => [
      ...data.map((d) => ({
        ...d,
        chat: prev.find((p) => p.id === d.id)?.chat
      })),
      ...prev.filter((p) => !data.find((d) => d.id === p.id))
    ]);
  }, [headers, baseUrl]);

  useEffect(() => {
    if (isOpen) fetchThreads();
  }, [isOpen, fetchThreads]);

  const handleNewThread = () => {
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
    atBottomRef.current = true;
    if (threads.find((t) => t.id === id)?.chat) {
      setActiveThreadId(id);
      setIsDropdownOpen(false);
      return;
    }
    const thread = await getThreadDetail(baseUrl, headers, id);
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
      await deleteThread(baseUrl, headers, id);
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeThreadId === id) handleNewThread();
  };

  const handleSend = () => {
    if (input.trim() && status === 'ready') {
      atBottomRef.current = true;
      const now = new Date().toISOString();
      if (!activeThreadId) {
        // First send, register readyChat as a real thread entry
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
      } else {
        if (activeThread && !activeThread.title) {
          setThreads((prev) => [
            {
              ...activeThread,
              title: 'New Chat',
              updated_at: now
            },
            ...prev.filter((t) => t.id !== activeThreadId)
          ]);
        }
      }
      sendMessage({ text: input });
      setInput('');
    }
  };

  const handleWorkflowAction = (action: WorkflowAction) => {
    if (status !== 'ready') return;
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

  const layoutSide: 'left' | 'right' | null =
    mode === 'sidebar-left'
      ? 'left'
      : mode === 'sidebar-right'
      ? 'right'
      : null;
  const layoutWidth = isOpen && layoutSide ? sidebarWidth : 0;

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
            onClick={() => setIsOpen(false)}
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
            // User message - single bubble
            <div
              key={message.id}
              css={{
                display: 'flex',
                justifyContent: 'flex-end'
              }}
            >
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
            </div>
          ) : (
            <Fragment key={message.id}>
              {(() => {
                const isLastMsg = mIdx === messages.length - 1;
                const chunks = mergeAssistantParts(message.parts);
                const lastPart = message.parts[message.parts.length - 1];
                const turnFinished =
                  !isLastMsg ||
                  (status === 'ready' && lastPart?.type === 'text');
                return chunks.map((chunk, chunkIdx) => {
                  if (chunk.kind === 'text') {
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
                            text={chunk.text}
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
          if (last.role !== 'user') {
            const parts = last.parts || [];
            const hasContent = parts.some((p: any) => {
              if (p?.type === 'text') return (p.text ?? '').trim().length > 0;
              const t = typeof p?.type === 'string' ? p.type : '';
              return t.startsWith('tool-') || t === 'dynamic-tool';
            });
            if (hasContent) return null;
          }
          return <ToolChunkPlaceholder />;
        })()}

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

        <div ref={messagesEndRef} />
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
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderTop: `1px solid ${GRAY_200}`,
          backgroundColor: GRAY_50
        }}
      >
        <input
          type='text'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
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
        <button
          type='button'
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          css={{
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
            ':hover:not(:disabled)': {
              backgroundColor: colors.hover
            },
            ':disabled': {
              backgroundColor: colors.disabled,
              cursor: 'not-allowed'
            }
          }}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
};

export default AssistantChat;
