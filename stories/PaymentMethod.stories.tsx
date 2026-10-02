import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { FieldArgs, fieldMeta } from './fieldStory';

const meta: Meta<FieldArgs> = {
  title: 'Fields/Payment Method',
  ...fieldMeta(['payment_method'])
};

export default meta;
type Story = StoryObj<FieldArgs>;

/** Stripe only loads its card element once it has a key, which the builder
 * canvas supplies a placeholder for, so the live form renders empty here */
export const Editable: Story = { args: { editMode: 'editable' } };

export const Live: Story = {};
