// Inline order of the tool groups, mirroring Word/Google Docs compact
// toolbars. When the row runs out of space, groups collapse tail-first into
// the "More" dropdown — so the most essential controls come first.
export const GROUP_KEYS = [
  'history',
  'zoom',
  'style',
  'font',
  'format',
  'align',
  'insert',
  'lists'
] as const;
export type GroupKey = typeof GROUP_KEYS[number];

export { default as HistoryGroup } from './HistoryGroup';
export { default as ZoomGroup } from './ZoomGroup';
export { default as StyleGroup } from './StyleGroup';
export { default as FontGroup } from './FontGroup';
export { default as FormatGroup } from './FormatGroup';
export { default as AlignGroup } from './AlignGroup';
export { default as InsertGroup } from './InsertGroup';
export { default as ListsGroup } from './ListsGroup';
