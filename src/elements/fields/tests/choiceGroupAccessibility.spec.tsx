import React from 'react';
import { render, screen, within } from '@testing-library/react';
import {
  createBaseElement,
  createFieldProps
} from '../shared/tests/field-test-utils';
import CheckboxGroupField from '../CheckboxGroupField';
import RadioButtonGroupField from '../RadioButtonGroupField';

jest.mock('../../../hooks/useSalesforceSync', () => ({
  __esModule: true,
  default: () => ({
    dynamicOptions: [],
    loadingDynamicOptions: false,
    shouldSalesforceSync: false
  })
}));

jest.mock('../../components/InlineTooltip', () => () => null);

describe.each`
  type             | Field                    | groupRole       | optionRole
  ${'select'}      | ${RadioButtonGroupField} | ${'radiogroup'} | ${'radio'}
  ${'multiselect'} | ${CheckboxGroupField}    | ${'group'}      | ${'checkbox'}
`(
  '$type option accessibility and custom styling',
  ({ type, Field, groupRole, optionRole }) => {
    const createElement = () =>
      createBaseElement(
        'intake-choice',
        type,
        { options: ['yes', 'no'], option_labels: ['Yes', 'No'] },
        { aria_label: 'Intake choice' }
      );

    it('preserves custom CSS selectors while naming each option and describing errors once', () => {
      const element = createElement();
      const props = createFieldProps(element, {
        errorAttributes: {
          'aria-invalid': true,
          'aria-describedby': 'choice-error'
        }
      });
      const { container } = render(
        <>
          <span id='choice-error'>Choose an option</span>
          <Field {...props} />
        </>
      );

      // Existing customer styles select option labels through the input's aria-label.
      const styledLabels = container.querySelectorAll<HTMLLabelElement>(
        'label:has([aria-label^="Intake"])'
      );
      expect(styledLabels).toHaveLength(2);
      ['Yes', 'No'].forEach((name, index) => {
        const option = within(styledLabels[index]).getByRole(optionRole, {
          name
        });
        expect(option).toHaveAttribute('aria-label', 'Intake choice');
        expect(option).not.toHaveAttribute('aria-invalid');
        expect(option).not.toHaveAttribute('aria-describedby');
      });
      const group = screen.getByRole(groupRole, { name: 'Intake choice' });
      expect(group).toHaveAttribute('aria-invalid', 'true');
      expect(group).toHaveAccessibleDescription('Choose an option');
    });

    it('keeps repeated options associated with their own visible labels', () => {
      const element = createElement();
      element.servar.metadata.repeat_options = [
        [{ value: 'yes', label: 'First row choice' }],
        [{ value: 'yes', label: 'Second row choice' }]
      ];
      render(
        <>
          <Field {...createFieldProps(element, { repeatIndex: 0 })} />
          <Field {...createFieldProps(element, { repeatIndex: 1 })} />
        </>
      );

      const groups = screen.getAllByRole(groupRole, { name: 'Intake choice' });
      expect(
        within(groups[0]).getByRole(optionRole, { name: 'First row choice' })
      ).toBeInTheDocument();
      expect(
        within(groups[1]).getByRole(optionRole, { name: 'Second row choice' })
      ).toBeInTheDocument();
    });
  }
);
