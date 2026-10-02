import React from 'react';
import type { Meta } from '@storybook/react-webpack5';
import { FIELD_SPECS } from './fieldCatalog';
import { specFieldElement } from './fixtures';
import { StoryField } from './StoryField';
import { fieldStyling } from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement
} from './theme/storyHelpers';

export type FieldArgs = EditModeArgs & {
  fieldType: string;
  label: string;
  required: boolean;
  disabled: boolean;
  width: number;
};

/**
 * Everything but the title of a field's stories. `types` are the servar types
 * the story can switch between; the first is the default.
 */
export function fieldMeta(types: string[]): Omit<Meta<FieldArgs>, 'title'> {
  const [type] = types;
  const spec = FIELD_SPECS[type];
  return {
    args: {
      fieldType: type,
      label: spec.label,
      required: false,
      disabled: false,
      width: spec.width ?? 360
    },
    argTypes: {
      ...editModeArgType,
      fieldType:
        types.length > 1
          ? { control: 'select', options: types }
          : { table: { disable: true } },
      width: { control: { type: 'range', min: 160, max: 720, step: 10 } }
    },
    render: (
      { fieldType, label, required, disabled, width, editMode },
      context
    ) => {
      const styling = styleElement(context, fieldStyling(fieldType));
      styling.styles.mark_required_asterisk = required;
      const element = specFieldElement(fieldType, { label, required }, styling);
      return (
        <div style={{ width }}>
          <StoryField
            // A new type is a different field, with its own value
            key={fieldType}
            element={element}
            value={FIELD_SPECS[fieldType].value}
            disabled={disabled}
            editMode={editMode}
          />
        </div>
      );
    }
  };
}
