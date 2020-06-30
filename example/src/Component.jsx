import React from 'react';
import { useFeathery } from 'feathery-react-client-sdk';

export default function Component() {
    const { error, loading, flags } = useFeathery();

    return (
        <>
            {flags && <div>Flags Loaded!</div>}
            {error && <div>Error :( {error.message}</div>}
        </>
    );
}
