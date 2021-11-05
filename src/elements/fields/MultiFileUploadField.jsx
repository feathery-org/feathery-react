import React, { useRef } from 'react';
import { useFileData, useThumbnailData } from '../../utils/image';

import { FiX } from 'react-icons/fi';
import { IconContext } from 'react-icons';
import { Image } from 'react-bootstrap';
import { justRemove } from '../../utils/array';

function MultiFileUploadField({
  element,
  applyStyles,
  required = false,
  onChange: customOnChange = () => {},
  onClick: customOnClick = () => {},
  initialFiles = null
}) {
  const servar = element.servar;
  const showIcon = element.icon_url !== '';
  const showLabel = servar.name !== '';

  // Raw files are useful to bubble up through onChange
  // Raw files are then translated into thumbnail data
  // And we filter out any files that can't be reasonably thumbnailed
  const [rawFiles, setRawFiles] = useFileData(initialFiles);
  const thumbnailData = useThumbnailData(rawFiles);

  // Reference the hidden multi-select element
  const fileInput = useRef();

  function onClick(event) {
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

  return (
    <div
      css={{
        display: 'flex',
        flexWrap: 'wrap',
        ...applyStyles.getTarget('fc')
      }}
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
            ...applyStyles.getTarget('field')
          }}
        >
          {thumbnail && (
            <Image
              src={thumbnail}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
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
            onClick={onClear(index)}
          >
            <IconContext.Provider value={{ className: 'clear' }}>
              <FiX size='12px' />
            </IconContext.Provider>
          </div>
        </div>
      ))}
      <div
        id={servar.key}
        onClick={onClick}
        css={{
          position: 'relative',
          cursor: 'pointer',
          maxHeight: '100%',
          display: 'flex',
          justifyContent: showLabel && showIcon ? 'space-between' : 'center',
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
        {showIcon && (
          <Image
            src={element.icon_url}
            fluid
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              minHeight: 0
            }}
          />
        )}
        {showLabel && (
          <div css={applyStyles.getTarget('add')}>{servar.name}</div>
        )}
        {/* Input component must be hidden, and it also remains empty since we track files in state here */}
        {/* Since the input is always empty, we have to check for existing data and ignore the required attribute */}
        <input
          ref={fileInput}
          type='file'
          multiple
          onChange={onChange}
          required={required && rawFiles.length === 0}
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
  );
}

export default MultiFileUploadField;
