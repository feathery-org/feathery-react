import {
  formatAllFormFields,
  formatStepFields,
  getABVariant,
  nextStepKey,
  getOrigin,
  recurseProgressDepth
} from '../formHelperFunctions';
import { fieldValues, initInfo } from '../init';

jest.mock('../init');

// eslint-disable-next-line camelcase
const hide_show = {
  behavior: 'hide',
  rules: []
};

describe('formHelperFunctions', () => {
  describe('formatStepFields', () => {
    it('formats zero elements correctly', () => {
      // Arrange
      const step = {
        servar_fields: []
      };
      const expected = {};

      // Act
      const actual = formatStepFields(step, false);

      // Assert
      expect(actual).toMatchObject(expected);
    });

    it('formats more than zero elements correctly', () => {
      // Arrange
      const step = {
        servar_fields: [
          {
            servar: {
              key: 'key1',
              type: 'text',
              name: 'Name 1',
              metadata: {}
            },
            // eslint-disable-next-line camelcase
            show_hide: hide_show
          },
          {
            servar: {
              key: 'key2',
              type: 'file_upload',
              name: 'Name 2',
              metadata: {}
            },
            // eslint-disable-next-line camelcase
            show_hide: hide_show
          }
        ]
      };

      Object.assign(fieldValues, { key1: 'value1' });

      const fileObject = new Blob();
      const expected = {
        key1: {
          value: 'value1',
          type: 'text',
          displayText: 'Name 1'
        },
        key2: {
          value: fileObject,
          type: 'file_upload',
          displayText: 'Name 2'
        }
      };

      // Act
      const actual = formatStepFields(step, false);

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });

  describe('formatAllFormFields', () => {
    it('formats zero steps correctly', () => {
      // Arrange
      const steps = [];
      const expected = {};

      // Act
      const actual = formatAllFormFields(steps);

      // Assert
      expect(actual).toMatchObject(expected);
    });

    it('formats more than zero steps correctly', () => {
      // Arrange
      const steps = [
        {
          servar_fields: [
            {
              servar: {
                key: 'key1',
                type: 'text',
                name: 'Name 1',
                metadata: {}
              },
              // eslint-disable-next-line camelcase
              show_hide: hide_show
            }
          ]
        },
        {
          servar_fields: [
            {
              servar: {
                key: 'key2',
                type: 'file_upload',
                name: 'Name 2',
                metadata: {}
              },
              // eslint-disable-next-line camelcase
              show_hide: hide_show
            }
          ]
        }
      ];

      Object.assign(fieldValues, { key1: 'value1' });

      const fileObject = new Blob();
      const expected = {
        key1: {
          value: 'value1',
          type: 'text',
          displayText: 'Name 1'
        },
        key2: {
          value: fileObject,
          type: 'file_upload',
          displayText: 'Name 2'
        }
      };

      // Act
      const actual = formatAllFormFields(steps);

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });

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

  describe('nextStepKey', () => {
    it('returns the next step for no condition rules', () => {
      // Arrange
      const nextKey = 'abcdef';
      const trigger = 'trigger';
      const elementType = 'type';
      const elementIDs = ['id'];
      const conditions = [
        {
          element_type: elementType,
          element_id: elementIDs[0],
          trigger,
          rules: [],
          next_step_key: nextKey,
          metadata: {}
        }
      ];

      // Act
      const newStepKey = nextStepKey(conditions, {
        elementType,
        elementIDs,
        trigger
      });

      // Assert
      expect(newStepKey).toEqual(nextKey);
    });

    it('returns the next step for a single condition rule', () => {
      // Arrange
      const nextKey = 'abcdef';
      const trigger = 'trigger';
      const elementType = 'button';
      const elementIDs = ['id'];
      const conditions = [
        {
          element_type: elementType,
          element_id: elementIDs[0],
          trigger,
          rules: [
            {
              field_key: 'rule-key',
              values: ['rule-value'],
              comparison: 'equal'
            }
          ],
          next_step_key: nextKey,
          metadata: {}
        }
      ];

      Object.assign(fieldValues, { 'rule-key': 'rule-value' });

      // Act
      const newStepKey = nextStepKey(conditions, {
        elementType,
        elementIDs,
        trigger
      });

      // Assert
      expect(newStepKey).toEqual(nextKey);
    });

    it('returns the next step for a single array-based condition rule', () => {
      // Arrange
      const nextKey = 'abcdef';
      const trigger = 'trigger';
      const elementType = 'button';
      const elementIDs = ['id'];
      const conditions = [
        {
          element_type: elementType,
          element_id: elementIDs[0],
          trigger,
          rules: [
            {
              field_key: 'rule-key',
              values: ['rule-value'],
              comparison: 'equal'
            }
          ],
          next_step_key: nextKey,
          metadata: {}
        }
      ];

      Object.assign(fieldValues, {
        'rule-key': ['rule-value', 'not-rule-value']
      });

      // Act
      const newStepKey = nextStepKey(conditions, {
        elementType,
        elementIDs,
        trigger
      });

      // Assert
      expect(newStepKey).toEqual(nextKey);
    });

    it('returns the next step for multiple condition rules', () => {
      // Arrange
      const nextKey = 'abcdef';
      const trigger = 'trigger';
      const elementType = 'type';
      const elementIDs = ['id'];
      const conditions = [
        {
          element_type: elementType,
          element_id: elementIDs[0],
          trigger,
          rules: [
            {
              field_key: 'rule-key',
              values: ['rule-value'],
              comparison: 'equal'
            },
            {
              field_key: 'rule-key',
              values: ['not-rule-value'],
              comparison: 'not_equal'
            }
          ],
          next_step_key: nextKey,
          metadata: {}
        }
      ];

      Object.assign(fieldValues, { 'rule-key': 'rule-value' });

      // Act
      const newStepKey = nextStepKey(conditions, {
        elementType,
        elementIDs,
        trigger
      });

      // Assert
      expect(newStepKey).toEqual(nextKey);
    });
  });

  describe('getOrigin', () => {
    it('gets the entry point for a sequence of steps', () => {
      // Arrange
      const steps = {
        step1: {
          origin: true,
          key: 'step1'
        },
        step2: {
          origin: false,
          key: 'step2'
        }
      };
      const expected = {
        origin: true,
        key: 'step1'
      };

      // Act
      const actual = getOrigin(steps);

      // Assert
      expect(actual).toEqual(expected);
    });
  });

  describe('recurseDepth', () => {
    it('calculates depth for one node, no branches', () => {
      // Arrange
      const currentStepKey = 'step1';
      const steps = {
        step1: {
          key: 'step1',
          next_conditions: [],
          previous_conditions: [],
          progress_bars: [{}],
          origin: true
        }
      };
      const expected = [0, 0];

      // Act
      const actual = recurseProgressDepth(steps, currentStepKey);

      // Assert
      expect(actual).toEqual(expected);
    });

    it('calculates depth for two nodes, one branch', () => {
      // Arrange
      const currentStepKey = 'step2';
      const steps = {
        step1: {
          key: 'step1',
          next_conditions: [
            {
              next_step_key: 'step2'
            }
          ],
          previous_conditions: [],
          progress_bars: [{}],
          origin: true
        },
        step2: {
          key: 'step2',
          next_conditions: [],
          previous_conditions: [],
          progress_bars: [{}]
        }
      };
      const expected = [1, 1];

      // Act
      const actual = recurseProgressDepth(steps, currentStepKey);

      // Assert
      expect(actual).toEqual(expected);
    });

    it('calculates depth for multiple nodes, multiple branchs', () => {
      // Arrange
      const currentStepKey = 'step2';
      const steps = {
        step1: {
          key: 'step1',
          next_conditions: [
            {
              next_step_key: 'step2'
            },
            {
              next_step_key: 'step3'
            }
          ],
          previous_conditions: [],
          progress_bars: [{}],
          origin: true
        },
        step2: {
          key: 'step2',
          next_conditions: [],
          previous_conditions: [],
          progress_bars: [{}]
        },
        step3: {
          key: 'step3',
          next_conditions: [
            {
              next_step_key: 'step4'
            }
          ],
          previous_conditions: [],
          progress_bars: [{}]
        },
        step4: {
          key: 'step4',
          next_conditions: [],
          previous_conditions: [],
          progress_bars: [{}]
        }
      };
      const expected = [1, 2];

      // Act
      const actual = recurseProgressDepth(steps, currentStepKey);

      // Assert
      expect(actual).toEqual(expected);
    });
  });
});
