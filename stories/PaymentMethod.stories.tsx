import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { FieldArgs, fieldMeta } from './fieldStory';

const meta: Meta<FieldArgs> = {
  title: 'Fields/Payment Method',
  ...fieldMeta(['payment_method'])
};
// Stripe only loads its card element once it has a key, which the builder
// canvas supplies a placeholder for, so the live form renders empty here
meta.args = { ...meta.args, editMode: 'editable' };

export default meta;
type Story = StoryObj<FieldArgs>;

export const Default: Story = {};
