import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { FieldArgs, fieldMeta } from './fieldStory';

const meta: Meta<FieldArgs> = {
  title: 'Fields/Address',
  ...fieldMeta(['gmap_line_1', 'gmap_city', 'gmap_state', 'gmap_country', 'gmap_zip'])
};

export default meta;
type Story = StoryObj<FieldArgs>;

export const Default: Story = {};

export const Required: Story = { args: { required: true } };

export const Disabled: Story = { args: { disabled: true } };

/** As the form builder canvas renders it */
export const Editable: Story = { args: { editMode: 'editable' } };

export const State: Story = { args: { fieldType: 'gmap_state', label: 'State' } };

export const Country: Story = {
  args: { fieldType: 'gmap_country', label: 'Country' }
};
