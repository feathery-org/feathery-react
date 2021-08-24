import React, { useEffect, useRef, useState } from 'react';

import { FiX } from 'react-icons/fi';
import { IconContext } from 'react-icons';
import { Image } from 'react-bootstrap';
import { getThumbnailData } from '../../utils/image';
import { reactFriendlyKey } from '../../utils/formHelperFunctions';

function RichFileUploader({
    field,
    onChange: customOnChange,
    onClick: customOnClick,
    initialFile
}) {
    const { servar, applyStyles } = field;
    const showIcon = field.icon_url !== '';
    const showLabel = servar.name !== '';

    const [thumbnail, setThumbnail] = useState('');
    const [filename, setFilename] = useState('');
    const fileInput = useRef();

    // Set file state to the initialFile AND update file state whenever initialFile changes
    const [file, setFile] = useState(initialFile);
    useEffect(() => {
        if (fileInput.current) fileInput.current.value = '';
        setFile(initialFile);
    }, [initialFile]);

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

        customOnChange(file ? [filePromise] : []);
    }

    function onClear() {
        fileInput.current.value = '';
        setFile(null);
        customOnChange([]);
    }

    applyStyles.apply(
        'fc',
        [
            'uploader_padding_top',
            'uploader_padding_right',
            'uploader_padding_bottom',
            'uploader_padding_left'
        ],
        (a, b, c, d) => ({
            padding: file ? '0' : `${a}px ${b}px ${c}px ${d}px`
        })
    );

    return (
        <div
            id={reactFriendlyKey(field)}
            onClick={onClick}
            css={{
                position: 'relative',
                cursor: 'pointer',
                maxHeight: '100%',
                display: 'flex',
                justifyContent:
                    !file && showLabel && showIcon ? 'space-between' : 'center',
                alignItems: 'center',
                flexDirection: 'column',
                border: '1px solid lightgrey',
                borderRadius: '4px',
                overflow: 'hidden',
                ...applyStyles.getTarget('fc')
            }}
        >
            {showIcon && !file && (
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
            {showLabel && !file && (
                <div css={applyStyles.getTarget('field')}>{servar.name}</div>
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
