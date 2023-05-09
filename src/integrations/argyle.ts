import { dynamicImport } from './utils';

let argylePromise: any = null;

export function installArgyle(isArgyleActive: any) {
  if (argylePromise) return argylePromise;
  else if (!isArgyleActive) return Promise.resolve();
  else {
    argylePromise = dynamicImport('https://plugin.argyle.com/argyle.web.v5.js');
    return argylePromise;
  }
}

export async function openArgyleLink(
  client: any,
  onSuccess: any,
  argyleConfig: any,
  updateFieldValues: any
) {
  await argylePromise;

  const userToken = (await client.fetchArgyleUserToken()).user_token;
  const argyle = global.Argyle.create({
    linkKey: argyleConfig.metadata.link_key,
    sandbox: argyleConfig.metadata.environment === 'sandbox',
    userToken,
    onAccountConnected: async ({ linkItemId }: { linkItemId: string }) => {
      const fieldVals = await client.submitArgyleUserData(linkItemId);
      updateFieldValues(fieldVals);
      await onSuccess();
      argyle.close();
    }
  });
  argyle.open();
}
