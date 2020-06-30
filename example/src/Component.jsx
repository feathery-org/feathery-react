import React from 'react';
import { useFeathery } from 'feathery-react-client-sdk';

export default function Component() {
    const flagsState = useFeathery();
    return (
        <>
            {flagsState.flags && <div>Flags Loaded!</div>}
            {flagsState.error && <div>Error :( {flagsState.error.message}</div>}
        </>
    );
}
