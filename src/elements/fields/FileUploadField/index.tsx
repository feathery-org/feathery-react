import React, { useEffect, useRef, useState } from 'react';
import { useThumbnailData } from '../../../utils/image';
import { isEmptyArray, justRemove, toList } from '../../../utils/array';
import {
  CloseIcon,
  DownloadIcon,
  FileUploadIcon
} from '../../components/icons';
import { imgMaxSizeStyles } from '../../styles';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { downloadFile, iosScrollOnFocus } from '../../../utils/browser';

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
  const fileInput = useRef<HTMLInputElement>(null);

  const [rawFiles, setRawFiles] = useState<Promise<File>[]>([]);
  const [hoverDownload, setHoverDownload] = useState(-1);
  const [failedThumbnails, setFailedThumbnails] = useState<Set<number>>(
    new Set()
  );

  useEffect(() => {
    // Prevent infinite loop of setting a new empty array as the value
    if (isEmptyArray(rawFiles) && isEmptyArray(initialFiles)) return;
    // Normalize placeholders like [null] to an empty list
    setRawFiles(toList(initialFiles).filter(Boolean));
  }, [initialFiles]);

  // Reset failed thumbnails when file list changes
  useEffect(() => {
    setFailedThumbnails(new Set());
  }, [rawFiles.length]);

  // Thumbnails derived from current files; rawFiles is normalized to exclude nulls
  const thumbnailData = useThumbnailData(rawFiles);
  const hasFiles = rawFiles.length > 0;
  const allowMoreFiles = isMultiple || !hasFiles;
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
    if (files && allowMoreFiles) handleFiles(files);
  };

  const onClick = () => {
    if (!allowMoreFiles && !hidePreview) return;
    if (disabled) return;
    fileInput.current?.click();
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
    if (files.some((file) => file.size > fileSizeLimit)) {
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
    if (disabled) return;
    let files = Array.from(filelist);
    if (!isMultiple) {
      files = [files[0]];
    }

    try {
      if (
        files.some((file) => !file || !(file instanceof File) || file.size <= 0)
      ) {
        throw new Error('Some files are invalid');
      }

      validateFileTypes(files);
      validateFileSizes(files);

      const existingCount = hidePreview ? 0 : rawFiles.length;
      if (files.length + existingCount > NUM_FILES_LIMIT) {
        // Splice off the uploaded files past the upload limit
        files.splice(NUM_FILES_LIMIT - existingCount);
      }

      const uploadedFiles = files.map((file) => Promise.resolve(file));
      let newRawFiles, length;
      if (hidePreview) {
        newRawFiles = uploadedFiles;
        length = 0;
      } else {
        newRawFiles = [...rawFiles, ...uploadedFiles];
        length = existingCount;
      }
      setRawFiles(newRawFiles);
      customOnChange(newRawFiles, length);
      fileInput.current?.setCustomValidity('');

      // Wipe the value of the upload element so we can upload multiple copies of the same file
      // If we didn't do this, then uploading the same file wouldn't re-trigger onChange
      if (fileInput.current) {
        fileInput.current.value = '';
      }
    } catch (error: any) {
      fileInput.current?.setCustomValidity(error.message);
      fileInput.current?.reportValidity();
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
    <img
      src={element.properties.icon}
      style={{ ...imgStyles, maxWidth: '100%', height: 'auto' }}
      alt=''
    />
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
      onDrop={disabled ? undefined : handleDrop}
    >
      {children}
      {!hidePreview &&
        thumbnailData.map(({ filename, thumbnail }, index) =>
          index < rawFiles.length ? (
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
                  onClick={async () =>
                    downloadFile((await rawFiles[index]) as any)
                  }
                >
                  <DownloadIcon />
                </div>
              )}
              {thumbnail && !failedThumbnails.has(index) ? (
                <img
                  src={thumbnail}
                  onError={() =>
                    setFailedThumbnails((prev) => new Set(prev).add(index))
                  }
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                  }}
                  alt={filename || ''}
                />
              ) : (
                <span
                  style={{
                    height: '100%',
                    width: '100%',
                    wordBreak: 'break-all',
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
                role='button'
                aria-label='Clear file'
                onClick={(event) => {
                  // Stop propagation so window doesn't open up to pick another file to upload
                  event.stopPropagation();
                  fileInput.current?.setCustomValidity('');
                  onClear(index)();
                }}
              >
                <CloseIcon fill='white' width={12} height={12} />
              </div>
            </div>
          ) : null
        )}
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
        required={required && !hasFiles}
        accept={allowedFileTypes.join(',') || undefined}
        disabled={disabled}
        aria-label={element.properties.aria_label}
        multiple={isMultiple}
        onFocus={iosScrollOnFocus}
        style={{
          position: 'absolute',
          pointerEvents: 'none',
          opacity: 0,
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: FORM_Z_INDEX - 2
        }}
      />
    </div>
  );
}

export default FileUploadField;
