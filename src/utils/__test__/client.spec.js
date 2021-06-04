import Client from '../client';
import { initInfo, initUserPromise } from '../init';

jest.mock('../init', () => ({
    initInfo: jest.fn(),
    initUserPromise: Promise.resolve()
}));

describe('client', () => {
    describe('fetchForm', () => {
        it('fetches a form with the provided parameters', async () => {
            // Arrange
            const formKey = 'formKey';
            const client = new Client(formKey);
            initInfo.mockReturnValue({
                apiKey: 'apiKey',
                userKey: 'userKey',
                sessions: {},
                forms: {}
            });
            global.fetch = jest.fn().mockResolvedValue({
                status: 200,
                json: jest.fn().mockResolvedValue('json')
            });

            // Act
            const response = await client.fetchForm();

            // Assert
            expect(global.fetch).toHaveBeenCalledWith(
                'https://cdn.feathery.tech/api/panel/v3/?form_key=formKey',
                {
                    cache: 'no-store',
                    importance: 'high',
                    headers: { Authorization: 'Token apiKey' }
                }
            );
            expect(response).toEqual('json');
        });
    });

    describe('fetchSession', () => {
        it('fetches a session with the provided parameters', async () => {
            // Arrange
            const formKey = 'formKey';
            const client = new Client(formKey);
            initInfo.mockReturnValue({
                apiKey: 'apiKey',
                userKey: 'userKey',
                sessions: {},
                forms: {}
            });
            global.fetch = jest.fn().mockResolvedValue({
                status: 200,
                json: jest.fn().mockResolvedValue('json')
            });

            // Act
            const response = await client.fetchSession();

            // Assert
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.feathery.tech/api/panel/session/?form_key=formKey&fuser_key=userKey',
                {
                    cache: 'no-store',
                    importance: 'high',
                    headers: { Authorization: 'Token apiKey' }
                }
            );
            expect(response).toEqual('json');
        });
    });

    describe('submitCustom', () => {
        it('fetches on submit', () => {
            // Arrange
            const formKey = 'formKey';
            const client = new Client(formKey);
            const customKeyValues = ['foo', 'bar'];
            const body = {
                fuser_key: 'userKey',
                custom_key_values: customKeyValues,
                form_key: formKey
            };
            initInfo.mockReturnValue({ apiKey: 'apiKey', userKey: 'userKey' });
            global.fetch = jest.fn().mockResolvedValue({ status: 200 });

            // Act
            const response = client.submitCustom(customKeyValues);

            // Assert
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.feathery.tech/api/panel/custom/submit/',
                {
                    cache: 'no-store',
                    headers: {
                        Authorization: 'Token apiKey',
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    body: JSON.stringify(body)
                }
            );
            expect(response).toEqual(undefined);
        });
    });

    describe('submitStep', () => {
        it('fetches on step submission', () => {
            // Arrange
            const formKey = 'formKey';
            const client = new Client(formKey);
            const servars = [
                {
                    key: 'servar1',
                    type: 'type1'
                }
            ];
            const body = { fuser_key: 'userKey', servars };
            initInfo.mockReturnValue({ apiKey: 'apiKey', userKey: 'userKey' });
            global.fetch = jest.fn().mockResolvedValue({ status: 200 });

            // Act
            const response = client.submitStep(servars);

            // Assert
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.feathery.tech/api/panel/step/submit/',
                {
                    cache: 'no-store',
                    headers: {
                        Authorization: 'Token apiKey',
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    body: JSON.stringify(body)
                }
            );
            expect(response).toEqual(undefined);
        });
    });

    describe('registerEvent', () => {
        it('registers an event', async () => {
            // Arrange
            const formKey = 'formKey';
            const stepKey = 'stepKey';
            const event = { eventStuff: 'eventStuff' };
            const client = new Client(formKey);
            const body = {
                form_key: formKey,
                step_key: stepKey,
                event,
                fuser_key: 'userKey'
            };
            initInfo.mockReturnValue({ apiKey: 'apiKey', userKey: 'userKey' });
            global.fetch = jest.fn().mockResolvedValue({ status: 200 });

            // Act
            await initUserPromise;
            const response = await client.registerEvent(stepKey, event);

            // Assert
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.feathery.tech/api/event/',
                {
                    cache: 'no-store',
                    headers: {
                        Authorization: 'Token apiKey',
                        'Content-Type': 'application/json'
                    },
                    method: 'POST',
                    body: JSON.stringify(body)
                }
            );
            expect(response).toEqual(undefined);
        });
    });
});
