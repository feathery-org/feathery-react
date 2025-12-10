const colors = {
  white: '#ffffff',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray600: '#4b5563',
  gray700: '#374151',
  gray900: '#111827',
  blue50: '#eff6ff',
  blue700: '#1d4ed8'
};

export const searchIconStyle = {
  width: '16px',
  height: '16px',
  color: '#6b7280'
};

export const sortIconContainerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '2px',
  '& svg': {
    marginInlineStart: '4px',
    width: '20px',
    height: '20px'
  }
};

export const sortArrowStyle = {
  width: '12px',
  height: '12px',
  color: colors.gray400,
  opacity: 0.3,
  '&[data-active="true"]': {
    color: colors.blue700,
    opacity: 1
  }
};

export const sortHeaderContentStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
};

export const containerStyle = {
  position: 'relative',
  overflowX: 'auto',
  overflowY: 'auto',
  backgroundColor: colors.white,
  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  borderRadius: '8px',
  border: `1px solid ${colors.gray200}`,
  minWidth: '100%',
  maxWidth: '100%',
  height: '100%',
  boxSizing: 'border-box'
};

export const emptyStateContainerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '64px 24px',
  textAlign: 'center' as const
};

export const emptyStateTextStyle = {
  color: colors.gray600,
  fontSize: '16px',
  fontWeight: '500',
  margin: 0
};

export const searchContainerStyle = {
  padding: '16px',
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
  paddingLeft: '12px',
  pointerEvents: 'none'
};

export const searchInputStyle = {
  display: 'block',
  width: '100%',
  maxWidth: '384px',
  paddingLeft: '36px',
  paddingRight: '12px',
  paddingTop: '10px',
  paddingBottom: '10px',
  backgroundColor: colors.gray50,
  border: `1px solid ${colors.gray200}`,
  color: colors.gray900,
  fontSize: '14px',
  borderRadius: '8px',
  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
};

export const tableStyle = {
  width: '100%',
  maxWidth: '100%',
  fontSize: '14px',
  textAlign: 'left',
  color: colors.gray600,
  textIndent: 0,
  borderColor: 'inherit',
  borderCollapse: 'collapse',
  tableLayout: 'fixed'
};

export const theadStyle = {
  fontSize: '14px',
  color: colors.gray600,
  backgroundColor: colors.gray50,
  borderBottom: `1px solid ${colors.gray200}`
};

export const thStyle = {
  padding: '12px 24px',
  fontWeight: '500',
  userSelect: 'none'
};

export const rowStyle = {
  backgroundColor: colors.white,
  borderBottom: `1px solid ${colors.gray200}`,
  transition: 'background-color 0.2s'
};

export const cellStyle = {
  padding: '16px 24px',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere'
};

export const navStyle = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  padding: '16px',
  gap: '8px'
};

export const navTextStyle = {
  fontSize: '14px',
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
  fontSize: '14px',
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
  boxSizing: 'border-box' as const,
  border: `1px solid ${colors.gray200}`,
  fontWeight: '500',
  fontSize: '14px',
  textDecoration: 'none',
  cursor: 'pointer',
  height: '36px',
  wordBreak: 'keep-all',
  overflowWrap: 'normal',
  '&:hover': {
    backgroundColor: colors.gray100,
    color: colors.gray900
  }
};

export const actionButtonStyle = {
  ...buttonStyle,
  borderRadius: '4px',
  paddingInline: '8px',
  width: 'auto',
  height: '28px'
};

export const menuIconStyle = {
  width: '16px',
  height: '16px',
  color: colors.gray600
};

export const actionMenuStyle = {
  position: 'fixed' as const,
  backgroundColor: colors.white,
  border: `1px solid ${colors.gray300}`,
  borderRadius: '4px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  zIndex: 9999,
  minWidth: '120px'
};

export const actionMenuItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left' as const,
  paddingLeft: '12px',
  paddingRight: '12px',
  paddingTop: '8px',
  paddingBottom: '8px',
  fontSize: '14px',
  color: colors.gray700,
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  '&:hover': {
    backgroundColor: colors.gray100
  },
  '&:first-of-type': {
    borderTopLeftRadius: '4px',
    borderTopRightRadius: '4px'
  },
  '&:last-of-type': {
    borderBottomLeftRadius: '4px',
    borderBottomRightRadius: '4px'
  }
};

export const actionIconButtonStyle = {
  ...actionButtonStyle,
  aspectRatio: 1,
  paddingLeft: 0,
  paddingRight: 0
};

export const actionContainerStyle = {
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end'
};

export const pageButtonStyle = {
  ...buttonStyle,
  width: '36px',
  borderRightWidth: 0
};

export const pageButtonPrevStyle = {
  ...pageButtonStyle,
  borderTopLeftRadius: '8px',
  borderBottomLeftRadius: '8px',
  paddingLeft: '12px',
  paddingRight: '12px',
  width: 'auto'
};

export const pageButtonNextStyle = {
  ...pageButtonStyle,
  borderTopRightRadius: '8px',
  borderBottomRightRadius: '8px',
  paddingLeft: '12px',
  paddingRight: '12px',
  width: 'auto',
  borderRightWidth: 1
};

export const pageButtonActiveStyle = {
  ...pageButtonStyle,
  color: colors.blue700,
  backgroundColor: colors.blue50,
  border: `1px solid ${colors.gray200}`
};

export const pageButtonEllipsisStyle = {
  ...pageButtonStyle,
  cursor: 'default',
  '&:focus': {
    outline: 'none'
  }
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
