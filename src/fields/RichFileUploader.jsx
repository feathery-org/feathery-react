import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'react-bootstrap';
import { IconContext } from 'react-icons';
import { FiX } from 'react-icons/fi';
import { reactFriendlyKey } from '../utils/formHelperFunctions';
import { THUMBNAIL_TYPE, getThumbnailType } from '../utils/image';

function RichFileUploader({
    field,
    onChange: customOnChange,
    onClick: customOnClick,
    initialFile
}) {
    const { servar, metadata } = field;
    const showIcon = metadata.icon_url !== '';
    const showLabel = servar.name !== '';

    const [thumbnail, setThumbnail] = useState('');
    const [filename, setFilename] = useState('');
    const fileInput = useRef();

    // Set file state to the initialFile AND update file state whenever initialFile changes
    const [file, setFile] = useState(initialFile);
    useEffect(() => setFile(initialFile), [initialFile]);

    // When a file is uploaded, we convert it to a thumbnail
    useEffect(() => {
        (async () => {
            const thumbnailType = getThumbnailType(file);
            if (thumbnailType === THUMBNAIL_TYPE.IMAGE) {
                const url = await new Promise((resolve) => {
                    const reader = new FileReader();

                    reader.addEventListener('load', function (event) {
                        resolve(event.target.result);
                    });

                    reader.readAsDataURL(file);
                });

                setFilename('');
                setThumbnail(url);
            } else if (thumbnailType === THUMBNAIL_TYPE.URL) {
                setThumbnail(file.url);
                setFilename('');
            } else {
                setThumbnail('');
                setFilename(file?.name);
            }
        })();
    }, [file]);

    function onClick(event) {
        fileInput.current.click();
        customOnClick(event);
    }

    function onChange(event) {
        const file = event.target.files[0];
        setFile(file);

        customOnChange({ target: { files: file ? [file] : [] } });
    }

    function onClear() {
        fileInput.current.value = '';
        setFile(null);
        customOnChange({ target: { files: [] } });
    }

    return (
        <>
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
                        !file && showLabel && showIcon
                            ? 'space-between'
                            : 'center',
                    alignItems: 'center',
                    flexDirection: 'column',
                    border: '1px solid lightgrey',
                    borderRadius: '4px',
                    paddingTop: `${
                        !file ? metadata.uploader_padding_top : 0
                    }px`,
                    paddingBottom: `${
                        !file ? metadata.uploader_padding_bottom : 0
                    }px`,
                    paddingLeft: `${
                        !file ? metadata.uploader_padding_left : 0
                    }px`,
                    paddingRight: `${
                        !file ? metadata.uploader_padding_right : 0
                    }px`,
                    overflow: 'hidden'
                }}
            >
                {showIcon && !file && (
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
                {showLabel && !file && (
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
                {thumbnail && (
                    <Image
                        src={thumbnail}
                        style={{
                            maxWidth: '100%',
                            maxHeight: '100%'
                        }}
                    />
                )}
                {filename && (
                    <div
                        style={{
                            color: 'black',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        {filename}
                    </div>
                )}
                {file && servar.repeat_trigger !== 'set_value' && (
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
                <input
                    ref={fileInput}
                    type='file'
                    onChange={onChange}
                    accept={servar.metadata.file_types}
                    style={{ display: 'none' }}
                />
            </div>
        </>
    );
}

export default RichFileUploader;
