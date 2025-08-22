import { getABVariant } from '../formHelperFunctions';
import { initInfo } from '../init';

jest.mock('../init');

describe('formHelperFunctions', () => {
  describe('getABVariant', () => {
    it('returns the same variant for the same information', () => {
      // Arrange
      const stepRes = {
        variant: 'variant',
        form_name: 'Form Name',
        data: 'data'
      };
      initInfo.mockReturnValue({
        sdkKey: 'sdkKey',
        userId: 'userId'
      });

      // Act
      const actual1 = getABVariant(stepRes);
      const actual2 = getABVariant(stepRes);

      // Assert
      expect(actual1).toEqual(actual2);
    });
  });
});
