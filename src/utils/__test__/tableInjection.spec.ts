import { getInjectableTables } from '../../Form/logic';

describe('getInjectableTables', () => {
  const fields = { email: {}, age: {} } as any;

  it('includes valid-identifier table names', () => {
    const tables = { orders: { id: 'a' }, users: { id: 'b' } } as any;
    expect(Object.keys(getInjectableTables(tables, fields)).sort()).toEqual(['orders', 'users']);
  });

  it('drops names colliding with a field (field wins the bare global)', () => {
    const tables = { email: { id: 'a' }, orders: { id: 'b' } } as any;
    expect(Object.keys(getInjectableTables(tables, fields))).toEqual(['orders']);
  });

  it('drops invalid identifiers', () => {
    const tables = { 'bad-name': { id: 'a' }, good: { id: 'b' } } as any;
    expect(Object.keys(getInjectableTables(tables, fields))).toEqual(['good']);
  });
});
