import {
  loadReviewPrinter,
  printFinalizedFiles,
  PRINT_FAILED_ERROR,
  PRINT_NO_FILES_ERROR
} from '../reviewPrint';
import { loadPrinter } from '../../elements/components/DocumentViewer/print';

jest.mock('../../elements/components/DocumentViewer/print', () => ({
  loadPrinter: jest.fn()
}));

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('loadReviewPrinter', () => {
  it('resolves the printer', async () => {
    const printer = jest.fn();
    (loadPrinter as jest.Mock).mockResolvedValue(printer);
    await expect(loadReviewPrinter()).resolves.toBe(printer);
  });

  it('resolves null when printing cannot load', async () => {
    (loadPrinter as jest.Mock).mockRejectedValue(new Error('blocked'));
    await expect(loadReviewPrinter()).resolves.toBeNull();
  });
});

describe('printFinalizedFiles', () => {
  it('prints the files', async () => {
    const printer = jest.fn().mockResolvedValue(undefined);
    await expect(printFinalizedFiles(printer, ['a.pdf'])).resolves.toBeNull();
    expect(printer).toHaveBeenCalledWith(['a.pdf']);
  });

  it('leaves out unprintable files, however their URLs were signed', async () => {
    const printer = jest.fn().mockResolvedValue(undefined);
    await printFinalizedFiles(
      printer,
      ['http://s3/a.pdf?sig=2', 'http://s3/b.zip?sig=2'],
      ['http://s3/b.zip?sig=1']
    );
    expect(printer).toHaveBeenCalledWith(['http://s3/a.pdf?sig=2']);

    await expect(
      printFinalizedFiles(printer, ['http://s3/b.zip'], ['http://s3/b.zip'])
    ).resolves.toBe(PRINT_NO_FILES_ERROR);
    expect(printer).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, []])(
    'reports that there is nothing to print for files %p',
    async (files) => {
      const printer = jest.fn();
      await expect(printFinalizedFiles(printer, files)).resolves.toBe(
        PRINT_NO_FILES_ERROR
      );
      expect(printer).not.toHaveBeenCalled();
    }
  );

  it('reports a failed print instead of throwing', async () => {
    const printer = jest.fn().mockRejectedValue(new Error('403'));
    await expect(printFinalizedFiles(printer, ['a.pdf'])).resolves.toBe(
      PRINT_FAILED_ERROR
    );
  });
});
