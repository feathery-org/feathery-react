import { init, initInfo } from '../init';

describe('init', () => {
  describe('init', () => {
    it('initializes with API and user keys', () => {
      // Arrange
      const sdkKey = 'sdkKey';
      const userId = 'userId';
      const expected = { sdkKey, userId };

      // Act
      init(sdkKey, { userId: userId });
      const actual = initInfo();

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });
});
