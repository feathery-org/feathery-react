import ResponsiveStyles, { DEFAULT_MOBILE_BREAKPOINT } from '../styles';

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
        false,
        DEFAULT_MOBILE_BREAKPOINT
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
        false,
        DEFAULT_MOBILE_BREAKPOINT
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

  describe('applyFontStyles with a prefix', () => {
    it('reads the prefixed property namespace, not the unprefixed one', () => {
      // Arrange
      const TARGET = 'fieldLabel';
      const objectUnderTest = new ResponsiveStyles(
        {
          styles: {
            // label_-prefixed values should be picked up...
            label_font_size: 20,
            label_font_color: 'FF0000',
            label_font_family: 'Arial',
            // ...and the unprefixed (field) values must be ignored
            font_size: 99,
            font_color: '00FF00'
          }
        },
        [TARGET],
        false,
        DEFAULT_MOBILE_BREAKPOINT
      );

      // Act
      objectUnderTest.applyFontStyles(TARGET, false, true, 'label_');
      const actual = objectUnderTest.getTarget(TARGET);

      // Assert
      expect(actual).toMatchObject({
        fontSize: '20px',
        color: '#FF0000',
        fontFamily: 'Arial'
      });
    });
  });

  // Mirrors how applyFieldStyles (src/elements/fields/index.tsx) builds the
  // 'fieldLabel' target so the label can be styled independently of the field.
  describe('fieldLabel target (label styling)', () => {
    const buildFieldLabelTarget = (styles) => {
      const rs = new ResponsiveStyles(
        { styles },
        [],
        false,
        DEFAULT_MOBILE_BREAKPOINT
      );
      rs.addTargets('fieldLabel');
      rs.applyFontStyles('fieldLabel', false, true, 'label_', true);
      rs.apply('fieldLabel', 'label_margin_top', (a) =>
        a === undefined ? {} : { marginTop: `${a}px` }
      );
      rs.apply('fieldLabel', 'label_gap', (a) =>
        a === undefined ? {} : { marginBottom: `${a}px` }
      );
      return rs.getTarget('fieldLabel');
    };

    it('maps label_* font, margin, and gap props onto the target', () => {
      // Act
      const actual = buildFieldLabelTarget({
        label_font_size: 20,
        label_font_color: 'FF0000',
        label_font_family: 'Arial',
        label_margin_top: 4,
        label_gap: 12
      });

      // Assert
      expect(actual).toMatchObject({
        fontSize: '20px',
        color: '#FF0000',
        fontFamily: 'Arial',
        marginTop: '4px',
        marginBottom: '12px'
      });
    });

    it('label_gap controls marginBottom independently', () => {
      // Act
      const actual = buildFieldLabelTarget({ label_gap: 24 });

      // Assert
      expect(actual.marginBottom).toBe('24px');
    });

    it('is backwards compatible: unset label_gap / label_margin_top emit no margin so the hardcoded default survives', () => {
      // Act
      const actual = buildFieldLabelTarget({});

      // Assert
      expect(actual.marginBottom).toBeUndefined();
      expect(actual.marginTop).toBeUndefined();
    });

    it('is backwards compatible: with no label_* styles set, the target emits no CSS so the label inherits the field font', () => {
      // Act
      const actual = buildFieldLabelTarget({});

      // Assert
      expect(actual).toEqual({});
    });

    it('emits only the label_* properties that are set; unset ones still inherit', () => {
      // Act
      const actual = buildFieldLabelTarget({ label_font_size: 20 });

      // Assert
      expect(actual).toEqual({ fontSize: '20px' });
    });
  });
});
