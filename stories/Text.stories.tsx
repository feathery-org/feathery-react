import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from '../src/elements';
import { textElement } from './fixtures';
import { TEXT_VARIANTS, textStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement,
  themeArgTypes,
  ThemedArgs
} from './theme/storyHelpers';

type Args = ThemedArgs &
  EditModeArgs & {
    text: string;
    variant: keyof typeof TEXT_VARIANTS;
    /** Unset keeps the theme's alignment */
    align?: 'flex-start' | 'center' | 'flex-end';
  };

const meta: Meta<Args> = {
  title: 'Elements/Text',
  args: {
    text: 'Tell us a little about yourself',
    variant: 'heading'
  },
  argTypes: {
    ...editModeArgType,
    ...themeArgTypes,
    variant: { control: 'inline-radio', options: Object.keys(TEXT_VARIANTS) },
    align: {
      control: 'inline-radio',
      options: ['flex-start', 'center', 'flex-end']
    }
  },
  render: ({ text, variant, align, editMode, ...args }, context) => {
    const styling = styleElement(args, context, textStyling(variant));
    if (align) styling.styles.horizontal_align = align;
    return (
      <div style={{ maxWidth: 520 }}>
        <Elements.TextElement
          element={textElement(text, styling)}
          editMode={editMode}
        />
      </div>
    );
  }
};

export default meta;
type Story = StoryObj<Args>;

export const Heading: Story = {};

export const Body: Story = {
  args: {
    variant: 'body',
    text: 'We use this information to tailor the rest of the form to you. It only takes a couple of minutes.'
  }
};

/** As the form builder canvas renders it: the text is editable in place */
export const Editable: Story = { args: { editMode: 'editable' } };

export const Caption: Story = {
  args: { variant: 'caption', text: 'Step 2 of 4' }
};
