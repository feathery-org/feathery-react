import React from 'react';

const LoaderContainer = ({
  backgroundColor = 'FFF',
  showLoader,
  children
}: {
  backgroundColor?: string;
  showLoader: boolean;
  children: JSX.Element;
}) => {
  if (!showLoader) return <></>;

  return (
    <div
      style={{
        backgroundColor: `#${backgroundColor}`,
        position: 'fixed',
        height: '100vh',
        width: '100vw',
        zIndex: 50,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      {children}
    </div>
  );
};

export default LoaderContainer;
