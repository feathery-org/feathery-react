import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from './FormFrame';
import { imageElement } from './fixtures';
import { imageStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement
} from './theme/storyHelpers';

type Args = EditModeArgs & {
  /** Blank shows Feathery's placeholder, as an unconfigured image does */
  sourceImage: string;
  width: number;
};

const meta: Meta<Args> = {
  title: 'Elements/Image',
  args: { sourceImage: '', width: 360 },
  argTypes: {
    ...editModeArgType,
    width: { control: { type: 'range', min: 80, max: 720, step: 10 } }
  },
  render: ({ sourceImage, width, editMode }, context) => (
    <div style={{ width }}>
      <Elements.ImageElement
        element={imageElement(
          styleElement(context, imageStyling),
          sourceImage || undefined
        )}
        editMode={editMode}
      />
    </div>
  )
};

export default meta;
type Story = StoryObj<Args>;

export const Placeholder: Story = {};

export const WithSource: Story = {
  args: {
    sourceImage:
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800'
  }
};
