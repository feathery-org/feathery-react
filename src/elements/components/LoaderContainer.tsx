import React from 'react';

const LoaderContainer = ({
  isStepLoaderForButton,
  backgroundColor = '#FFF',
  showLoader,
  height,
  width,
  children
}: {
  isStepLoaderForButton: boolean;
  backgroundColor: string | undefined;
  showLoader: boolean;
  height: string;
  width: string;
  children: JSX.Element;
}) => {
  if (!showLoader) return <></>;

  const styles: Record<string, string | number> = {
    backgroundColor,
    padding: '30px 0',
    height,
    width,
    zIndex: 50,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  };
  // If this is a full_page button loader, then we need the styles so the loader
  // goes over the step. But the styles mess up the auth loader before the form
  // has loaded, so only add them when needed
  if (isStepLoaderForButton) {
    styles.position = 'absolute';
    styles.top = 0;
    styles.left = 0;
  }

  return <div style={styles}>{children}</div>;
};

export default LoaderContainer;
