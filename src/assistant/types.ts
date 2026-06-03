export type AssistantMode =
  | 'current'
  | 'sidebar-left'
  | 'sidebar-right'
  | 'fullscreen';

export type AssistantLayoutState = {
  mode: AssistantMode;
  isOpen: boolean;
  side: 'left' | 'right' | null;
  width: number;
  isResizing: boolean;
};

export type AssistantHeaders = () => Record<string, string>;

export type ResourceRef = { type: string; id: string };

export type WorkflowAction = {
  name: string;
  description?: string;
  instructions: string;
};
