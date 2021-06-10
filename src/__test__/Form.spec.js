import React from 'react';
import { create, act } from 'react-test-renderer';
import Form from '../Form';

describe('Form', () => {
    it('renders a basic form', async () => {
        // Arrange
        const formKey = 'formKey';
        const className = 'form-class';
        const displaySteps = {
            step1: {
                key: 'step1',
                repeat_row_start: null,
                repeat_row_end: null,
                origin: true,
                default_background_color: 'FFFFFF',
                texts: [],
                buttons: [],
                images: [],
                servar_fields: [
                    {
                        column_index: 0,
                        row_index: 0,
                        column_index_end: 0,
                        row_index_end: 0,
                        layout: 'center',
                        vertical_layout: 'center',
                        font_color: '000000',
                        font_italic: false,
                        font_weight: 400,
                        font_family: 'monospace',
                        font_size: 12,
                        padding_top: 8,
                        padding_right: 8,
                        padding_bottom: 8,
                        padding_left: 8,
                        servar: {
                            key: 'key1',
                            type: 'checkbox',
                            name: 'Checkbox 1',
                            metadata: {}
                        }
                    }
                ],
                next_conditions: [],
                grid_rows: ['500px'],
                grid_columns: ['500px']
            }
        };
        const displayStepKey = 'step1';
        const props = {
            formKey,
            className,
            displaySteps,
            displayStepKey
        };

        // Act
        let form;
        act(() => {
            form = create(<Form {...props} />);
        });
        const tree = form.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });
});
