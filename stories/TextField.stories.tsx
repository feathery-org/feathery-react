import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fieldElement } from './fixtures';
import { StoryField } from './StoryField';
import { textFieldStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement
} from './theme/storyHelpers';

type Args = EditModeArgs & {
  label: string;
  placeholder: string;
  fieldType: 'text_field' | 'email' | 'integer_field' | 'ssn';
  required: boolean;
  disabled: boolean;
  width: number;
};

const meta: Meta<Args> = {
  title: 'Fields/Text Field',
  args: {
    label: 'Email address',
    placeholder: 'you@example.com',
    fieldType: 'email',
    required: false,
    disabled: false,
    width: 320
  },
  argTypes: {
    ...editModeArgType,
    fieldType: {
      control: 'select',
      options: ['text_field', 'email', 'integer_field', 'ssn']
    },
    width: { control: { type: 'range', min: 160, max: 640, step: 10 } }
  },
  render: (
    { label, placeholder, fieldType, required, disabled, width, editMode },
    context
  ) => {
    const styling = styleElement(context, textFieldStyling(fieldType));
    styling.styles.mark_required_asterisk = required;
    const element = fieldElement(
      fieldType,
      { key: `story_${fieldType}`, label, placeholder, required },
      styling
    );
    return (
      <div style={{ width }}>
        <StoryField
          element={element}
          disabled={disabled}
          editMode={editMode}
        />
      </div>
    );
  }
};

export default meta;
type Story = StoryObj<Args>;

export const Email: Story = {};

export const Required: Story = {
  args: {
    label: 'Full name',
    placeholder: 'Jane Doe',
    fieldType: 'text_field',
    required: true
  }
};

export const Integer: Story = {
  args: {
    label: 'Household size',
    placeholder: '0',
    fieldType: 'integer_field'
  }
};

export const Disabled: Story = { args: { disabled: true } };

/** As the form builder canvas renders it: the input ignores the pointer */
export const Editable: Story = { args: { editMode: 'editable' } };
