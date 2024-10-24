import React from 'react';
import { CloseIcon } from './icons';
import { MODAL_Z_INDEX } from '../../utils/styles';

type ModalProps = React.PropsWithChildren<{
  css?: any;
  modalCSS?: any;
  onClose?: () => void;
  title?: string;
}>;

function Modal(props: ModalProps) {
  const {
    css = {},
    modalCSS = {},
    onClose = () => {},
    title = '',
    children
  } = props;
  return (
    <div
      css={{
        position: 'fixed',
        display: 'flex',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.2)',
        zIndex: MODAL_Z_INDEX,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
        ...css
      }}
    >
      <div
        onClick={onClose}
        css={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%'
        }}
      />
      <div
        className='feathery-modal'
        css={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '600px',
          ...modalCSS
        }}
      >
        <div
          css={{
            position: 'relative',
            display: 'flex',
            padding: '20px',
            borderBottom: '1px solid #e9e9e9'
          }}
        >
          <h3 css={{ padding: 0, margin: 0, flex: '1' }}>{title}</h3>
          <CloseIcon
            onClick={onClose}
            css={{ '&:hover': { cursor: 'pointer' } }}
          />
        </div>
        <div
          css={{
            position: 'relative',
            padding: '20px 20px 30px 20px',
            '& h3': {
              fontSize: '1em',
              margin: 0,
              padding: 0
            }
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
