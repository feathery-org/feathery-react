import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { FieldArgs, fieldMeta } from './fieldStory';

const meta: Meta<FieldArgs> = {
  title: 'Fields/Address',
  ...fieldMeta([
    'gmap_line_1',
    'gmap_city',
    'gmap_state',
    'gmap_country',
    'gmap_zip'
  ])
};

export default meta;
type Story = StoryObj<FieldArgs>;

export const Default: Story = {};
