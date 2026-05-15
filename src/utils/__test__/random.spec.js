import getRandomBoolean, { getWeightedBoolean } from '../random';

describe('random', () => {
  describe('getWeightedBoolean', () => {
    it('matches the original rng() > 0.5 semantics at weight 50', () => {
      const cases = [
        ['userId', 'Form Name', false],
        ['sdkKey', 'Form Name', true],
        ['test_user_id', 'Other Form', false],
        ['a', 'control', false],
        ['b', 'control', true],
        ['c', 'control', false]
      ];

      cases.forEach(([userID, testName, expected]) => {
        expect(getWeightedBoolean(userID, testName, 50)).toBe(expected);
        expect(getRandomBoolean(userID, testName)).toBe(expected);
      });
    });

    it('respects weight at non-50 values', () => {
      expect(getWeightedBoolean('b', 'control', 70)).toBe(true);
      expect(getWeightedBoolean('b', 'control', 30)).toBe(false);
    });
  });
});
