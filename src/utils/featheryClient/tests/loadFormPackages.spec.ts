// Imported through index.ts for the same two-file-cycle reason documented in
// integrationClient.spec.ts.
import FeatheryClient from '../index';
import { featheryDoc } from '../../browser';

jest.mock('../../init', () => ({
  initInfo: jest.fn(() => ({ sdkKey: 'sdkKey', userId: 'userId' })),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {} },
  fieldValues: {},
  filePathMap: {}
}));

describe('FeatheryClient._loadFormPackages uploaded fonts', () => {
  const created: { family: string; weight: any; style: any }[] = [];

  beforeEach(() => {
    created.length = 0;
    // jsdom has no FontFace; record constructions instead of loading
    (global as any).FontFace = class {
      constructor(family: string, _source: string, descriptors: any) {
        created.push({ family, ...descriptors });
      }

      load() {
        return Promise.resolve(this);
      }
    };
  });

  afterEach(() => {
    delete (global as any).FontFace;
    delete (featheryDoc() as any).fonts;
  });

  const packages = (uploadedFonts: any) => ({
    fonts: [],
    steps: [],
    uploaded_fonts: uploadedFonts
  });

  it('loads uploaded fonts the host page has not declared', () => {
    // Arrange
    (featheryDoc() as any).fonts = new Set();
    const client = new FeatheryClient('form-key') as any;

    // Act
    client._loadFormPackages(
      packages({
        Inter: [
          {
            source: 'https://cdn.test/inter-400.woff2',
            style: 'normal',
            weight: 400
          },
          {
            source: 'https://cdn.test/inter-700.woff2',
            style: 'normal',
            weight: 700
          }
        ]
      })
    );

    // Assert
    expect(created).toEqual([
      { family: 'Inter', style: 'normal', weight: 400 },
      { family: 'Inter', style: 'normal', weight: 700 }
    ]);
  });

  it('skips only the uploaded variants the host page already declared', () => {
    // Arrange — host declares Inter 400 normal but not 700
    (featheryDoc() as any).fonts = new Set([
      { family: 'Inter', weight: '400', style: 'normal' }
    ]);
    const client = new FeatheryClient('form-key') as any;

    // Act
    client._loadFormPackages(
      packages({
        Inter: [
          {
            source: 'https://cdn.test/inter-400.woff2',
            style: 'normal',
            weight: 400
          },
          {
            source: 'https://cdn.test/inter-700.woff2',
            style: 'normal',
            weight: 700
          }
        ]
      })
    );

    // Assert
    expect(created).toEqual([
      { family: 'Inter', style: 'normal', weight: 700 }
    ]);
  });
});
