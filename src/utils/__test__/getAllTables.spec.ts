import { getAllTables } from '../fieldHelperFunctions';

jest.mock('../formHelperFunctions', () => ({ rerenderAllForms: jest.fn() }));

describe('getAllTables', () => {
  it('builds entities keyed by name, skipping keyless (legacy) tables', () => {
    const tables = getAllTables(
      [
        { id: 'id_a', key: 'orders' },
        { id: 'id_b' }, // legacy / unnamed
        { id: 'id_c', key: 'users' }
      ],
      'form_1'
    );
    expect(Object.keys(tables).sort()).toEqual(['orders', 'users']);
    expect(tables.orders.id).toBe('id_a');
    expect(tables.users.id).toBe('id_c');
  });
});
