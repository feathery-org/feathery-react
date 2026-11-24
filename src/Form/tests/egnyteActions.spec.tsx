import './testMocks';
import { cleanup, render, screen } from '@testing-library/react';
import { JSForm } from '..';
import FeatheryClient from '../../utils/featheryClient';
import { defaultClient } from '../../utils/init';
import { setFormInternalState } from '../../utils/internalState';

afterEach(() => {
  jest.clearAllMocks();
  cleanup();
});

describe('Egnyte logic rule actions', () => {
  // The paths these calls send can hold {{field}} references the server fills
  // in from saved values, so a value the rule set a moment ago has to be saved
  // before the call goes out.
  it.each([
    ['uploadFileToEgnyte', { file: { name: 'a.pdf', data: 'YQ==' } }],
    ['createEgnyteFolder', { path: 'Clients/{{household}}' }],
    ['listEgnyteFolder', { path: 'Clients/{{household}}' }],
    ['getEgnyteFile', { path: 'Clients/{{household}}/a.pdf' }]
  ])('%s saves pending field values first', async (name, params) => {
    const flushedWhenCalled: number[][] = [];
    const proto = FeatheryClient.prototype as any;
    proto[name] = jest.fn(function (this: any) {
      flushedWhenCalled.push([
        this.flushCustomFields.mock.calls.length,
        (defaultClient.flushCustomFields as jest.Mock).mock.calls.length
      ]);
      return Promise.resolve({ done: name });
    });

    render(<JSForm formId='f1' _internalId={`iid-${name}`} />);
    await screen.findByTestId('btn');
    const registered = (setFormInternalState as jest.Mock).mock.calls
      .filter(([id, state]) => id === `iid-${name}` && state[name])
      .pop();
    jest.clearAllMocks();

    const result = await registered[1][name](params);

    expect(proto[name]).toHaveBeenCalledWith(params);
    expect(flushedWhenCalled).toEqual([[1, 1]]);
    expect(result).toEqual({ done: name });
    delete proto[name];
  });
});
