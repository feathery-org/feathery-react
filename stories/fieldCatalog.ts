// Every servar type a story can render, with enough metadata for its
// component to draw something representative. Types that share a component
// (gmap_state through DropdownField, say) each get their own entry, since
// their metadata and behavior differ.

type Styles = Record<string, any>;

export interface FieldSpec {
  label: string;
  placeholder?: string;
  metadata?: Styles;
  /** servar.max_length: the PIN's length, the rating's scale... */
  maxLength?: number;
  properties?: Styles;
  /** What the form would hold before the user touches it */
  value?: any;
  /** Width of the story's column, for fields that need more room */
  width?: number;
}

const PLANS = ['Starter', 'Growth', 'Enterprise'];

// A custom field's component, compiled in its iframe. Kept to plain DOM so it
// needs no imports beyond React.
const CUSTOM_COUNTER = `
export default function Counter({ value, onChange, fieldProperties }) {
  const count = Number(value) || 0;
  const button = {
    width: 36, height: 36, borderRadius: 6, border: '1px solid #D1D5DB',
    background: '#FFFFFF', fontSize: 18, cursor: 'pointer'
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12,
      font: '15px system-ui', padding: 4 }}>
      <button style={button} onClick={() => onChange(count - 1)}>-</button>
      <span style={{ minWidth: 24, textAlign: 'center' }}>{count}</span>
      <button style={button} onClick={() => onChange(count + 1)}>+</button>
      <span style={{ color: '#6B7280' }}>{fieldProperties.description}</span>
    </div>
  );
}
`;

export const FIELD_SPECS: Record<string, FieldSpec> = {
  text_field: { label: 'Full name', placeholder: 'Jane Doe' },
  email: { label: 'Email address', placeholder: 'you@example.com' },
  integer_field: { label: 'Household size', placeholder: '0' },
  url: { label: 'Website', placeholder: 'https://example.com' },
  ssn: { label: 'Social security number', placeholder: '000-00-0000' },
  gmap_zip: { label: 'ZIP code', placeholder: '94103' },
  text_area: {
    label: 'Anything else we should know?',
    placeholder: 'Tell us a little more'
  },
  password: { label: 'Password', placeholder: 'At least 8 characters' },
  phone_number: {
    label: 'Phone number',
    placeholder: '(555) 555-5555',
    metadata: { default_country: 'US' }
  },
  dropdown: {
    label: 'Plan',
    placeholder: 'Choose a plan',
    metadata: { options: PLANS, option_labels: [], option_tooltips: [] }
  },
  dropdown_multi: {
    label: 'Integrations',
    placeholder: 'Select all that apply',
    metadata: {
      options: ['Salesforce', 'HubSpot', 'Slack', 'Zapier'],
      option_labels: [],
      option_tooltips: [],
      creatable_options: false
    },
    value: ['Slack']
  },
  gmap_line_1: { label: 'Street address', placeholder: '123 Main St' },
  gmap_city: { label: 'City', placeholder: 'San Francisco' },
  gmap_state: {
    label: 'State',
    placeholder: 'Select a state',
    metadata: { default_country: 'US', store_abbreviation: true }
  },
  gmap_country: { label: 'Country', placeholder: 'Select a country' },
  date_selector: { label: 'Start date', placeholder: 'MM/DD/YYYY' },
  select: {
    label: 'How did you hear about us?',
    metadata: {
      options: ['Search engine', 'A friend', 'Social media'],
      option_labels: [],
      option_tooltips: [],
      other: true,
      other_label: 'Other'
    },
    value: 'A friend'
  },
  multiselect: {
    label: 'Which features do you need?',
    metadata: {
      options: ['Logic', 'Integrations', 'Analytics'],
      option_labels: [],
      option_tooltips: [],
      select_all: true,
      select_all_label: 'Select all'
    },
    value: ['Logic']
  },
  checkbox: { label: 'I agree to the terms and conditions', value: true },
  button_group: {
    label: 'Choose a plan',
    metadata: {
      options: PLANS,
      option_labels: [],
      option_images: [],
      option_tooltips: [],
      multiple: false
    },
    value: ['Growth'],
    width: 440
  },
  matrix: {
    label: 'Rate each part of the product',
    metadata: {
      questions: [
        { id: 'q-ease', label: 'Ease of use' },
        { id: 'q-speed', label: 'Speed' },
        { id: 'q-support', label: 'Support' }
      ],
      options: ['Poor', 'Fair', 'Good'],
      multiple: false
    },
    value: { 'q-ease': ['Good'] },
    width: 480
  },
  slider: {
    label: 'Team size',
    metadata: {
      min_value: 0,
      max_value: 100,
      step_size: 5,
      min_val_label: '0',
      max_val_label: '100+'
    },
    value: 25
  },
  rating: { label: 'How was your experience?', maxLength: 5, value: 4 },
  pin_input: { label: 'Verification code', maxLength: 6 },
  hex_color: { label: 'Brand color', value: '4F46E5' },
  signature: { label: 'Signature', metadata: {} },
  file_upload: {
    label: 'Upload your resume',
    metadata: { multiple: false, file_types: [] }
  },
  audio_recording: {
    label: 'Record a voice note',
    metadata: { max_duration: 60 }
  },
  qr_scanner: { label: 'Scan your ticket', metadata: {} },
  custom: {
    label: 'Seats',
    metadata: { code: CUSTOM_COUNTER, custom: {} },
    value: 2
  },
  payment_method: { label: 'Card details' }
};
