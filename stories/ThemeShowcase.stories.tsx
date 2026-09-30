import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from '../src/elements';
import {
  buttonElement,
  fieldElement,
  progressBarElement,
  textElement
} from './fixtures';
import { StatefulCheckbox, StatefulTextField } from './StatefulFields';
import { StoryTable, tableElement } from './StoryTable';
import {
  buttonStyling,
  checkboxStyling,
  progressBarStyling,
  textFieldStyling,
  textStyling
} from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement,
  themeArgTypes,
  ThemedArgs
} from './theme/storyHelpers';

// Every element on one step, so a preset or token change can be judged as a
// whole. Raw styles are per element type, so they're left to the single stories.
const { ...tokenArgTypes } = themeArgTypes;

type Args = ThemedArgs & EditModeArgs;

const meta: Meta<Args> = {
  title: 'Theming/Showcase',
  argTypes: { ...editModeArgType, ...tokenArgTypes },
  render: ({ editMode, ...args }, context) => {
    const style = (options: Parameters<typeof styleElement>[2]) =>
      styleElement(args, context, options);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        <div
          style={{
            width: 380,
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }}
        >
          <Elements.ProgressBarElement
            element={progressBarElement(50, style(progressBarStyling))}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Elements.TextElement
              element={textElement(
                'Create your account',
                style({
                  ...textStyling('heading'),
                  text: { scale: 1.8, weight: 700 }
                }),
                'story-heading'
              )}
              editMode={editMode}
            />
            <Elements.TextElement
              element={textElement(
                'It only takes a minute. You can change these details later.',
                style({ ...textStyling('body'), text: { scale: 0.95 } }),
                'story-body'
              )}
              editMode={editMode}
            />
          </div>
          <StatefulTextField
            element={fieldElement(
              'text_field',
              {
                key: 'showcase_name',
                label: 'Full name',
                placeholder: 'Jane Doe'
              },
              style(textFieldStyling('text_field'))
            )}
            editMode={editMode}
          />
          <StatefulTextField
            element={fieldElement(
              'email',
              {
                key: 'showcase_email',
                label: 'Work email',
                placeholder: 'jane@company.com'
              },
              style(textFieldStyling('email'))
            )}
            editMode={editMode}
          />
          <StatefulCheckbox
            element={fieldElement(
              'checkbox',
              { key: 'showcase_terms', label: 'Send me product updates' },
              style(checkboxStyling)
            )}
            checked
          />
          <div style={{ width: '100%' }}>
            <Elements.ButtonElement
              element={buttonElement('Continue', style(buttonStyling))}
              editMode={editMode}
            />
          </div>
        </div>
        {/* Wider than the form column: three columns need the room. The
            table's look is built in, so theme tokens don't restyle it. */}
        <div style={{ maxWidth: 640 }}>
          <StoryTable element={tableElement()} editMode={editMode} />
        </div>
      </div>
    );
  }
};

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {};

/** As the form builder canvas renders every element */
export const Editable: Story = { args: { editMode: 'editable' } };
