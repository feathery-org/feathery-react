import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { FieldArgs, fieldMeta } from './fieldStory';

const meta: Meta<FieldArgs> = {
  title: 'Fields/PIN Input',
  ...fieldMeta(['pin_input'])
};

export default meta;
type Story = StoryObj<FieldArgs>;

export const Default: Story = {};
