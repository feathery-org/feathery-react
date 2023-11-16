import ResponsiveStyles from '../styles';

const TEST_COLOR_BACKGROUND = 'dddddd';
const mockElement = {
  styles: {
    selected_background_color: TEST_COLOR_BACKGROUND,
    selected_font_color: TEST_COLOR_BACKGROUND
  }
};

describe('responsiveStyles', () => {
  describe('applySelectorStyles', () => {
    it('applies selector styles to target with !important', () => {
      // Arrange
      const TEST_PREFIX = 'selected_';
      const TEST_STYLES_TARGET = 'active';
      const objectUnderTest = new ResponsiveStyles(
        mockElement,
        [TEST_STYLES_TARGET],
        false
      );

      // Act
      objectUnderTest.applySelectorStyles(TEST_STYLES_TARGET, {
        prefix: TEST_PREFIX,
        important: true
      });
      const actual = objectUnderTest.getTarget(TEST_STYLES_TARGET);

      // Assert
      const expectedStyle = `#${TEST_COLOR_BACKGROUND} !important`;
      const expected = {
        backgroundColor: expectedStyle,
        transition: '0.2s ease all'
      };
      expect(actual).toEqual(expected);
    });
    it('applies selector styles to target WITHOUT !important', () => {
      // Arrange
      const TEST_PREFIX = 'selected_';
      const TEST_STYLES_TARGET = 'active';
      const objectUnderTest = new ResponsiveStyles(
        mockElement,
        [TEST_STYLES_TARGET],
        false
      );

      // Act
      objectUnderTest.applySelectorStyles(TEST_STYLES_TARGET, {
        prefix: TEST_PREFIX
      });
      const actual = objectUnderTest.getTarget(TEST_STYLES_TARGET);

      // Assert
      const expectedStyle = `#${TEST_COLOR_BACKGROUND}`;
      const expected = {
        backgroundColor: expectedStyle,
        transition: '0.2s ease all'
      };
      expect(actual).toEqual(expected);
    });
  });
});
