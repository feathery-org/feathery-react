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
  isMoreIndicator?: boolean;
};

export type Options = string[] | OptionData[];

export type PrimitiveOption = string | number | boolean;

export type RawOption =
  | PrimitiveOption
  | null
  | undefined
  | Partial<OptionData>;

export type DropdownOptionsInput = Array<RawOption>;

export type NormalizeDropdownOptionParams = {
  warningState: Set<string>;
  option: RawOption;
  fieldKey: string;
  context: string;
  entityLabel: string;
};

export type BuildDropdownOptionsParams = {
  warningState: Set<string>;
  fieldKey: string;
  contextPrefix: string;
  labelOverrides?: unknown[];
  tooltipOverrides?: unknown[];
  labelMap: Record<string, string>;
  tooltipMap: Record<string, string | undefined>;
  entityLabel: string;
};

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

export type CreatableValidator = (
  inputValue: string,
  value: readonly OptionData[],
  options: readonly (OptionData | GroupBase<OptionData>)[],
  accessors: {
    getOptionValue(option: OptionData): string;
    getOptionLabel(option: OptionData): string;
  }
) => boolean;
