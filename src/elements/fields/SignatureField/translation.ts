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
  confirm_all: 'Sign All',
  cancel: 'Cancel',
  back: 'Back',
  clear: 'Clear',
  initials_label: 'Initial here',
  initials_title: 'Add your initials',
  initials_type_option: 'Type your initials',
  initials_type_placeholder: 'Your initials',
  initials_type_example: 'A.B.',
  initials_type_loading: 'Generating initials',
  initials_draw_option: 'Draw your initials',
  initials_draw_subtitle:
    'Draw your initials here using your mouse or trackpad',
  initials_draw_instructions: 'Draw your initials in the box below',
  initials_confirm: 'Initial',
  initials_confirm_all: 'Initial All'
} as const;

export type SignatureTranslations = typeof defaultTranslations;
