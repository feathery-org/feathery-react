import {
  encodeGetParams,
  isNum,
  filterKeys,
  formatNumeric,
  formatMoneyUSD
} from '../primitives';

describe('primitives', () => {
  describe('encodeGetParams', () => {
    it('handles well-formatted input', () => {
      // Arrange
      const params = { foo: 'bar', bar: 'foo' };
      const expected = 'foo=bar&bar=foo';

      // Act
      const actual = encodeGetParams(params);

      // Assert
      expect(actual).toEqual(expected);
    });

    it('handles poorly-formatted input', () => {
      // Arrange
      const params = {
        'hello-world': 'Hello World!',
        stuff: '©œ˜ ≈˚∆ ∑ƒ∆∂'
      };
      const expected =
        'hello-world=Hello%20World!&stuff=%C2%A9%C5%93%CB%9C%C2%A0%E2%89%88%CB%9A%E2%88%86%C2%A0%E2%88%91%C6%92%E2%88%86%E2%88%82';

      // Act
      const actual = encodeGetParams(params);

      // Assert
      expect(actual).toEqual(expected);
    });
  });
});

describe('primitives', () => {
  describe('isNum', () => {
    it('handles well-formatted input', () => {
      // Arrange
      const val = '1';

      // Act
      const actual = isNum(val);

      // Assert
      expect(actual).toEqual(true);
    });

    it('handles poorly-formatted input', () => {
      // Arrange
      const val = 'a';

      // Act
      const actual = isNum(val);

      // Assert
      expect(actual).toEqual(false);
    });
  });
  describe('formatNumeric', () => {
    it('handles grouping in en-US (default)', () => {
      expect(formatNumeric(23000)).toEqual('23,000');
    });
    it('formats decimal currency without the symbol', () => {
      expect(
        formatNumeric(23000, { style: 'decimal', minimumFractionDigits: 2 })
      ).toEqual('23,000.00');
    });
  });
  describe('formatMoneyUSD', () => {
    it('handles grouping in en-US and USD (default)', () => {
      expect(formatMoneyUSD(23000)).toEqual('$23,000.00');
    });
  });
});

describe('filterKeys', () => {
  it('removes excess non-allowed keys from an object', () => {
    // Arrange
    const obj = {
      key1: '1',
      key2: '2',
      key3: '3',
      key4: '4'
    };
    const expected = {
      key1: '1',
      key4: '4'
    };

    // Act
    const actual = filterKeys(obj, ['key1', 'key4', 'key5']);

    // Assert
    expect(actual).toMatchObject(expected);
  });
});
