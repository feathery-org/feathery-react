import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';
import Elements from '../src/elements';
import { buttonElement } from './fixtures';
import { buttonStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement,
  themeArgTypes,
  ThemedArgs
} from './theme/storyHelpers';

type Args = ThemedArgs &
  EditModeArgs & {
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
    ...themeArgTypes,
    width: { control: { type: 'range', min: 80, max: 600, step: 10 } }
  },
  render: ({ label, width, disabled, onClick, editMode, ...args }, context) => {
    const element = buttonElement(
      label,
      styleElement(args, context, buttonStyling)
    );
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

export const Disabled: Story = { args: { disabled: true } };

/** As the form builder canvas renders it: the label is editable in place */
export const Editable: Story = { args: { editMode: 'editable' } };

export const Pill: Story = {
  args: { borderRadius: 999, label: 'Get started' }
};

export const WithShadow: Story = {
  args: {
    rawStyles: {
      shadow_x_offset: 0,
      shadow_y_offset: 6,
      shadow_blur_radius: 16,
      shadow_color: '4F46E555'
    }
  }
};
