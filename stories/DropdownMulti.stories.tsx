import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { FieldArgs, fieldMeta } from './fieldStory';

const meta: Meta<FieldArgs> = {
  title: 'Fields/Multi-Select Dropdown',
  ...fieldMeta(['dropdown_multi'])
};

export default meta;
type Story = StoryObj<FieldArgs>;

export const Default: Story = {};

export const Required: Story = { args: { required: true } };

export const Disabled: Story = { args: { disabled: true } };

/** As the form builder canvas renders it */
export const Editable: Story = { args: { editMode: 'editable' } };
