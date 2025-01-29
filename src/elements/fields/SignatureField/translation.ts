export const defaultTranslations = {
  label: 'Sign here',
  title: 'Add your signature',
  type_option: 'Type your signature',
  type_placeholder: 'Your full name',
  type_example: 'Full Name',
  type_loading: 'Generating signature',
  or_label: 'or',
  draw_option: 'Draw your signature',
  draw_subtitle: 'Draw your signature here using your mouse or trackpad',
  draw_instructions: 'Draw your signature in the box below',
  confirm: 'Sign',
  cancel: 'Cancel',
  back: 'Back',
  clear: 'Clear'
} as const;

export type SignatureTranslations = typeof defaultTranslations;
