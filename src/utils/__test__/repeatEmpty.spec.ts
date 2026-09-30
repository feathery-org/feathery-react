import { getVisiblePositions } from '../hideAndRepeats';
import { fieldValues } from '../init';

describe('emptied repeat containers', () => {
  const step = (allowEmpty: boolean) => ({
    subgrids: [
      { id: 'root', position: [], repeated: false, properties: {} },
      {
        id: 'repeat',
        position: [0],
        repeated: true,
        properties: { allow_empty: allowEmpty }
      }
    ],
    servar_fields: [
      {
        position: [0, 0],
        servar: { key: 'repeated-field', repeated: true, metadata: {} }
      }
    ],
    buttons: [],
    texts: []
  });

  it('renders one empty row when the container cannot be emptied', () => {
    Object.assign(fieldValues, { 'repeated-field': [] });
    expect(getVisiblePositions(step(false), 'test')['0'].length).toBe(1);
  });

  it('renders no rows when the container can be emptied', () => {
    Object.assign(fieldValues, { 'repeated-field': [] });
    expect(getVisiblePositions(step(true), 'test')['0'].length).toBe(0);
  });

  it('still renders rows that have values', () => {
    Object.assign(fieldValues, { 'repeated-field': ['a', 'b'] });
    expect(getVisiblePositions(step(true), 'test')['0'].length).toBe(2);
  });
});
