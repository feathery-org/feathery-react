import React, { useRef, useState } from 'react';
import { Image } from 'react-bootstrap';
import { IconContext } from 'react-icons';
import { FiX } from 'react-icons/fi';
import { justRemove } from '../utils/array';
import { reactFriendlyKey } from '../utils/formHelperFunctions';
import { THUMBNAIL_TYPE, getThumbnailType } from '../utils/image';

async function getThumbnailData(file) {
    const thumbnailType = getThumbnailType(file);
    if (thumbnailType === THUMBNAIL_TYPE.IMAGE) {
        const url = await new Promise((resolve) => {
            const reader = new FileReader();

            reader.addEventListener('load', (event) => {
                resolve(event.target.result);
            });

            reader.readAsDataURL(file);
        });

        return { filename: file.name, thumbnail: url };
    } else if (thumbnailType === THUMBNAIL_TYPE.URL) {
        return { filename: '', thumbnail: file.url };
    } else {
        return { filename: file.name, thumbnail: '' };
    }
}

function MultiFileUploader({
    field,
    onChange: customOnChange,
    onClick: customOnClick,
    initialFiles = []
}) {
    const { servar, metadata } = field;
    const showIcon = metadata.icon_url !== '';
    const showLabel = servar.name !== '';

    // Maintain separate lists of raw files and thumbnails data
    // Raw files are useful to bubble up through onChange
    // Thumbnails data can be evaluated only when we add files (for performance)
    const [rawFiles, setRawFiles] = useState(initialFiles);
    const [thumbnailsData, setThumbnailsData] = useState(
        initialFiles.map((file) => ({ filename: '', thumbnail: file.url }))
    );

    // Reference the hidden multi-select element
    const fileInput = useRef();

    function onClick(event) {
        fileInput.current.click();
        customOnClick(event);
    }

    // When the user uploads files to the multi-file upload, we just append to the existing set
    // By default the input element would just replace all the uploaded files (we don't want that)
    async function onChange(event) {
        const uploadedFiles = Array.from(event.target.files);
        const newThumbnailData = await Promise.all(
            uploadedFiles.map(getThumbnailData)
        );

        const newRawFiles = [...rawFiles, ...uploadedFiles];
        setRawFiles(newRawFiles);
        setThumbnailsData([...thumbnailsData, ...newThumbnailData]);

        // Simulate the onChange event from a multi-select
        customOnChange({ target: { files: newRawFiles } });
    }

    function onClear(index) {
        return () => {
            const newRawFiles = justRemove(rawFiles, index);
            setRawFiles(newRawFiles);
            setThumbnailsData(justRemove(thumbnailsData, index));

            // Simulate the onChange event from a multi-select
            customOnChange({ target: { files: newRawFiles } });
        };
    }

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {thumbnailsData.map(({ filename, thumbnail }, index) => (
                <div
                    key={index}
                    style={{
                        position: 'relative',
                        height: `${field.field_height}${field.field_height_unit}`,
                        width: `${field.field_width}${field.field_width_unit}`,
                        margin: '0 6px 6px 0',
                        maxHeight: '100%',
                        border: '1px solid lightgrey',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}
                >
                    {thumbnail && (
                        <Image
                            src={thumbnail}
                            style={{
                                maxWidth: '100%',
                                maxHeight: '100%'
                            }}
                        />
                    )}
                    {!thumbnail && (
                        <span style={{ color: 'black' }}>{filename}</span>
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
                id={reactFriendlyKey(field)}
                onClick={onClick}
                style={{
                    position: 'relative',
                    cursor: 'pointer',
                    height: `${field.field_height}${field.field_height_unit}`,
                    width: `${field.field_width}${field.field_width_unit}`,
                    maxHeight: '100%',
                    display: 'flex',
                    justifyContent:
                        showLabel && showIcon ? 'space-between' : 'center',
                    alignItems: 'center',
                    flexDirection: 'column',
                    border: '1px solid lightgrey',
                    borderRadius: '4px',
                    paddingTop: `${metadata.uploader_padding_top}px`,
                    paddingBottom: `${metadata.uploader_padding_bottom}px`,
                    paddingLeft: `${metadata.uploader_padding_left}px`,
                    paddingRight: `${metadata.uploader_padding_right}px`,
                    overflow: 'hidden',
                    margin: '0 6px 6px 0'
                }}
            >
                {showIcon && (
                    <Image
                        src={metadata.icon_url}
                        fluid
                        style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            minHeight: 0
                        }}
                    />
                )}
                {showLabel && (
                    <div
                        style={{
                            paddingTop: `${metadata.cta_padding_top}px`,
                            paddingBottom: `${metadata.cta_padding_bottom}px`,
                            paddingLeft: `${metadata.cta_padding_left}px`,
                            paddingRight: `${metadata.cta_padding_right}px`,
                            background: `#${field.background_color}`
                        }}
                    >
                        {servar.name}
                    </div>
                )}
                <input
                    ref={fileInput}
                    type='file'
                    multiple
                    onChange={onChange}
                    accept={servar.metadata.file_types}
                    style={{ display: 'none' }}
                />
            </div>
        </div>
    );
}

export default MultiFileUploader;
