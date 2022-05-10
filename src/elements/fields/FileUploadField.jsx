import React, { useRef } from 'react';
import { useFileData, useThumbnailData } from '../../utils/image';
import { justRemove } from '../../utils/array';

import { FiX } from 'react-icons/fi';
import { IconContext } from 'react-icons';
import { Image } from 'react-bootstrap';
import { FileUploadIcon } from '../components/icons';

function RichFileUploadField({
  element,
  applyStyles,
  required = false,
  editable = false,
  onChange: customOnChange = () => {},
  onClick: customOnClick = () => {},
  initialFiles = [],
  elementProps = {},
  children
}) {
  const servar = element.servar;
  const showLabel = servar.name !== '';
  const isMultiple = servar.metadata.multiple;
  const fileInput = useRef();

  const [rawFiles, setRawFiles] = useFileData(initialFiles);
  const thumbnailData = useThumbnailData(rawFiles);
  // verify that thumbnail data still has length when there's no thumbnail for a text file
  const allowMoreFiles = isMultiple || thumbnailData.length === 0;
  const fileExists = thumbnailData.length > 0 || rawFiles.length > 0;

  function onClick(event) {
    if (!allowMoreFiles) return;
    fileInput.current.click();
    customOnClick(event);
  }

  // When the user uploads files to the multi-file upload, we just append to the existing set
  // By default the input element would just replace all the uploaded files (we don't want that)
  async function onChange(event) {
    const uploadedFiles = Array.from(event.target.files).map((file) =>
      Promise.resolve(file)
    );
    const newRawFiles = [...rawFiles, ...uploadedFiles];
    setRawFiles(newRawFiles);
    customOnChange(newRawFiles, rawFiles.length);

    // Wipe the value of the upload element so we can upload multiple copies of the same file
    // If we didn't do this, then uploading the same file wouldn't re-trigger onChange
    fileInput.current.value = [];
  }

  function onClear(index) {
    return () => {
      const newRawFiles = justRemove(rawFiles, index);
      setRawFiles(newRawFiles);
      customOnChange(newRawFiles, index);
    };
  }

  const imgStyles = {
    maxWidth: '100%',
    maxHeight: '100%',
    minHeight: 0,
    ...applyStyles.getTarget('img')
  };
  const usingDefaultIcon = !element.properties.icon;
  // Default img width is '', which causes the default icon to have no width
  // and not appear. Set a default width if the user hasn't set one
  if (usingDefaultIcon && Number.isNaN(Number.parseInt(imgStyles.width))) {
    imgStyles.width = '32px';
  }
  const icon = !usingDefaultIcon ? (
    <Image src={element.properties.icon} fluid style={imgStyles} />
  ) : (
    <div css={imgStyles}>
      <FileUploadIcon />
    </div>
  );

  return (
    <div
      css={{
        display: 'flex',
        flexWrap: 'wrap',
        position: 'relative',
        pointerEvents: editable ? 'none' : 'auto',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {thumbnailData.map(({ filename, thumbnail }, index) => (
        <div
          key={index}
          css={{
            position: 'relative',
            margin: '0 6px 6px 0',
            maxHeight: '100%',
            border: '1px solid lightgrey',
            borderRadius: '4px',
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            boxSizing: 'border-box',
            ...applyStyles.getTarget('field')
          }}
        >
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
          {!thumbnail && (
            <span
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
            </span>
          )}
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
            onClick={(event) => {
              event.stopPropagation();
              onClear(index)();
            }}
          >
            <IconContext.Provider value={{ className: 'clear' }}>
              <FiX size='12px' />
            </IconContext.Provider>
          </div>
        </div>
      ))}
      {allowMoreFiles && (
        <div
          id={servar.key}
          onClick={onClick}
          css={{
            position: 'relative',
            cursor: 'pointer',
            maxHeight: '100%',
            display: 'flex',
            justifyContent: showLabel ? 'space-between' : 'center',
            alignItems: 'center',
            flexDirection: 'column',
            border: '1px solid lightgrey',
            borderRadius: '4px',
            background: 'white',
            overflow: 'hidden',
            margin: '0 6px 6px 0',
            ...applyStyles.getTarget('ac')
          }}
        >
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              ...applyStyles.getTarget('ac')
            }}
          >
            {icon}
            {showLabel && (
              <div css={applyStyles.getTarget('add')}>{servar.name}</div>
            )}
            {/* Input component must be hidden, and it also remains empty since we track files in state here */}
            {/* Since the input is always empty, we have to check for existing data and ignore the required attribute */}
            <input
              ref={fileInput}
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
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export default RichFileUploadField;
