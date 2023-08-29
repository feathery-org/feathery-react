import React, { useRef } from 'react';
import { useFileData, useThumbnailData } from '../../utils/image';
import { justRemove } from '../../utils/array';

import { Image } from 'react-bootstrap';
import { CloseIcon, FileUploadIcon } from '../components/icons';
import { imgMaxSizeStyles } from '../styles';

const MAX_FILE_SIZE_LIMIT = 1024 * 1024 * 10;
const NUM_FILES_LIMIT = 20;

function FileUploadField({
  element,
  responsiveStyles,
  required = false,
  editMode,
  onChange: customOnChange = () => {},
  initialFiles = [],
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const showLabel = servar.name !== '';
  const isMultiple = servar.metadata.multiple;
  const fileInput = useRef<any>();

  const [rawFiles, setRawFiles] = useFileData(initialFiles);
  const thumbnailData = useThumbnailData(rawFiles);
  const allowMoreFiles = isMultiple || thumbnailData.length === 0;
  const fileExists = thumbnailData.length > 0;
  const hidePreview = element.styles.hide_file_preview;

  const onClick = () => {
    if (!allowMoreFiles && !hidePreview) return;
    fileInput.current.click();
  };

  let fileSizeLimit = servar.max_length
    ? servar.max_length * 1024
    : MAX_FILE_SIZE_LIMIT;
  // Upper-bound file size at 10 megabytes
  fileSizeLimit = Math.min(fileSizeLimit, MAX_FILE_SIZE_LIMIT);
  // When the user uploads files to the multi-file upload, we just append to the existing set
  // By default the input element would just replace all the uploaded files (we don't want that)
  const onChange = async (event: any) => {
    const files = Array.from(event.target.files);
    if (files.some((file: any) => file.size > fileSizeLimit)) {
      let sizeLabel = '';
      if (fileSizeLimit < 1024) sizeLabel = `${fileSizeLimit} bytes`;
      else if (fileSizeLimit <= 1024 * 1024) {
        const kbSize = Math.floor(fileSizeLimit / 1024);
        sizeLabel = `${kbSize} kb`;
      } else {
        const mbSize = Math.floor(fileSizeLimit / (1024 * 1024));
        sizeLabel = `${mbSize} mb`;
      }
      fileInput.current.setCustomValidity(
        `File exceeds max size of ${sizeLabel}`
      );
      fileInput.current.reportValidity();
      return;
    }

    const originalLength = hidePreview ? 0 : rawFiles.length;
    if (files.length + originalLength > NUM_FILES_LIMIT) {
      // Splice off the uploaded files past the upload count
      files.splice(NUM_FILES_LIMIT - originalLength);
    }

    const uploadedFiles = files.map((file) => Promise.resolve(file));
    // If the value is [null] (initial state of repeating rows), we want to replace the null with the file
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    const isRawFilesNull = rawFiles.length === 1 && rawFiles[0] === null;
    let newRawFiles, length;
    if (isRawFilesNull || hidePreview) {
      newRawFiles = uploadedFiles;
      length = 0;
    } else {
      // @ts-expect-error TS(2461): Type 'any[] | Dispatch<SetStateAction<any[]>>' is ... Remove this comment to see the full error message
      newRawFiles = [...rawFiles, ...uploadedFiles];
      length = rawFiles.length;
    }
    // @ts-expect-error TS(2349): This expression is not callable.
    setRawFiles(newRawFiles);
    customOnChange(newRawFiles, length);

    // Wipe the value of the upload element so we can upload multiple copies of the same file
    // If we didn't do this, then uploading the same file wouldn't re-trigger onChange
    fileInput.current.value = [];
  };

  function onClear(index: any) {
    return () => {
      const newRawFiles = justRemove(rawFiles, index);
      // @ts-expect-error TS(2349): This expression is not callable.
      setRawFiles(newRawFiles);
      customOnChange(newRawFiles, index);
    };
  }

  const imgStyles = {
    ...imgMaxSizeStyles,
    ...responsiveStyles.getTarget('img')
  };
  const icon = element.properties.icon ? (
    <Image src={element.properties.icon} fluid style={imgStyles} />
  ) : (
    <FileUploadIcon width={imgStyles.width} />
  );

  return (
    <div
      css={{
        display: 'flex',
        flexWrap: 'wrap',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        width: '100%',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {!hidePreview &&
        thumbnailData.map(({ filename, thumbnail }: any, index: any) => (
          <div
            key={index}
            css={{
              position: 'relative',
              width: '100%',
              maxHeight: '100%',
              overflow: 'hidden',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              boxSizing: 'border-box',
              ...responsiveStyles.getTarget('field')
            }}
          >
            {thumbnail ? (
              <Image
                src={thumbnail}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain'
                }}
              />
            ) : (
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
                // Stop propagation so window doesn't open up to pick another file to upload
                event.stopPropagation();
                fileInput.current.setCustomValidity('');
                onClear(index)();
              }}
            >
              <CloseIcon fill='white' width={12} height={12} />
            </div>
          </div>
        ))}
      {(allowMoreFiles || hidePreview) && (
        <div
          onClick={onClick}
          css={{
            position: 'relative',
            cursor: 'pointer',
            maxHeight: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column',
            overflow: 'hidden',
            boxSizing: 'border-box',
            width: '100%',
            ...responsiveStyles.getTarget('ac')
          }}
        >
          {icon}
          {showLabel && (
            <div css={responsiveStyles.getTarget('add')}>{servar.name}</div>
          )}
        </div>
      )}
      {/* Input component must be hidden, and it also remains empty since we track files in state here */}
      {/* Since the input is always empty, we have to check for existing data and ignore the required attribute */}
      {/* This input must always be rendered even if no files can be added so we can set field errors */}
      <input
        id={servar.key}
        ref={fileInput}
        type='file'
        onChange={onChange}
        required={required && !fileExists}
        accept={servar.metadata.file_types}
        disabled={element.properties.disabled ?? false}
        multiple={isMultiple}
        style={{
          position: 'absolute',
          bottom: 0,
          opacity: 0,
          zIndex: -1
        }}
      />
    </div>
  );
}

export default FileUploadField;
