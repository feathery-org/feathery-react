import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from './FormFrame';
import { videoElement } from './fixtures';
import { videoStyling } from './theme/elementStyling';
import { styleElement } from './theme/storyHelpers';

type Args = {
  /** A YouTube or Vimeo link, embedded; blank shows the placeholder */
  sourceUrl: string;
  width: number;
};

const meta: Meta<Args> = {
  title: 'Elements/Video',
  args: { sourceUrl: '', width: 420 },
  argTypes: {
    width: { control: { type: 'range', min: 160, max: 720, step: 10 } }
  },
  render: ({ sourceUrl, width }, context) => (
    <div style={{ width }}>
      <Elements.VideoElement
        element={videoElement(
          styleElement(context, videoStyling),
          sourceUrl || undefined
        )}
      />
    </div>
  )
};

export default meta;
type Story = StoryObj<Args>;

export const Placeholder: Story = {};

export const YouTube: Story = {
  args: { sourceUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }
};
