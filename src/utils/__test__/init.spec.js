import { init, initInfo } from '../init';

describe('init', () => {
  describe('init', () => {
    it('initializes with API and user keys', () => {
      // Arrange
      const sdkKey = 'sdkKey';
      const userKey = 'userKey';
      const expected = { sdkKey, userKey };

      // Act
      init(sdkKey, { userKey: userKey });
      const actual = initInfo();

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });
});
