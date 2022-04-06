import React, { useRef } from 'react';
import { useFileData, useThumbnailData } from '../../utils/image';

import { FiX } from 'react-icons/fi';
import { IconContext } from 'react-icons';
import { Image } from 'react-bootstrap';

function RichFileUploadField(
  {
    element,
    applyStyles,
    required = false,
    onChange: customOnChange = () => {},
    onClick: customOnClick = () => {},
    initialFile = null,
    elementProps = {},
    children
  },
  parentRef
) {
  const servar = element.servar;
  const showIcon = element.properties.icon !== '';
  const showLabel = servar.name !== '';
  const fileInput = useRef();

  const [files, setFiles] = useFileData(initialFile, () => {
    if (fileInput.current) fileInput.current.value = '';
  });
  const { thumbnail, filename } = useThumbnailData(files)[0] ?? {};
  const fileExists = thumbnail || filename;

  function onClick(event) {
    fileInput.current.click();
    customOnClick(event);
  }

  function onChange(event) {
    const file = event.target.files[0];
    const filePromise = Promise.resolve(file);
    setFiles([filePromise]);

    customOnChange(file ? [filePromise] : []);
  }

  function onClear() {
    fileInput.current.value = '';
    setFiles([null]);
    customOnChange([]);
  }

  applyStyles.apply(
    'fc',
    [
      'uploader_padding_top',
      'uploader_padding_right',
      'uploader_padding_bottom',
      'uploader_padding_left'
    ],
    (a, b, c, d) => ({
      padding: fileExists ? '0' : `${a}px ${b}px ${c}px ${d}px`
    })
  );

  return (
    <div
      id={servar.key}
      onClick={onClick}
      css={{
        position: 'relative',
        cursor: 'pointer',
        maxHeight: '100%',
        display: 'flex',
        justifyContent:
          !fileExists && showLabel && showIcon ? 'space-between' : 'center',
        alignItems: 'center',
        flexDirection: 'column',
        border: '1px solid lightgrey',
        borderRadius: '4px',
        boxSizing: 'border-box',
        background: 'white',
        overflow: 'hidden',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {showIcon && !fileExists && (
        <Image
          src={element.properties.icon}
          fluid
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            minHeight: 0
          }}
        />
      )}
      {showLabel && !fileExists && (
        <div css={applyStyles.getTarget('field')}>{servar.name}</div>
      )}
      {thumbnail && (
        <Image
          src={thumbnail}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain'
          }}
        />
      )}
      {filename && (
        <div
          style={{
            color: 'black',
            height: '100%',
            width: '100%',
            wordBreak: 'break-all',
            fontSize: 'small',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center'
          }}
        >
          {filename}
        </div>
      )}
      {fileExists && servar.repeat_trigger !== 'set_value' && (
        <div
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            color: 'white',
            background: '#AAA',
            height: '16px',
            width: '16px',
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
          onClick={onClear}
        >
          <IconContext.Provider value={{ className: 'clear' }}>
            <FiX size='12px' />
          </IconContext.Provider>
        </div>
      )}
      {/* Input component must be hidden, and it also remains empty since we track files in state here */}
      {/* Since the input is always empty, we have to check for existing data and ignore the required attribute */}
      <input
        ref={(ref) => {
          fileInput.current = ref;
          parentRef(ref);
        }}
        type='file'
        onChange={onChange}
        required={required && !fileExists}
        accept={servar.metadata.file_types}
        style={{
          position: 'absolute',
          height: 1,
          width: 1,
          bottom: 0,
          opacity: 0
        }}
      />
      {children}
    </div>
  );
}

export default React.forwardRef(RichFileUploadField);
