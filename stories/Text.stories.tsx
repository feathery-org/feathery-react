import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from './FormFrame';
import { textElement } from './fixtures';
import { TEXT_VARIANTS, textStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement
} from './theme/storyHelpers';

type Args = EditModeArgs & {
  text: string;
  variant: keyof typeof TEXT_VARIANTS;
};

const meta: Meta<Args> = {
  title: 'Elements/Text',
  args: {
    text: 'Tell us a little about yourself',
    variant: 'heading'
  },
  argTypes: {
    ...editModeArgType,
    variant: { control: 'inline-radio', options: Object.keys(TEXT_VARIANTS) }
  },
  render: ({ text, variant, editMode }, context) => {
    const styling = styleElement(context, textStyling(variant));
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
