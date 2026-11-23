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

// getFilenameFromUrl covers the decoding cases; these pin the toast's own
// wiring: source URLs get decoded, direct upload labels stay literal.
describe('processing toast filenames', () => {
  it.each([
    ['003_%E7%99%BB%E9%8C%B2%E6%9B%B8.pdf', '003_登録書.pdf'],
    ['a%3Fb%23c.pdf?signature=x', 'a?b#c.pdf'],
    ['bad%E7.pdf', 'bad%E7.pdf']
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
