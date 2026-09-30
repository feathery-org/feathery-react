import { asciiElement } from '../asciiOptions';
import {
  clearOptionLabels,
  getOptionLabel,
  registerOptionLabels
} from '../optionLabels';
import {
  getStateOptions,
  hasState
} from '../../elements/components/data/states';

describe('ASCII field options', () => {
  beforeEach(clearOptionLabels);

  it('resolves original option labels after normalization and dynamic option updates', () => {
    registerOptionLabels(
      { key: 'state', type: 'dropdown', metadata: { options: ['São Paulo'] } },
      {},
      true
    );
    expect(getOptionLabel('state', 'Sao Paulo')).toBe('São Paulo');
    registerOptionLabels({
      key: 'state',
      type: 'dropdown',
      metadata: { options: ['Pará'], option_labels: ['Custom'] }
    });
    expect(getOptionLabel('state', 'Para')).toBe('Custom');
    registerOptionLabels(
      {
        key: 'state',
        type: 'dropdown',
        metadata: { options: ['Pará'], option_labels: ['Custom'] }
      },
      {},
      false
    );
    expect(getOptionLabel('state', 'Para')).toBeUndefined();
  });
  const element = {
    servar: {
      type: 'dropdown',
      metadata: {
        options: ['São Paulo', 'Pará'],
        option_labels: ['', 'Custom label'],
        repeat_options: [
          ['Ceará', { value: 'İstanbul', label: 'City', tooltip: 'Tip' }]
        ]
      }
    }
  };

  it('keeps original labels while converting option values without changing the schema', () => {
    const result = asciiElement(element, true);
    expect(result.servar.metadata.options).toEqual(['Sao Paulo', 'Para']);
    expect(result.servar.metadata.option_labels).toEqual([
      'São Paulo',
      'Custom label'
    ]);
    expect(result.servar.metadata.repeat_options).toEqual([
      [
        { value: 'Ceara', label: 'Ceará' },
        { value: 'Istanbul', label: 'City', tooltip: 'Tip' }
      ]
    ]);
    expect(element.servar.metadata.options).toEqual(['São Paulo', 'Pará']);
  });

  it('keeps existing behavior when disabled and leaves file metadata alone', () => {
    expect(asciiElement(element, false)).toBe(element);
    const file = { servar: { ...element.servar, type: 'file_upload' } };
    expect(asciiElement(file, true)).toBe(file);
  });

  it('recognizes ASCII state values and renders selectable ASCII options', () => {
    expect(hasState('br', 'Sao Paulo', false, false, true)).toBe(true);
    expect(hasState('br', 'Sao Paulo', false)).toBe(false);
    const option = getStateOptions('br', false, false, true).find(
      (option) => option.props.value === 'Sao Paulo'
    );
    expect(option?.props.children).toBe('São Paulo');
  });
});
