import React from 'react';
import { useFeathery } from 'feathery-react-client-sdk';

export default function Component() {
    const { error, loading, settings } = useFeathery();

    return (
        <>
            {settings && <div>Settings Loaded!</div>}
            {error && <div>Error :( {error.message}</div>}
        </>
    );
}
