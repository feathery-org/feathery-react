import React from 'react';

import { Feathery } from 'feathery-react-client-sdk';
import Component from './Component';

const App = () => {
    return (
        <Feathery
            sdkKey='ae33f89-e913-4e10-9fe7-c229931a382b'
            userKey='Feathery'
            fallback={<div>Loading ... </div>}
        >
            <Component />
        </Feathery>
    );
};

export default App;
