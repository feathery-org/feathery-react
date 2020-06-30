import React from 'react';

import { Feathery } from 'feathery-react-client-sdk';
import Component from './Component';

const App = () => {
    return (
        <Feathery
            sdkKey='some-key'
            userKey='some-user'
            fallback={<div>Loading ... </div>}
        >
            <Component />
        </Feathery>
    );
};

export default App;
