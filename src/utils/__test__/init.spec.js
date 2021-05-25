import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';
import { init, initInfo } from '../init';

jest.mock('@fingerprintjs/fingerprintjs', () => ({ load: jest.fn() }));
jest.mock('uuid');

describe('init', () => {
    describe('init', () => {
        it('initializes with API and user keys', () => {
            // Arrange
            const apiKey = 'apiKey';
            const userKey = 'userKey';
            const expected = { apiKey, userKey };

            // Act
            init(apiKey, userKey);
            const actual = initInfo();

            // Assert
            expect(actual).toMatchObject(expected);
        });

        it('initializes with just API key and fingerprint', () => {
            // Arrange
            const apiKey = 'apiKey';
            const userKey = 'userKey';
            const expected = { apiKey, userKey };
            FingerprintJS.load.mockResolvedValue({
                get: jest.fn().mockResolvedValue({ visitorId: userKey })
            });

            // Act
            init(apiKey);
            const actual = initInfo();

            // Assert
            expect(actual).toMatchObject(expected);
        });

        it('initializes with just API key and fingerprint', () => {
            // Arrange
            const apiKey = 'apiKey';
            const userKey = 'userKey';
            const expected = { apiKey, userKey };
            FingerprintJS.load.mockResolvedValue({
                get: jest.fn().mockResolvedValue({})
            });
            uuidv4.mockReturnValue(userKey);

            // Act
            init(apiKey);
            const actual = initInfo();

            // Assert
            expect(actual).toMatchObject(expected);
        });

        it("won't initialize twice", () => {
            // Arrange
            const apiKey = 'apiKey';
            const userKey = 'userKey';
            const apiKey2 = 'apiKey2';
            const userKey2 = 'userKey2';
            const expected = { apiKey, userKey };

            // Act
            init(apiKey, userKey);
            init(apiKey2, userKey2);
            const actual = initInfo();

            // Assert
            expect(actual).toMatchObject(expected);
        });

        // TODO: Adjust how re-initialization is tracked in init.js so we can test multiple times
        // it('throws on an invalid API key', () => {
        //     // Arrange
        //     const apiKey = 5;
        //     const userKey = 'userKey';

        //     // Act
        //     // Assert
        //     expect(() => {
        //         init(apiKey, userKey);
        //     }).toThrow(new APIKeyError('Invalid API Key'));
        // });

        // it('throws on an invalid user key', () => {
        //     // Arrange
        //     const apiKey = 'apiKey';
        //     const userKey = 5;

        //     // Act
        //     // Assert
        //     expect(() => {
        //         init(apiKey, userKey);
        //     }).toThrow(new UserKeyError('Invalid User Key'));
        // });
    });
});
