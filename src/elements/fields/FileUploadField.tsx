import React, { useEffect, useRef, useState } from 'react';
import { useThumbnailData } from '../../utils/image';
import { isEmptyArray, justRemove, toList } from '../../utils/array';

import { Image } from 'react-bootstrap';
import { CloseIcon, DownloadIcon, FileUploadIcon } from '../components/icons';
import { imgMaxSizeStyles } from '../styles';
import { FORM_Z_INDEX } from '../../utils/styles';
import { downloadFile } from '../../utils/browser';

const DEFAULT_FILE_SIZE_LIMIT = 1024 * 1024 * 10;
const NUM_FILES_LIMIT = 20;

function FileUploadField({
  element,
  responsiveStyles,
  required = false,
  disabled = false,
  editMode,
  onChange: customOnChange = () => {},
  initialFiles = [],
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const showLabel = servar.name !== '';
  const isMultiple = servar.metadata.multiple;
  const fileInput = useRef<any>(undefined);

  const [rawFiles, setRawFiles] = useState<any[]>([]);
  const [hoverDownload, setHoverDownload] = useState(-1);

  useEffect(() => {
    // Prevent infinite loop of setting a new empty array as the value
    if (isEmptyArray(rawFiles) && isEmptyArray(initialFiles)) return;
    setRawFiles(toList(initialFiles));
  }, [initialFiles]);

  const thumbnailData = useThumbnailData(rawFiles);
  const allowMoreFiles = isMultiple || thumbnailData.length === 0;
  const fileExists = thumbnailData.length > 0;
  const hidePreview = element.styles.hide_file_preview;

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const { files } = e.dataTransfer;
    if (allowMoreFiles) handleFiles(files);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && allowMoreFiles) {
      handleFiles(files);
    }
  };

  const onClick = () => {
    if (!allowMoreFiles && !hidePreview) return;
    fileInput.current.click();
  };

  const allowedFileTypes: string[] = [...servar.metadata.file_types];
  if (servar.metadata.custom_file_types)
    allowedFileTypes.push(
      ...servar.metadata.custom_file_types.map((type: string) => `.${type}`)
    );

  const isFileTypeMatch = (file: File, allowedType: string) => {
    // handle image/* or video/* etc.
    if (allowedType.endsWith('/*')) {
      const typeCategory = allowedType.split('/')[0];
      return file.type.startsWith(typeCategory + '/');
    }
    // handle specific file types like application/pdf
    if (allowedType.includes('/')) {
      return file.type === allowedType;
    }
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    return allowedType.toLowerCase() === extension;
  };

  const validateFileTypes = (files: File[]) => {
    if (allowedFileTypes.length === 0) return;

    const individualTypes = allowedFileTypes.flatMap((str: string) =>
      str.split(',').map((item) => item.trim())
    );
    const invalidFiles = files.filter(
      (file) => !individualTypes.some((type) => isFileTypeMatch(file, type))
    );

    if (invalidFiles.length > 0) {
      throw new Error(
        `Invalid file type. Allowed types: ${allowedFileTypes.join(', ')}`
      );
    }
  };

  const fileSizeLimit = servar.max_length
    ? servar.max_length * 1024
    : DEFAULT_FILE_SIZE_LIMIT;

  const validateFileSizes = (files: File[]) => {
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
      throw new Error(`File exceeds max size of ${sizeLabel}`);
    }
  };

  // When the user uploads files to the multi-file upload, we just append to the existing set
  // By default the input element would just replace all the uploaded files (we don't want that)
  const handleFiles = async (filelist: FileList) => {
    let files = Array.from(filelist);
    if (!isMultiple) {
      files = [files[0]];
    }

    try {
      validateFileTypes(files);
      validateFileSizes(files);

      const originalLength = hidePreview ? 0 : rawFiles.length;
      if (files.length + originalLength > NUM_FILES_LIMIT) {
        // Splice off the uploaded files past the upload count
        files.splice(NUM_FILES_LIMIT - originalLength);
      }

      const uploadedFiles = files.map((file) => Promise.resolve(file));
      // If the value is [null] (initial state of repeating rows), we want to replace the null with the file
      const isRawFilesNull = rawFiles.length === 1 && rawFiles[0] === null;
      let newRawFiles, length;
      if (isRawFilesNull || hidePreview) {
        newRawFiles = uploadedFiles;
        length = 0;
      } else {
        newRawFiles = [...rawFiles, ...uploadedFiles];
        length = rawFiles.length;
      }
      setRawFiles(newRawFiles);
      customOnChange(newRawFiles, length);

      // Wipe the value of the upload element so we can upload multiple copies of the same file
      // If we didn't do this, then uploading the same file wouldn't re-trigger onChange
      fileInput.current.value = [];
    } catch (error: any) {
      fileInput.current.setCustomValidity(error.message);
      fileInput.current.reportValidity();
    }
  };

  function onClear(index: any) {
    return () => {
      const newRawFiles = justRemove(rawFiles, index);
      setRawFiles(newRawFiles);
      customOnChange(newRawFiles, -1);
    };
  }

  const imgStyles = {
    ...imgMaxSizeStyles,
    ...responsiveStyles.getTarget('img')
  };
  const icon = element.properties.icon ? (
    <Image src={element.properties.icon} fluid style={imgStyles} />
  ) : (
    <FileUploadIcon
      width={
        imgStyles.width && imgStyles.width !== 'px'
          ? imgStyles.width
          : undefined
      }
      style={{ maxHeight: '100%' }}
    />
  );

  return (
    <div
      css={{
        display: 'flex',
        flexWrap: 'wrap',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        width: '100%',
        height: '100%',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
              ...(thumbnail
                ? {}
                : { paddingLeft: '20px', paddingRight: '20px' }),
              ...responsiveStyles.getTarget('field')
            }}
            onMouseEnter={() => setHoverDownload(index)}
            onMouseLeave={() => setHoverDownload(-1)}
          >
            {hoverDownload === index && (
              <div
                css={{
                  position: 'absolute',
                  margin: 'auto',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: '48px',
                  height: '48px',
                  borderRadius: '8px',
                  backgroundColor: '#3E414D80',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onClick={async () => downloadFile(await rawFiles[index])}
              >
                <DownloadIcon />
              </div>
            )}
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
                {filename || 'File'}
              </span>
            )}
            <div
              css={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                color: 'white',
                background: '#AAA',
                height: '16px',
                width: '16px',
                borderRadius: '50%',
                pointerEvents: disabled ? 'none' : 'auto',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                transition: '0.2s ease all',
                '&:hover': { backgroundColor: '#BBB' }
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
            pointerEvents: disabled ? 'none' : 'auto',
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
        name={servar.key}
        ref={fileInput}
        type='file'
        onChange={handleChange}
        required={required && !fileExists}
        accept={allowedFileTypes.join(',') || undefined}
        disabled={disabled}
        aria-label={element.properties.aria_label}
        multiple={isMultiple}
        style={{
          position: 'absolute',
          opacity: 0,
          bottom: 0,
          left: '50%',
          width: '1px',
          height: '1px',
          zIndex: FORM_Z_INDEX - 2
        }}
      />
    </div>
  );
}

export default FileUploadField;
