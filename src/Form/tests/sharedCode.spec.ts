import { extractExportedCodeInfoArray } from '../logic';

describe('extractExportedCodeInfoArray', () => {
  it('keeps shared code whose stored valid flag is false', () => {
    const extracted = extractExportedCodeInfoArray([
      {
        key: 'helpers',
        code: "export function greet() { return 'hi'; }",
        valid: false
      } as any
    ]);
    expect(extracted.map((info) => info.key)).toEqual(['helpers']);
    expect(extracted[0].exportFunctions.map((f) => f.name)).toEqual(['greet']);
  });
});
