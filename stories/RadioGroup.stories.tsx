import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { FieldArgs, fieldMeta } from './fieldStory';

const meta: Meta<FieldArgs> = {
  title: 'Fields/Radio Group',
  ...fieldMeta(['select'])
};

export default meta;
type Story = StoryObj<FieldArgs>;

export const Default: Story = {};
