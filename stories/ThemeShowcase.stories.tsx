import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import Elements from './FormFrame';
import { FIELD_SPECS } from './fieldCatalog';
import {
  buttonElement,
  imageElement,
  progressBarElement,
  specFieldElement,
  TAB_ENTRIES,
  tabsElement,
  textElement,
  videoElement
} from './fixtures';
import { StoryField } from './StoryField';
import { StoryTable, tableElement } from './StoryTable';
import {
  buttonStyling,
  fieldStyling,
  imageStyling,
  progressBarStyling,
  tabsStyling,
  textStyling,
  videoStyling
} from './theme/elementStyling';
import {
  editModeArgType,
  EditModeArgs,
  styleElement
} from './theme/storyHelpers';

// Every element on one page, so a theme can be judged as a whole. The first
// column reads as one step of a form; the sections after it lay out every
// other field type and element side by side.

// Fields that render in the step at the top, so they aren't repeated below
const STEP_FIELDS = ['text_field', 'email', 'checkbox'];

const FIELD_SECTIONS: { title: string; types: string[] }[] = [
  {
    title: 'Text inputs',
    types: [
      'integer_field',
      'url',
      'ssn',
      'password',
      'phone_number',
      'text_area',
      'pin_input',
      'date_selector'
    ]
  },
  {
    title: 'Address',
    types: [
      'gmap_line_1',
      'gmap_city',
      'gmap_state',
      'gmap_country',
      'gmap_zip'
    ]
  },
  {
    title: 'Choices',
    types: [
      'dropdown',
      'dropdown_multi',
      'select',
      'multiselect',
      'button_group',
      'matrix',
      'slider',
      'rating',
      'hex_color'
    ]
  },
  {
    title: 'Uploads, capture and embeds',
    types: [
      'file_upload',
      'signature',
      'audio_recording',
      'qr_scanner',
      'custom',
      'payment_method'
    ]
  }
];

const sectionTitle: React.CSSProperties = {
  font: '600 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#6B7280',
  margin: '0 0 16px'
};

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 style={sectionTitle}>{title}</h2>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '28px 40px',
          alignItems: 'flex-start'
        }}
      >
        {children}
      </div>
    </section>
  );
}

type Args = EditModeArgs;

const meta: Meta<Args> = {
  title: 'Theming/Showcase',
  argTypes: { ...editModeArgType },
  render: ({ editMode }, context) => {
    const style = (options: Parameters<typeof styleElement>[1]) =>
      styleElement(context, options);
    const field = (type: string, key = `showcase_${type}`) => {
      const spec = FIELD_SPECS[type];
      // Payment's card element only loads on the builder canvas
      const mode = type === 'payment_method' ? 'editable' : editMode;
      return (
        <div key={type} style={{ width: spec.width ?? 320 }}>
          <StoryField
            element={specFieldElement(type, { key }, style(fieldStyling(type)))}
            value={spec.value}
            editMode={mode}
          />
        </div>
      );
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
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
          {STEP_FIELDS.map((type) => (
            <StoryField
              key={type}
              element={specFieldElement(
                type,
                { key: `showcase_${type}` },
                style(fieldStyling(type))
              )}
              value={FIELD_SPECS[type].value}
              editMode={editMode}
            />
          ))}
          <div style={{ width: '100%' }}>
            <Elements.ButtonElement
              element={buttonElement('Continue', style(buttonStyling))}
              editMode={editMode}
            />
          </div>
        </div>

        {FIELD_SECTIONS.map(({ title, types }) => (
          <Section key={title} title={title}>
            {types.map((type) => field(type))}
          </Section>
        ))}

        <Section title='Layout and media'>
          <div style={{ width: 420 }}>
            <Elements.TabsElement
              element={tabsElement(style(tabsStyling))}
              stepKey={TAB_ENTRIES[0].step_key}
              editMode={editMode}
            />
          </div>
          <div style={{ width: 320 }}>
            <Elements.ImageElement
              element={imageElement(style(imageStyling))}
              editMode={editMode}
            />
          </div>
          <div style={{ width: 360 }}>
            <Elements.VideoElement
              element={videoElement(style(videoStyling))}
            />
          </div>
        </Section>

        {/* The table's look is built in, so theme tokens don't restyle it */}
        <Section title='Table'>
          <div style={{ width: '100%', maxWidth: 640 }}>
            <StoryTable element={tableElement()} editMode={editMode} />
          </div>
        </Section>
      </div>
    );
  }
};

export default meta;
type Story = StoryObj<Args>;

export const Default: Story = {};

/** As the form builder canvas renders every element */
export const Editable: Story = { args: { editMode: 'editable' } };
