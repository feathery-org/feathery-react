import { init, initInfo } from '../init';

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
    });
});
