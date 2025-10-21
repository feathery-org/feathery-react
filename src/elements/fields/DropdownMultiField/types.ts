import type React from 'react';

export type OptionData = {
  tooltip?: string;
  value: string;
  label: string;
};

export type Options = string[] | OptionData[];

// Additional props we inject into React Select so nested components can react to
// the collapse measurements and container metrics.
export type CollapsibleSelectProps = {
  collapsedCount: number;
  containerRef: React.RefObject<HTMLElement | null>;
  collapseSelected: boolean;
  isMeasuring: boolean;
  rowHeight: number | null;
  visibleCount: number;
};
