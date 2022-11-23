import TagManager from 'react-gtm-module';
import { initInfo } from '../utils/init';

export function initializeTagManager(gtmConfig: any) {
  // @ts-expect-error TS(2551): Property 'initialized' does not exist on type '{ d... Remove this comment to see the full error message
  if (!TagManager.initialized) {
    // @ts-expect-error TS(2551): Property 'initialized' does not exist on type '{ d... Remove this comment to see the full error message
    TagManager.initialized = true;
    TagManager.initialize({
      gtmId: gtmConfig.api_key,
      dataLayer: { userId: initInfo().userId }
    });
  }
}
