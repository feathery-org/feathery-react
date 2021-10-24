import TagManager from 'react-gtm-module';
import { initState } from '../utils/init';

export function initializeTagManager(gtmConfig) {
    if (!TagManager.initialized) {
        TagManager.initialized = true;
        TagManager.initialize({
            gtmId: gtmConfig.api_key,
            dataLayer: { userId: initState.userKey }
        });
    }
}
