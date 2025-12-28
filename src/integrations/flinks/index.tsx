import { featheryWindow } from '../../utils/browser';
import IntegrationClient from '../../utils/featheryClient/integrationClient';
import React, { useState } from 'react';
import { getIframeAuthorizationToken, setupFlinks } from './utils';

type UpdateFieldValuesCallback = (fieldValues: any) => void;

const getOpenFlinksConnect =
  (setFlinksUrl: any) =>
  async (
    client: IntegrationClient,
    onSuccess: () => void,
    onError: (err?: string) => void,
    flinksConfig: any,
    updateFieldValues: UpdateFieldValuesCallback
  ) => {
    // authorizing Flinks iframe
    let token: string;
    let getToken = await getIframeAuthorizationToken(client);
    if (getToken.err) {
      return { err: getToken.err, fieldValues: {} };
    } else {
      token = getToken.token;
    }

    const instance =
      flinksConfig.metadata.environment === 'sandbox'
        ? 'toolbox'
        : flinksConfig.metadata.instance;

    let flinksUrl = `https://${instance}-iframe.private.fin.ag/v2/?accountSelectorEnable=true&showAllOperationsAccounts=true&detailsAndStatementEnable=true&monthsOfStatements=MostRecent`;
    if (token) {
      flinksUrl += `&authorizeToken=${token}`;
    }

    let accountId: string;

    if (flinksConfig.metadata.environment === 'sandbox')
      flinksUrl += '&demo=true';

    setFlinksUrl(flinksUrl);

    featheryWindow().addEventListener('message', async (e: any) => {
      const step = e.data.step;
      if (step === 'ERROR') onError();
      else if (step === 'ACCOUNT_SELECTED') {
        accountId = e.data.accountId;
      } else if (step === 'REDIRECT') {
        setFlinksUrl('');
        const loginId = new URLSearchParams(e.data.url).get('loginId');
        if (!loginId) return onError();

        // call the iframe authorization endpoint again, as required by Flinks
        getToken = await getIframeAuthorizationToken(client);
        if (getToken.err) onError(getToken.err);
        else {
          token = getToken.token;
        }

        const data = await setupFlinks(client, loginId, accountId, token);
        if (!data.err) updateFieldValues(data.fieldValues);
        return onSuccess();
      }
    });
  };

export async function generateQuikDocuments(
  client: IntegrationClient,
  action: Record<string, any>
) {
  return client.generateQuikEnvelopes(action);
}

export function useFlinksConnect() {
  const [flinksUrl, setFlinksUrl] = useState('');

  const openFlinksConnect = getOpenFlinksConnect(setFlinksUrl);
  const flinksFrame = flinksUrl ? (
    <div
      css={{
        position: 'fixed',
        backgroundColor: '#fff',
        minWidth: '100vw',
        height: '100%',
        overflow: 'hidden',
        zIndex: 9999
      }}
    >
      <button
        css={{
          backgroundColor: '#e2626e',
          color: '#fff',
          border: '2px solid #e2626e',
          padding: '8px 15px',
          borderRadius: '6px',
          position: 'absolute',
          top: '24px',
          left: '16px',
          fontWeight: '600',
          '&:hover': { cursor: 'pointer' }
        }}
        onClick={() => {
          setFlinksUrl('');
          featheryWindow().postMessage({ step: 'ERROR' });
        }}
      >
        Back
      </button>
      <iframe
        src={flinksUrl}
        css={{
          width: '100%',
          height: '100vh',
          border: 'none',
          outline: 'none',
          margin: 0,
          padding: 0
        }}
      />
    </div>
  ) : null;

  return { openFlinksConnect, flinksFrame };
}
