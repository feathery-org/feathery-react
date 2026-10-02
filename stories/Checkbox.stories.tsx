import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fieldElement } from './fixtures';
import { StoryField } from './StoryField';
import { checkboxStyling } from './theme/elementStyling';
import { styleElement } from './theme/storyHelpers';

type Args = {
  label: string;
  checked: boolean;
  disabled: boolean;
};

const meta: Meta<Args> = {
  title: 'Fields/Checkbox',
  args: {
    label: 'I agree to the terms and conditions',
    checked: true,
    disabled: false
  },
  render: ({ label, checked, disabled }, context) => {
    const element = fieldElement(
      'checkbox',
      { key: 'story_checkbox', label },
      styleElement(context, checkboxStyling)
    );
    return (
      <StoryField
        element={element}
        value={checked}
        disabled={disabled}
      />
    );
  }
};

export default meta;
type Story = StoryObj<Args>;

export const Checked: Story = {};

export const Unchecked: Story = { args: { checked: false } };

export const Disabled: Story = { args: { disabled: true } };
