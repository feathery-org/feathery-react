import React, { useEffect, useRef, useState } from 'react';

import { FiX } from 'react-icons/fi';
import { IconContext } from 'react-icons';
import { Image } from 'react-bootstrap';
import { getThumbnailData } from '../utils/image';
import { marginStyleFromField } from '../utils/styles';
import { reactFriendlyKey } from '../utils/formHelperFunctions';

function RichFileUploader({
    field,
    onChange: customOnChange,
    onClick: customOnClick,
    initialFile
}) {
    const { servar, styles } = field;
    const showIcon = styles.icon_url !== '';
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
            const { filename, thumbnail } = await getThumbnailData(file);
            setFilename(filename);
            setThumbnail(thumbnail);
        })();
    }, [file]);

    function onClick(event) {
        fileInput.current.click();
        customOnClick(event);
    }

    function onChange(event) {
        const file = event.target.files[0];
        const filePromise = Promise.resolve(file);
        setFile(filePromise);

        customOnChange({ target: { files: file ? [filePromise] : [] } });
    }

    function onClear() {
        fileInput.current.value = '';
        setFile(null);
        customOnChange({ target: { files: [] } });
    }

    return (
        <div
            id={reactFriendlyKey(field)}
            onClick={onClick}
            style={{
                position: 'relative',
                cursor: 'pointer',
                height: `${styles.height}${styles.height_unit}`,
                width: `${styles.width}${styles.width_unit}`,
                maxHeight: '100%',
                display: 'flex',
                justifyContent:
                    !file && showLabel && showIcon ? 'space-between' : 'center',
                alignItems: 'center',
                flexDirection: 'column',
                border: '1px solid lightgrey',
                borderRadius: '4px',
                paddingTop: `${!file ? styles.uploader_padding_top : 0}px`,
                paddingBottom: `${
                    !file ? styles.uploader_padding_bottom : 0
                }px`,
                paddingLeft: `${!file ? styles.uploader_padding_left : 0}px`,
                paddingRight: `${!file ? styles.uploader_padding_right : 0}px`,
                overflow: 'hidden',
                ...marginStyleFromField(field)
            }}
        >
            {showIcon && !file && (
                <Image
                    src={styles.icon_url}
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
                        paddingTop: `${styles.cta_padding_top}px`,
                        paddingBottom: `${styles.cta_padding_bottom}px`,
                        paddingLeft: `${styles.cta_padding_left}px`,
                        paddingRight: `${styles.cta_padding_right}px`,
                        background: `#${styles.background_color}`
                    }}
                >
                    {servar.name}
                </div>
            )}
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
            {filename && (
                <div
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
    );
}

export default RichFileUploader;
