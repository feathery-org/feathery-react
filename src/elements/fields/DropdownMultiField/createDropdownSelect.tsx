import React, { forwardRef } from 'react';
import type { SelectInstance } from 'react-select';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';

import type {
  DropdownCreatableSelectComponentProps,
  DropdownSelectComponentProps,
  OptionData
} from './types';

const DropdownSelect = forwardRef<
  SelectInstance<OptionData, true>,
  DropdownSelectComponentProps
>((props, ref) => <Select<OptionData, true> ref={ref} {...props} />);

DropdownSelect.displayName = 'DropdownSelect';

const DropdownCreatableSelect = forwardRef<
  SelectInstance<OptionData, true>,
  DropdownCreatableSelectComponentProps
>((props, ref) => <CreatableSelect<OptionData, true> ref={ref} {...props} />);

DropdownCreatableSelect.displayName = 'DropdownCreatableSelect';

export { DropdownSelect, DropdownCreatableSelect };
