import type React from 'react';
import type {
  GroupBase,
  MultiValueProps,
  Props as SelectProps
} from 'react-select';
import type { CreatableProps } from 'react-select/creatable';

export type OptionData = {
  tooltip?: string;
  value: string;
  label: string;
};

export type Options = string[] | OptionData[];

export type DropdownSelectExtraProps = {
  collapsedCount: number;
  containerRef: React.RefObject<HTMLElement | null>;
  collapseSelected: boolean;
  isMeasuring: boolean;
  visibleCount: number;
  inputHidden?: boolean;
  onCollapsedChipPress?: (event: React.SyntheticEvent) => void;
  onControlPress?: (
    event: React.SyntheticEvent,
    info: { isTouch: boolean }
  ) => boolean;
  onMultiValueRemovePointer?: () => void;
};

export type DropdownSelectProps = MultiValueProps<
  OptionData,
  true
>['selectProps'] &
  DropdownSelectExtraProps;

export type DropdownSelectComponentProps = SelectProps<
  OptionData,
  true,
  GroupBase<OptionData>
> &
  DropdownSelectExtraProps;

export type DropdownCreatableSelectComponentProps = CreatableProps<
  OptionData,
  true,
  GroupBase<OptionData>
> &
  DropdownSelectExtraProps;
