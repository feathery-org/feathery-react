import { customFileTypeTokens, resolveAllowedFileTypes } from '../validation';

describe('customFileTypeTokens', () => {
  it('lists each extension once, lowercase, with one leading dot', () => {
    expect(
      customFileTypeTokens(['xlsx', 'csv', 'XLSX', '.Pdf', ' .', 123])
    ).toEqual(['.xlsx', '.csv', '.pdf', '.123']);
  });

  it('skips null and boolean entries', () => {
    expect(customFileTypeTokens([null, undefined, true, 'zip'])).toEqual([
      '.zip'
    ]);
  });
});

describe('resolveAllowedFileTypes', () => {
  it('appends normalized custom types to the file type bundles', () => {
    const servar = {
      metadata: { file_types: ['image/*'], custom_file_types: ['XLSX', 'xlsx'] }
    };

    expect(resolveAllowedFileTypes(servar)).toEqual(['image/*', '.xlsx']);
  });
});
