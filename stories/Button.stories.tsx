import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';
import Elements from './FormFrame';
import { buttonElement } from './fixtures';
import { buttonStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement
} from './theme/storyHelpers';

type Args = EditModeArgs & {
  label: string;
  width: number;
  disabled: boolean;
  onClick: () => void;
};

const meta: Meta<Args> = {
  title: 'Elements/Button',
  args: {
    label: 'Continue',
    width: 240,
    disabled: false,
    onClick: fn()
  },
  argTypes: {
    ...editModeArgType,
    width: { control: { type: 'range', min: 80, max: 600, step: 10 } }
  },
  render: ({ label, width, disabled, onClick, editMode }, context) => {
    const element = buttonElement(label, styleElement(context, buttonStyling));
    return (
      <div style={{ width }}>
        <Elements.ButtonElement
          element={element}
          disabled={disabled}
          editMode={editMode}
          onClick={onClick}
        />
      </div>
    );
  }
};

export default meta;
type Story = StoryObj<Args>;

export const Primary: Story = {};
