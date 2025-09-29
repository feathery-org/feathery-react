const hasDropdownMultiCompact = (node: any): boolean => {
  if (!node) return false;

  if (
    node?.servar?.type === 'dropdown_multi' &&
    node?.styles?.compact_options === true
  ) {
    return true;
  }

  if (Array.isArray(node?.children)) {
    for (const child of node.children) {
      if (hasDropdownMultiCompact(child)) {
        return true;
      }
    }
  }

  return false;
};

export const useCompactOptionMultiDropdown = (node: any) => {
  const multiDropdownStyles = {
    ...(hasDropdownMultiCompact(node) && {
      minWidth: 0,
      '@media (max-width: 478px)': {
        flexShrink: 1,
        minWidth: 0
      }
    })
  };

  return { multiDropdownStyles };
};
