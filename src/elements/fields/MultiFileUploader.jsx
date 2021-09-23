import React, { useEffect, useRef, useState } from 'react';

import { FiX } from 'react-icons/fi';
import { IconContext } from 'react-icons';
import { Image } from 'react-bootstrap';
import { getThumbnailData } from '../../utils/image';
import { justRemove } from '../../utils/array';

function MultiFileUploader({
    field,
    required,
    onChange: customOnChange,
    onClick: customOnClick,
    initialFiles = []
}) {
    const { servar, applyStyles } = field;
    const showIcon = field.icon_url !== '';
    const showLabel = servar.name !== '';

    // Maintain separate lists of raw files and thumbnails data
    // Raw files are useful to bubble up through onChange
    // Thumbnails data can be evaluated only when we add files (for performance)
    const [rawFiles, setRawFiles] = useState(initialFiles);
    const [thumbnailsData, setThumbnailsData] = useState(
        initialFiles.map(() => ({ filename: '', thumbnail: '' }))
    );
    useEffect(() => {
        (async () => {
            const data = await Promise.all(initialFiles.map(getThumbnailData));
            setThumbnailsData(data);
        })();
    }, [initialFiles]);

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
        const newThumbnailData = await Promise.all(
            uploadedFiles.map(getThumbnailData)
        );

        const newRawFiles = [...rawFiles, ...uploadedFiles];
        setRawFiles(newRawFiles);
        setThumbnailsData([...thumbnailsData, ...newThumbnailData]);
        customOnChange(newRawFiles, rawFiles.length);

        // Wipe the value of the upload element so we can upload multiple copies of the same file
        // If we didn't do this, then uploading the same file wouldn't re-trigger onChange
        fileInput.current.value = [];
    }

    function onClear(index) {
        return () => {
            const newRawFiles = justRemove(rawFiles, index);
            setRawFiles(newRawFiles);
            setThumbnailsData(justRemove(thumbnailsData, index));
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
            {thumbnailsData.map(({ filename, thumbnail }, index) => (
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
                                alignItems: 'center'
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
                    justifyContent:
                        showLabel && showIcon ? 'space-between' : 'center',
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
                        src={field.icon_url}
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

export default MultiFileUploader;
