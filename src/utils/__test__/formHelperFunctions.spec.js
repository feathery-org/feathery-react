import {
    adjustColor,
    formatAllStepFields,
    formatStepFields,
    calculateDimensions,
    getABVariant,
    getDefaultFieldValues,
    nextStepKey,
    getOrigin,
    recurseDepth
} from '../formHelperFunctions';
import { initInfo } from '../init';

jest.mock('../init');

describe('formHelperFunctions', () => {
    describe('adjustColor', () => {
        it('adjusts color up', () => {
            // Arrange
            const color = '#000000';
            const amount = 30;
            const expected = '#1e1e1e';

            // Act
            const actual = adjustColor(color, amount);

            // Assert
            expect(actual).toEqual(expected);
        });

        it('adjusts color down', () => {
            // Arrange
            const color = '#ffffff';
            const amount = -30;
            const expected = '#e1e1e1';

            // Act
            const actual = adjustColor(color, amount);

            // Assert
            expect(actual).toEqual(expected);
        });
    });

    describe('formatStepFields', () => {
        it('formats zero fields correctly', () => {
            // Arrange
            const step = {
                servar_fields: []
            };
            const expected = {};

            // Act
            const actual = formatStepFields(step, {});

            // Assert
            expect(actual).toMatchObject(expected);
        });

        it('formats more than zero fields correctly', () => {
            // Arrange
            const step = {
                servar_fields: [
                    {
                        servar: {
                            key: 'key1',
                            type: 'text',
                            name: 'Name 1'
                        }
                    },
                    {
                        servar: {
                            key: 'key2',
                            type: 'file_upload',
                            name: 'Name 2'
                        }
                    }
                ]
            };
            const fieldValues = {
                key1: 'value1'
            };
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
            const actual = formatStepFields(step, fieldValues, fileObject);

            // Assert
            expect(actual).toMatchObject(expected);
        });
    });

    describe('formatAllStepFields', () => {
        it('formats zero steps correctly', () => {
            // Arrange
            const steps = [];
            const expected = {};

            // Act
            const actual = formatAllStepFields(steps);

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
                                name: 'Name 1'
                            }
                        }
                    ]
                },
                {
                    servar_fields: [
                        {
                            servar: {
                                key: 'key2',
                                type: 'file_upload',
                                name: 'Name 2'
                            }
                        }
                    ]
                }
            ];
            const fieldValues = {
                key1: 'value1'
            };
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
            const actual = formatAllStepFields(steps, fieldValues, fileObject);

            // Assert
            expect(actual).toMatchObject(expected);
        });
    });

    // TODO: Pull apart calculateDimensions and make it more testable
    describe('calculateDimensions', () => {
        it('calculates dimensions on a mobile screen', () => {
            // Arrange
            const inputStep = {
                repeat_row_start: 2,
                repeat_row_end: 3,
                text_fields: [
                    {
                        text: 'First text field {{foobar}}',
                        row_index: 1,
                        row_index_end: 1,
                        column_index: 2
                    }
                ],
                servar_fields: [],
                images: [],
                grid_rows: ['50px', '150px', '50px'],
                grid_columns: ['150px', '50px', '40px'],
                progress_bar: {
                    column_index: 0
                }
            };
            const fieldValues = {
                foobar: 'Hello World'
            };
            const dimensions = {
                width: 500,
                columns: ['100%'],
                rows: ['minmax(50px,min-content)']
            };
            const newDimensions = {
                width: 200,
                columns: ['75%', '5%', '20%'],
                rows: [
                    'minmax(50px,min-content)',
                    'minmax(150px,min-content)',
                    'minmax(50px,min-content)'
                ]
            };
            window.innerWidth = 500;
            const setDimensions = jest.fn();
            const setFormDimensions = jest.fn();

            // Act
            calculateDimensions(
                inputStep,
                null,
                fieldValues,
                dimensions,
                setDimensions,
                setFormDimensions
            );

            // Assert
            expect(inputStep.text_fields).toEqual([
                {
                    text: 'First text field {{foobar}}',
                    column_index: 2,
                    row_index: 1,
                    row_index_end: 1
                }
            ]);
            expect(inputStep.images).toEqual([]);
            expect(inputStep.servar_fields).toEqual([]);
            expect(setDimensions).toHaveBeenCalledWith(newDimensions);
            expect(setFormDimensions).toHaveBeenCalledWith(
                newDimensions.width,
                newDimensions.columns,
                newDimensions.rows
            );
        });

        it('calculates dimensions on a desktop screen', () => {
            // Arrange
            const inputStep = {
                repeat_row_start: 2,
                repeat_row_end: 3,
                text_fields: [],
                servar_fields: [
                    {
                        text: 'First servar field {{foobar}}',
                        row_index: 1,
                        row_index_end: 1,
                        column_index: 2
                    }
                ],
                images: [],
                grid_rows: ['50px', '150px', '50px'],
                grid_columns: ['150px', '50%'],
                progress_bar: {
                    column_index: 0
                }
            };
            const fieldValues = {
                foobar: 'Hello World'
            };
            const dimensions = {
                width: 500,
                columns: ['100%'],
                rows: ['minmax(50px,min-content)']
            };
            const newDimensions = {
                width: null,
                columns: ['150px', '50%'],
                rows: [
                    'minmax(50px,min-content)',
                    'minmax(150px,min-content)',
                    'minmax(50px,min-content)'
                ]
            };
            window.innerWidth = 1024;
            const setDimensions = jest.fn();
            const setFormDimensions = jest.fn();

            // Act
            calculateDimensions(
                inputStep,
                null,
                fieldValues,
                dimensions,
                setDimensions,
                setFormDimensions
            );

            // Assert
            expect(inputStep.text_fields).toEqual([]);
            expect(inputStep.images).toEqual([]);
            expect(inputStep.servar_fields).toEqual([
                {
                    text: 'First servar field {{foobar}}',
                    column_index: 2,
                    row_index: 1,
                    row_index_end: 1
                }
            ]);
            expect(setDimensions).toHaveBeenCalledWith(newDimensions);
            expect(setFormDimensions).toHaveBeenCalledWith(
                newDimensions.width,
                newDimensions.columns,
                newDimensions.rows
            );
        });

        it('handles repeating elements', () => {
            // Arrange
            const inputStep = {
                repeat_row_start: 1,
                repeat_row_end: 1,
                text_fields: [
                    {
                        text: 'Repeated text field {{foobar}}',
                        row_index: 1,
                        row_index_end: 1,
                        column_index: 2
                    }
                ],
                servar_fields: [],
                images: [],
                grid_rows: ['50px', '150px', '50px'],
                grid_columns: ['150px', '50%'],
                progress_bar: {
                    column_index: 0
                }
            };
            const fieldValues = {
                foobar: ['Hello', 'World', "I'm BMO"]
            };
            const dimensions = {
                width: 500,
                columns: ['100%'],
                rows: ['minmax(50px,min-content)']
            };
            const newDimensions = {
                width: null,
                columns: ['150px', '50%'],
                rows: [
                    'minmax(50px,min-content)',
                    'minmax(150px,min-content)',
                    'minmax(150px,min-content)',
                    'minmax(150px,min-content)',
                    'minmax(50px,min-content)'
                ]
            };
            window.innerWidth = 1024;
            const setDimensions = jest.fn();
            const setFormDimensions = jest.fn();

            // Act
            calculateDimensions(
                inputStep,
                null,
                fieldValues,
                dimensions,
                setDimensions,
                setFormDimensions
            );

            // Assert
            expect(inputStep.text_fields).toEqual([
                {
                    text: 'Repeated text field {{foobar}}',
                    column_index: 2,
                    repeat: 0,
                    row_index: 1,
                    row_index_end: 1
                },
                {
                    text: 'Repeated text field {{foobar}}',
                    column_index: 2,
                    repeat: 1,
                    row_index: 2,
                    row_index_end: 2
                },
                {
                    text: 'Repeated text field {{foobar}}',
                    column_index: 2,
                    repeat: 2,
                    row_index: 3,
                    row_index_end: 3
                }
            ]);
            expect(inputStep.images).toEqual([]);
            expect(inputStep.servar_fields).toEqual([]);
            expect(setDimensions).toHaveBeenCalledWith(newDimensions);
            expect(setFormDimensions).toHaveBeenCalledWith(
                newDimensions.width,
                newDimensions.columns,
                newDimensions.rows
            );
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
                apiKey: 'apiKey',
                userKey: 'userKey'
            });

            // Act
            const actual1 = getABVariant(stepRes);
            const actual2 = getABVariant(stepRes);

            // Assert
            expect(actual1).toEqual(actual2);
        });
    });

    describe('getDefaultFieldValues', () => {
        test.each([
            ['checkbox', false],
            ['multiselect', []],
            ['integer_field', ''],
            ['hex_color', '000000'],
            ['select', null],
            ['foobar', '']
        ])(
            'provides the default value for a %s field',
            (fieldType, expectedValue) => {
                // Arrange
                const steps = {
                    step1: {
                        servar_fields: [
                            {
                                servar: {
                                    type: fieldType,
                                    key: 'field'
                                }
                            }
                        ]
                    }
                };

                // Act
                const actual = getDefaultFieldValues(steps);

                // Assert
                expect(actual).toMatchObject({ field: expectedValue });
            }
        );
    });

    describe('nextStepKey', () => {
        it('returns the next step for no condition rules', () => {
            // Arrange
            const nextKey = 'abcdef';
            const trigger = 'trigger';
            const elementType = 'type';
            const elementKey = 'key';
            const conditions = [
                {
                    element_type: elementType,
                    element_key: elementKey,
                    trigger,
                    rules: [],
                    next_step_key: nextKey,
                    metadata: {}
                }
            ];

            // Act
            const actual = nextStepKey(conditions, {
                elementType,
                elementKey,
                trigger
            });

            // Assert
            expect(actual).toEqual(nextKey);
        });

        it('returns the next step for a single condition rule', () => {
            // Arrange
            const nextKey = 'abcdef';
            const trigger = 'trigger';
            const elementType = 'type';
            const elementKey = 'key';
            const conditions = [
                {
                    element_type: elementType,
                    element_key: elementKey,
                    trigger,
                    rules: [
                        {
                            key: 'rule-key',
                            value: 'rule-value',
                            comparison: 'equal'
                        }
                    ],
                    next_step_key: nextKey,
                    metadata: {}
                }
            ];
            const fieldValues = {
                'rule-key': 'rule-value'
            };

            // Act
            const actual = nextStepKey(
                conditions,
                {
                    elementType,
                    elementKey,
                    trigger
                },
                null,
                fieldValues
            );

            // Assert
            expect(actual).toEqual(nextKey);
        });

        it('returns the next step for a single array-based condition rule', () => {
            // Arrange
            const nextKey = 'abcdef';
            const trigger = 'trigger';
            const elementType = 'type';
            const elementKey = 'key';
            const conditions = [
                {
                    element_type: elementType,
                    element_key: elementKey,
                    trigger,
                    rules: [
                        {
                            key: 'rule-key',
                            value: 'rule-value',
                            comparison: 'equal'
                        }
                    ],
                    next_step_key: nextKey,
                    metadata: {}
                }
            ];
            const fieldValues = {
                'rule-key': ['rule-value', 'not-rule-value']
            };

            // Act
            const actual = nextStepKey(
                conditions,
                {
                    elementType,
                    elementKey,
                    trigger
                },
                null,
                fieldValues
            );

            // Assert
            expect(actual).toEqual(nextKey);
        });

        it('returns the next step for multiple condition rules', () => {
            // Arrange
            const nextKey = 'abcdef';
            const trigger = 'trigger';
            const elementType = 'type';
            const elementKey = 'key';
            const conditions = [
                {
                    element_type: elementType,
                    element_key: elementKey,
                    trigger,
                    rules: [
                        {
                            key: 'rule-key',
                            value: 'rule-value',
                            comparison: 'equal'
                        },
                        {
                            key: 'rule-key',
                            value: 'not-rule-value',
                            comparison: 'not_equal'
                        }
                    ],
                    next_step_key: nextKey,
                    metadata: {}
                }
            ];
            const fieldValues = {
                'rule-key': 'rule-value'
            };

            // Act
            const actual = nextStepKey(
                conditions,
                {
                    elementType,
                    elementKey,
                    trigger
                },
                null,
                fieldValues
            );

            // Assert
            expect(actual).toEqual(nextKey);
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
            const expected = 'step1';

            // Act
            const actual = getOrigin(steps);

            // Assert
            expect(actual).toEqual(expected);
        });
    });

    describe('recurseDepth', () => {
        it('calculates depth for one node, no branches', () => {
            // Arrange
            const originStepKey = 'step1';
            const currentStepKey = 'step1';
            const steps = {
                step1: {
                    key: 'step1',
                    next_conditions: []
                }
            };
            const expected = [0, 0];

            // Act
            const actual = recurseDepth(steps, originStepKey, currentStepKey);

            // Assert
            expect(actual).toEqual(expected);
        });

        it('calculates depth for two nodes, one branch', () => {
            // Arrange
            const originStepKey = 'step1';
            const currentStepKey = 'step2';
            const steps = {
                step1: {
                    key: 'step1',
                    next_conditions: [
                        {
                            next_step_key: 'step2'
                        }
                    ]
                },
                step2: {
                    key: 'step2',
                    next_conditions: []
                }
            };
            const expected = [1, 1];

            // Act
            const actual = recurseDepth(steps, originStepKey, currentStepKey);

            // Assert
            expect(actual).toEqual(expected);
        });

        it('calculates depth for multiple nodes, multiple branchs', () => {
            // Arrange
            const originStepKey = 'step1';
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
                    ]
                },
                step2: {
                    key: 'step2',
                    next_conditions: []
                },
                step3: {
                    key: 'step3',
                    next_conditions: [
                        {
                            next_step_key: 'step4'
                        }
                    ]
                },
                step4: {
                    key: 'step4',
                    next_conditions: []
                }
            };
            const expected = [1, 2];

            // Act
            const actual = recurseDepth(steps, originStepKey, currentStepKey);

            // Assert
            expect(actual).toEqual(expected);
        });
    });
});
