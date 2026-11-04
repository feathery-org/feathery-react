export { default } from './ui/PptxEditor';
export type {
  PptxEditorProps,
  PptxSource,
  PptxHistoryHost,
  PptxVersion
} from './types';
export { PptxEditorEngine } from './engine/PptxEditorEngine';
export type {
  EditorSnapshot,
  CommandResult,
  EditorEvent
} from './engine/PptxEditorEngine';
export type {
  EditorCommand,
  CommandMeta,
  Invalidation
} from './engine/commands';
export type { PptxChangeRecord } from './engine/changes';
