import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from './FormFrame';
import { progressBarElement } from './fixtures';
import { progressBarStyling } from './theme/elementStyling';
import { styleElement } from './theme/storyHelpers';

type Args = {
  progress: number;
  segments: number;
};

const meta: Meta<Args> = {
  title: 'Elements/Progress Bar',
  args: { progress: 40, segments: 0 },
  argTypes: {
    progress: { control: { type: 'range', min: 0, max: 100 } },
    segments: {
      description: '0 renders a continuous bar',
      control: { type: 'range', min: 0, max: 8 }
    }
  },
  render: ({ progress, segments }, context) => {
    const styling = styleElement(context, progressBarStyling);
    return (
      <div style={{ width: 420 }}>
        <Elements.ProgressBarElement
          element={progressBarElement(progress, styling)}
          progress={segments ? { progress, segments } : progress}
        />
      </div>
    );
  }
};

export default meta;
type Story = StoryObj<Args>;

export const Continuous: Story = {};

export const Segmented: Story = { args: { progress: 50, segments: 4 } };
