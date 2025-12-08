const colors = {
  white: '#ffffff',
  gray50: 'oklch(98.5% .002 247.839)',
  gray100: 'oklch(96.7% .003 264.542)',
  gray200: 'oklch(92.8% .006 264.531)',
  gray300: 'oklch(87.2% .01 258.338)',
  gray400: 'oklch(70.7% .022 261.325)',
  gray500: 'oklch(55.1% .027 264.364)',
  gray600: 'oklch(44.6% .03 256.802)',
  gray700: 'oklch(37.3% .034 259.733)',
  gray800: 'oklch(27.8% .033 256.848)',
  gray900: 'oklch(21% .034 264.665)',
  gray950: 'oklch(13% .028 261.692)',
  blue50: 'oklch(97% .014 254.604)',
  blue700: 'oklch(48.8% .243 264.376)'
};

export const containerStyle = {
  position: 'relative',
  overflowX: 'auto',
  overflowY: 'auto',
  backgroundColor: colors.white,
  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  borderRadius: '0.5rem',
  border: `1px solid ${colors.gray200}`,
  minWidth: '100%',
  maxWidth: '100%',
  height: '100%',
  boxSizing: 'border-box'
};

export const searchContainerStyle = {
  padding: '1rem',
  borderBottom: `1px solid ${colors.gray200}`
};

export const searchWrapperStyle = {
  position: 'relative'
};

export const searchIconWrapperStyle = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  display: 'flex',
  alignItems: 'center',
  paddingLeft: '0.75rem',
  pointerEvents: 'none'
};

export const searchInputStyle = {
  display: 'block',
  width: '100%',
  maxWidth: '24rem',
  paddingLeft: '2.25rem',
  paddingRight: '0.75rem',
  paddingTop: '0.625rem',
  paddingBottom: '0.625rem',
  backgroundColor: colors.gray50,
  border: `1px solid ${colors.gray200}`,
  color: colors.gray900,
  fontSize: '0.875rem',
  borderRadius: '0.5rem',
  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
};

export const tableStyle = {
  width: '100%',
  maxWidth: '100%',
  fontSize: '0.875rem',
  textAlign: 'left',
  color: colors.gray600,
  textIndent: 0,
  borderColor: 'inherit',
  borderCollapse: 'collapse',
  tableLayout: 'fixed'
};

export const theadStyle = {
  fontSize: '0.875rem',
  color: colors.gray600,
  backgroundColor: colors.gray50,
  borderBottom: `1px solid ${colors.gray200}`
};

export const thStyle = {
  padding: '0.75rem 1.5rem',
  fontWeight: '500'
};

export const rowStyle = {
  backgroundColor: colors.white,
  borderBottom: `1px solid ${colors.gray200}`,
  transition: 'background-color 0.2s'
};

export const cellStyle = {
  padding: '1rem 1.5rem'
};

export const navStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  padding: '1rem'
};

export const navTextStyle = {
  fontSize: '0.875rem',
  fontWeight: 'normal',
  color: colors.gray600
};

export const navTextBoldStyle = {
  fontWeight: '600',
  color: colors.gray900
};

export const paginationListStyle = {
  display: 'flex',
  marginLeft: '-1px',
  fontSize: '0.875rem',
  listStyle: 'none',
  padding: 0,
  margin: 0
};

export const buttonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: colors.gray600,
  backgroundColor: colors.gray50,
  boxSizing: 'border-box',
  border: `1px solid ${colors.gray200}`,
  fontWeight: '500',
  fontSize: '0.875rem',
  textDecoration: 'none',
  cursor: 'pointer',
  height: '2.25rem',
  '&:hover': {
    backgroundColor: colors.gray100,
    color: colors.gray900
  }
};

export const actionButtonStyle = {
  ...buttonStyle,
  borderRadius: '0.25rem',
  paddingInline: '0.5rem',
  width: 'auto',
  height: '1.75rem'
};

export const pageButtonStyle = {
  ...buttonStyle,
  width: '2.25rem',
  borderRightWidth: 0
};

export const pageButtonPrevStyle = {
  ...pageButtonStyle,
  borderTopLeftRadius: '0.5rem',
  borderBottomLeftRadius: '0.5rem',
  paddingLeft: '0.75rem',
  paddingRight: '0.75rem',
  width: 'auto'
};

export const pageButtonNextStyle = {
  ...pageButtonStyle,
  borderTopRightRadius: '0.5rem',
  borderBottomRightRadius: '0.5rem',
  paddingLeft: '0.75rem',
  paddingRight: '0.75rem',
  width: 'auto',
  borderRightWidth: 1
};

export const pageButtonActiveStyle = {
  ...pageButtonStyle,
  color: colors.blue700,
  backgroundColor: colors.blue50,
  border: `1px solid ${colors.gray200}`
};

export const pageButtonDisabledStyle = {
  opacity: 0.8,
  cursor: 'default',
  color: colors.gray400,
  '&:hover': {
    backgroundColor: colors.gray50,
    color: colors.gray400
  }
};
