import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from '../src/elements';
import { progressBarElement } from './fixtures';
import { progressBarStyling } from './theme/elementStyling';
import { styleElement, themeArgTypes, ThemedArgs } from './theme/storyHelpers';

type Args = ThemedArgs & {
  progress: number;
  segments: number;
  /** Unset keeps the theme's placement */
  textPlacement?: 'top' | 'bottom' | 'none';
};

const meta: Meta<Args> = {
  title: 'Elements/Progress Bar',
  args: { progress: 40, segments: 0 },
  argTypes: {
    ...themeArgTypes,
    progress: { control: { type: 'range', min: 0, max: 100 } },
    segments: {
      description: '0 renders a continuous bar',
      control: { type: 'range', min: 0, max: 8 }
    },
    textPlacement: {
      control: 'inline-radio',
      options: ['top', 'bottom', 'none']
    }
  },
  render: ({ progress, segments, textPlacement, ...args }, context) => {
    const styling = styleElement(args, context, progressBarStyling);
    if (textPlacement) styling.styles.percent_text_layout = textPlacement;
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
