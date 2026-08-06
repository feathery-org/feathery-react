// Inline order of the tool groups, mirroring Word/Google Docs compact
// toolbars. When the row runs out of space, groups collapse tail-first into
// the "More" dropdown — so the most essential controls come first.
// 'table' is a CONDITIONAL group: its node is null unless the cursor is
// inside a table, and null groups drop out of both the visible and the
// measurement row (renderGroupRow filters them), so the overflow math sees
// them at zero width.
export const GROUP_KEYS = [
  'history',
  'zoom',
  'style',
  'font',
  'format',
  'align',
  'insert',
  'table',
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
export { default as TableGroup } from './TableGroup';
export { default as ListsGroup } from './ListsGroup';
