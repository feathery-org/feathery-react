import ResponsiveStyles, { DEFAULT_MOBILE_BREAKPOINT } from '../styles';
import { LABEL_TEXT_ALIGN_DEFAULT } from '../utils/labelStyleResolver';

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
      rs.apply('fieldLabel', 'label_gap', (a) =>
        a === undefined ? {} : { marginBottom: `${a}px` }
      );
      rs.apply('fieldLabel', 'label_text_align', (a) =>
        a === undefined
          ? { textAlign: LABEL_TEXT_ALIGN_DEFAULT }
          : { textAlign: a }
      );
      return rs.getTarget('fieldLabel');
    };

    it('maps label_* font and gap props onto the target', () => {
      // Act
      const actual = buildFieldLabelTarget({
        label_font_size: 20,
        label_font_color: 'FF0000',
        label_font_family: 'Arial',
        label_gap: 12
      });

      // Assert
      expect(actual).toMatchObject({
        fontSize: '20px',
        color: '#FF0000',
        fontFamily: 'Arial',
        marginBottom: '12px'
      });
    });

    it('label_gap controls marginBottom independently', () => {
      // Act
      const actual = buildFieldLabelTarget({ label_gap: 24 });

      // Assert
      expect(actual.marginBottom).toBe('24px');
    });

    it('is backwards compatible: unset label_gap emits no margin so the hardcoded default survives', () => {
      // Act
      const actual = buildFieldLabelTarget({});

      // Assert
      expect(actual.marginBottom).toBeUndefined();
    });

    it('is backwards compatible: with no label_* styles set, the target emits no font CSS so the label inherits the field font (text-align forced to default)', () => {
      // Act
      const actual = buildFieldLabelTarget({});

      // Assert: only the forced text-align default is emitted; no font props
      expect(actual).toEqual({ textAlign: LABEL_TEXT_ALIGN_DEFAULT });
    });

    it('emits only the label_* font properties that are set; unset ones still inherit', () => {
      // Act
      const actual = buildFieldLabelTarget({ label_font_size: 20 });

      // Assert
      expect(actual).toEqual({
        fontSize: '20px',
        textAlign: LABEL_TEXT_ALIGN_DEFAULT
      });
    });

    it('forces text-align to the shared default when label_text_align is unset', () => {
      const actual = buildFieldLabelTarget({});
      expect(actual.textAlign).toBe(LABEL_TEXT_ALIGN_DEFAULT);
    });

    it('uses an explicit label_text_align over the default', () => {
      const actual = buildFieldLabelTarget({ label_text_align: 'center' });
      expect(actual.textAlign).toBe('center');
    });
  });
});
