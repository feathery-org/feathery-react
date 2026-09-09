import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import ToastItem from './ToastItem';

// Jest's classic JSX transform requires React for fragments in imported files.
const originalReact = (globalThis as any).React;
beforeAll(() => {
  (globalThis as any).React = React;
});
afterAll(() => {
  (globalThis as any).React = originalReact;
});

afterEach(cleanup);

describe('processing toast filenames', () => {
  it.each([
    ['003_%E7%99%BB%E9%8C%B2%E6%9B%B8.pdf', '003_登録書.pdf'],
    ['caf%C3%A9%20%26%20%E6%9B%B8%E9%A1%9E.pdf', 'café & 書類.pdf'],
    ['%F0%9F%93%84.pdf', '📄.pdf'],
    ['登録書.pdf', '登録書.pdf'],
    ['100%25%20complete.pdf', '100% complete.pdf'],
    ['literal%2520name.pdf', 'literal%20name.pdf'],
    ['bad%ZZ.pdf', 'bad%ZZ.pdf'],
    ['bad%E7.pdf', 'bad%E7.pdf'],
    ['a+b.pdf', 'a+b.pdf'],
    ['report.pdf?signature=a/b#page=1', 'report.pdf'],
    ['a%3Fb%23c.pdf?signature=x', 'a?b#c.pdf']
  ])('displays %s as %s', (path, filename) => {
    render(
      <ToastItem
        item={{
          id: 'run',
          variantId: '',
          status: 'incomplete',
          extractionKey: 'Bank Form Extraction',
          fileSources: [
            { id: 'file', path: '', url: `https://files.test/${path}` }
          ]
        }}
      />
    );

    expect(screen.getByText(`(${filename})`)).toBeInTheDocument();
  });

  it('preserves literal percent sequences in direct upload labels', () => {
    render(
      <ToastItem
        item={{
          id: 'upload',
          variantId: '',
          status: 'incomplete',
          label: '登録%20.pdf'
        }}
      />
    );
    expect(screen.getByText('登録%20.pdf')).toBeInTheDocument();
  });
});
