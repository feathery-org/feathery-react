import type React from 'react';
import type { MultiValueProps } from 'react-select';

export type OptionData = {
  tooltip?: string;
  value: string;
  label: string;
};

export type Options = string[] | OptionData[];

export type DropdownSelectProps = MultiValueProps<
  OptionData,
  true
>['selectProps'] & {
  collapsedCount: number;
  containerRef: React.RefObject<HTMLElement | null>;
  collapseSelected: boolean;
  isMeasuring: boolean;
  rowHeight: number | null;
  visibleCount: number;
};
