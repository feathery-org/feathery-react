import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { fn } from 'storybook/test';
import Elements from './FormFrame';
import { TAB_ENTRIES, tabsElement } from './fixtures';
import { tabsStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement
} from './theme/storyHelpers';

type Args = EditModeArgs & {
  direction: 'horizontal' | 'vertical';
  width: number;
  onTabClick: (entry: any, index: number) => void;
};

// A tab is active when its step is the current one. Clicking navigates there
// in a form; here it just moves the active tab.
function StoryTabs({ element, editMode, onTabClick }: any) {
  const [stepKey, setStepKey] = useState(TAB_ENTRIES[0].step_key);
  return (
    <Elements.TabsElement
      element={element}
      editMode={editMode}
      stepKey={stepKey}
      onTabClick={(entry: any, index: number) => {
        setStepKey(entry.step_key);
        onTabClick(entry, index);
      }}
    />
  );
}

const meta: Meta<Args> = {
  title: 'Elements/Tabs',
  args: { direction: 'horizontal', width: 420, onTabClick: fn() },
  argTypes: {
    ...editModeArgType,
    direction: {
      control: 'inline-radio',
      options: ['horizontal', 'vertical']
    },
    width: { control: { type: 'range', min: 160, max: 720, step: 10 } }
  },
  render: ({ direction, width, editMode, onTabClick }, context) => (
    <div style={{ width }}>
      <StoryTabs
        element={tabsElement(styleElement(context, tabsStyling), direction)}
        editMode={editMode}
        onTabClick={onTabClick}
      />
    </div>
  )
};

export default meta;
type Story = StoryObj<Args>;

export const Horizontal: Story = {};
