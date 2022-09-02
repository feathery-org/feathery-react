import React, { useRef } from 'react';
import { useFileData, useThumbnailData } from '../../utils/image';
import { justRemove } from '../../utils/array';

import { Image } from 'react-bootstrap';
import { CloseIcon, FileUploadIcon } from '../components/icons';
import { imgMaxSizeStyles } from '../styles';

const FILE_SIZE_LIMIT = 1024 * 1024 * 10;
const NUM_FILES_LIMIT = 20;

function FileUploadField({
  element,
  applyStyles,
  required = false,
  editable = false,
  onChange: customOnChange = () => {},
  initialFiles = [],
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const showLabel = servar.name !== '';
  const isMultiple = servar.metadata.multiple;
  const fileInput = useRef();

  const [rawFiles, setRawFiles] = useFileData(initialFiles);
  const thumbnailData = useThumbnailData(rawFiles);
  const allowMoreFiles = isMultiple || thumbnailData.length === 0;
  const fileExists = thumbnailData.length > 0;

  const onClick = () => {
    if (!allowMoreFiles) return;
    // @ts-expect-error TS(2532): Object is possibly 'undefined'.
    fileInput.current.click();
  };

  // When the user uploads files to the multi-file upload, we just append to the existing set
  // By default the input element would just replace all the uploaded files (we don't want that)
  const onChange = async (event: any) => {
    const files = Array.from(event.target.files).filter(
      (file) => (file as any).size <= FILE_SIZE_LIMIT
    );

    if (files.length + rawFiles.length > NUM_FILES_LIMIT) {
      // Splice off the uploaded files past the upload count
      files.splice(NUM_FILES_LIMIT - rawFiles.length);
    }

    const uploadedFiles = files.map((file) => Promise.resolve(file));
    // If the value is [null] (initial state of repeating rows), we want to replace the null with the file
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    const isRawFilesNull = rawFiles.length === 1 && rawFiles[0] === null;
    let newRawFiles, length;
    if (isRawFilesNull) {
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
    // @ts-expect-error TS(2532): Object is possibly 'undefined'.
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
    ...applyStyles.getTarget('img')
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
        pointerEvents: editable ? 'none' : 'auto',
        margin: isMultiple ? undefined : '0 6px 6px 0',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {thumbnailData.map(({ filename, thumbnail }: any, index: any) => (
        <div
          key={index}
          css={{
            position: 'relative',
            maxHeight: '100%',
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            boxSizing: 'border-box',
            margin: isMultiple ? '0 6px 6px 0' : undefined,
            ...applyStyles.getTarget('field')
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
              onClear(index)();
            }}
          >
            <CloseIcon fill='white' width={12} height={12} />
          </div>
        </div>
      ))}
      {allowMoreFiles && (
        <div
          onClick={onClick}
          css={{
            position: 'relative',
            margin: isMultiple ? '0 6px 6px 0' : undefined,
            cursor: 'pointer',
            maxHeight: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column',
            overflow: 'hidden',
            boxSizing: 'border-box',
            ...applyStyles.getTarget('ac')
          }}
        >
          {icon}
          {showLabel && (
            <div css={applyStyles.getTarget('add')}>{servar.name}</div>
          )}
        </div>
      )}
      {/* Input component must be hidden, and it also remains empty since we track files in state here */}
      {/* Since the input is always empty, we have to check for existing data and ignore the required attribute */}
      {/* This input must always be rendered even if no files can be added so we can set field errors */}
      <input
        id={servar.key}
        // @ts-expect-error TS(2322): Type 'MutableRefObject<undefined>' is not assignab... Remove this comment to see the full error message
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
      {children}
    </div>
  );
}

export default FileUploadField;
