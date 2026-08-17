import FeatheryClient from '../featheryClient';
import { dataHubAction as apiDataHubAction } from '@feathery/client-utils';
import { initInfo } from '../init';

jest.mock('../init');
jest.mock('@feathery/client-utils', () => ({
  ...jest.requireActual('@feathery/client-utils'),
  dataHubAction: jest.fn().mockResolvedValue([])
}));

describe('FeatheryClient.dataHubAction', () => {
  const userId = 'fuser-key-1';

  beforeEach(() => {
    jest.clearAllMocks();
    (initInfo as jest.Mock).mockReturnValue({ sdkKey: 'sdkKey', userId });
  });

  it('stages rows via create + unverified and stamps the batch value', async () => {
    const client = new FeatheryClient('formKey');
    await client.dataHubAction({
      hubId: 'hub-1',
      operation: 'create',
      verification: 'unverified',
      data: [{ name: 'A' }],
      idFieldId: 'field-9'
    });

    expect(apiDataHubAction).toHaveBeenCalledWith(
      'sdkKey',
      expect.objectContaining({
        operation: 'create',
        verification: 'unverified',
        data: [{ name: 'A' }],
        idFieldId: 'field-9',
        // The current user's key is the batch value.
        idValue: userId
      }),
      'formKey'
    );
  });

  it('passes reads through without batch stamping', async () => {
    const client = new FeatheryClient('formKey');
    await client.dataHubAction({
      hubId: 'hub-1',
      operation: 'get',
      verification: 'unverified',
      where: [{ fieldId: 'importer', value: userId }]
    });

    const options = (apiDataHubAction as jest.Mock).mock.calls[0][1];
    expect(options.verification).toBe('unverified');
    expect(options.idValue).toBeUndefined();
    expect(options.idFieldId).toBeUndefined();
  });
});
