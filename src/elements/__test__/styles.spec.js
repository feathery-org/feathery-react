import ApplyStyles from '../styles';

const TEST_COLOR_BACKGROUND = 'dddddd';
const mockElement = {
  styles: {
    selected_background_color: TEST_COLOR_BACKGROUND,
    selected_font_color: TEST_COLOR_BACKGROUND
  }
};

describe('ApplyStyles', () => {
  describe('applySelectorStyles', () => {
    it('applies selector styles to target with !important', () => {
      // Arrange
      const TEST_PREFIX = 'selected_';
      const TEST_STYLES_TARGET = 'active';
      const objectUnderTest = new ApplyStyles(
        mockElement,
        [TEST_STYLES_TARGET],
        false
      );

      // Act
      objectUnderTest.applySelectorStyles(
        TEST_STYLES_TARGET,
        TEST_PREFIX,
        true
      );
      const actual = objectUnderTest.getTarget(TEST_STYLES_TARGET);

      // Assert
      const expectedStyle = `#${TEST_COLOR_BACKGROUND} !important`;
      const expected = {
        backgroundColor: expectedStyle,
        color: expectedStyle,
        transition: '0.15s ease-in-out all'
      };
      expect(actual).toEqual(expected);
    });
    it('applies selector styles to target WITHOUT !important', () => {
      // Arrange
      const TEST_PREFIX = 'selected_';
      const TEST_STYLES_TARGET = 'active';
      const objectUnderTest = new ApplyStyles(
        mockElement,
        [TEST_STYLES_TARGET],
        false
      );

      // Act
      objectUnderTest.applySelectorStyles(TEST_STYLES_TARGET, TEST_PREFIX);
      const actual = objectUnderTest.getTarget(TEST_STYLES_TARGET);

      // Assert
      const expectedStyle = `#${TEST_COLOR_BACKGROUND}`;
      const expected = {
        backgroundColor: expectedStyle,
        color: expectedStyle,
        transition: '0.15s ease-in-out all'
      };
      expect(actual).toEqual(expected);
    });
  });
});
