import React from 'react';
import { create, act } from 'react-test-renderer';
import Form from '../Form';

describe('Form', () => {
    it('renders a basic form', async () => {
        // Arrange
        const formKey = 'formKey';
        const displaySteps = {
            step1: {
                key: 'step1',
                origin: true,
                default_background_color: 'FFFFFF',
                text_fields: [],
                images: [],
                servar_fields: [
                    {
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
            displaySteps,
            displayStepKey
        };

        // Act
        let form;
        act(() => (form = create(<Form {...props} />)));
        const tree = form.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });
});
