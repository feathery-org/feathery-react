import { calculateDimensions, calculateRepeatedRowCount } from '../hydration';

describe('hydration', () => {
    describe('calculateDimensions', () => {
        it('calculates dimensions on a mobile screen', () => {
            // Arrange
            const inputStep = {
                repeat_row_start: 2,
                repeat_row_end: 3,
                texts: [
                    {
                        text: 'First text field {{foobar}}',
                        row_index: 1,
                        row_index_end: 1,
                        column_index: 2,
                        column_index_end: 2
                    }
                ],
                buttons: [
                    {
                        text: 'First button field {{foobar}}',
                        row_index: 1,
                        row_index_end: 1,
                        column_index: 2,
                        column_index_end: 2
                    }
                ],
                servar_fields: [],
                images: [],
                grid_rows: ['50px', '150px', '50px'],
                grid_columns: ['150px', '50px', '20px'],
                progress_bar: {
                    column_index: 0
                }
            };
            window.innerWidth = 500;
            const expected = {
                width: 40,
                columns: ['25%', '25%', '50%'],
                rows: [
                    'minmax(50px,min-content)',
                    'minmax(150px,min-content)',
                    'minmax(50px,min-content)'
                ]
            };

            // Act
            const actual = calculateDimensions(inputStep);

            // Assert
            expect(actual).toMatchObject(expected);
        });

        it('calculates dimensions on a desktop screen', () => {
            // Arrange
            const inputStep = {
                repeat_row_start: 2,
                repeat_row_end: 3,
                texts: [],
                buttons: [],
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
            window.innerWidth = 1024;
            const expected = {
                width: null,
                columns: ['150px', '50%'],
                rows: [
                    'minmax(50px,min-content)',
                    'minmax(150px,min-content)',
                    'minmax(50px,min-content)'
                ]
            };

            // Act
            const actual = calculateDimensions(inputStep);

            // Assert
            expect(actual).toMatchObject(expected);
        });

        it('handles repeating elements', () => {
            // Arrange
            const inputStep = {
                repeat_row_start: 1,
                repeat_row_end: 1,
                texts: [
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
                ],
                buttons: [
                    {
                        text: 'Repeated button field {{foobar}}',
                        column_index: 2,
                        repeat: 0,
                        row_index: 1,
                        row_index_end: 1
                    },
                    {
                        text: 'Repeated button field {{foobar}}',
                        column_index: 2,
                        repeat: 1,
                        row_index: 2,
                        row_index_end: 2
                    },
                    {
                        text: 'Repeated button field {{foobar}}',
                        column_index: 2,
                        repeat: 2,
                        row_index: 3,
                        row_index_end: 3
                    }
                ],
                servar_fields: [],
                images: [],
                grid_rows: ['50px', '150px', '150px', '150px', '50px'],
                grid_columns: ['150px', '50%'],
                progress_bar: {
                    column_index: 0
                }
            };
            window.innerWidth = 1024;
            const expected = {
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

            // Act
            const actual = calculateDimensions(inputStep);

            // Assert
            expect(actual).toMatchObject(expected);
        });
    });

    describe('calculateRepeatedRowCount', () => {
        it('calculates one row', () => {
            // Arrange
            const step = {
                texts: [],
                buttons: [],
                servar_fields: []
            };
            const values = {};
            const expected = 1;

            // Act
            const actual = calculateRepeatedRowCount({ step, values });

            // Assert
            expect(actual).toEqual(expected);
        });

        it('calculates with text fields', () => {
            // Arrange
            const step = {
                repeat_row_start: 0,
                repeat_row_end: 0,
                texts: [
                    {
                        row_index: 0,
                        row_index_end: 0,
                        text: '{{foobar}}'
                    }
                ],
                buttons: [
                    {
                        row_index: 0,
                        row_index_end: 0,
                        text: '{{foobar}}'
                    }
                ],
                servar_fields: []
            };
            const values = {
                foobar: [1, 2, 3]
            };
            const expected = 3;

            // Act
            const actual = calculateRepeatedRowCount({ step, values });

            // Assert
            expect(actual).toEqual(expected);
        });

        it('calculates with servar fields', () => {
            // Arrange
            const step = {
                repeat_row_start: 0,
                repeat_row_end: 0,
                texts: [],
                buttons: [],
                servar_fields: [
                    {
                        servar: {
                            repeated: true,
                            key: 'foobar'
                        }
                    }
                ]
            };
            const values = {
                foobar: [1, 2, 3]
            };
            const expected = 3;

            // Act
            const actual = calculateRepeatedRowCount({ step, values });

            // Assert
            expect(actual).toEqual(expected);
        });

        it('calculates with servar and text fields', () => {
            // Arrange
            const step = {
                repeat_row_start: 0,
                repeat_row_end: 0,
                texts: [
                    {
                        row_index: 0,
                        row_index_end: 0,
                        text: '{{foobar}}'
                    }
                ],
                buttons: [
                    {
                        row_index: 0,
                        row_index_end: 0,
                        text: '{{foobar}}'
                    }
                ],
                servar_fields: [
                    {
                        servar: {
                            repeated: true,
                            key: 'foobar2'
                        }
                    }
                ]
            };
            const values = {
                foobar: [1, 2, 3],
                foobar2: [1, 2]
            };
            const expected = 3;

            // Act
            const actual = calculateRepeatedRowCount({ step, values });

            // Assert
            expect(actual).toEqual(expected);
        });
    });
});
