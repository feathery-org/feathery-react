import { isAsciiTextField, normalizeAsciiFieldValues, toAscii } from '../ascii';

describe('ASCII form values', () => {
  it.each([
    ['São Paulo, Pará, Ceará', 'Sao Paulo, Para, Ceara'],
    ['İstanbul', 'Istanbul'],
    ['Thành phố Hồ Chí Minh', 'Thanh pho Ho Chi Minh'],
    ['Łódź, Straße, Ærø, Đà Nẵng', 'Lodz, Strasse, AEro, Da Nang'],
    ['“Café” — it’s €5…', '"Cafe" - it\'s 5...'],
    ['ＡＢＣ１２３', 'ABC123'],
    ['line 1\nline 2\t!@#$%', 'line 1\nline 2\t!@#$%'],
    ['東京 😀', ' '],
    ['', '']
  ])('converts %s to ASCII', (value, expected) => {
    expect(toAscii(value)).toBe(expected);
    expect(toAscii(toAscii(value))).toBe(expected);
  });

  const fields = new Map([
    ['city', { type: 'gmap_city' }],
    ['states', { type: 'dropdown_multi' }],
    ['password', { type: 'password' }],
    ['file', { type: 'file_upload' }],
    ['number', { type: 'integer_field' }]
  ]);

  it('converts repeated and multiselect values without changing input arrays', () => {
    const values = { city: 'São Paulo', states: [['Pará', 'Ceará'], null, ''] };
    expect(normalizeAsciiFieldValues(values, fields, true)).toEqual({
      city: 'Sao Paulo',
      states: [['Para', 'Ceara'], null, '']
    });
    expect(values.states[0]).toEqual(['Pará', 'Ceará']);
  });

  it('preserves other fields, non-string values, and forms with the setting off', () => {
    const values = {
      city: null,
      states: [false, 3],
      password: 'sëcret',
      file: 'café.pdf',
      number: 3,
      hidden: 'São Paulo'
    };
    expect(normalizeAsciiFieldValues(values, fields, true)).toEqual(values);
    expect(
      normalizeAsciiFieldValues({ city: 'São Paulo' }, fields, false)
    ).toEqual({ city: 'São Paulo' });
    expect(isAsciiTextField('select')).toBe(true);
    expect(isAsciiTextField('password')).toBe(false);
  });
});
