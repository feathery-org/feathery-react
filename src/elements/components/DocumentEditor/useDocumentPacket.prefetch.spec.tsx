import { act, renderHook, waitFor } from '@testing-library/react';
import { useDocumentPacket } from './useDocumentPacket';

it('reuses a prefetched envelope URL when an unresolved tab is selected', async () => {
  let secondLookups = 0;
  const load = jest.fn(async (documentId: string) => ({
    id: `envelope-${documentId}`,
    document: documentId,
    file: `/${documentId}-${
      documentId === 'second' ? ++secondLookups : 1
    }.pptx`,
    type: 'pptx',
    signed: false
  }));
  const { result } = renderHook(() =>
    useDocumentPacket({
      containerId: 'prefetch-test',
      documents: ['first', 'second'],
      load,
      beforeReplace: async () => {},
      saveOnSwitch: false
    })
  );
  await waitFor(() =>
    expect(result.current.envelope?.id).toBe('envelope-first')
  );
  const nextTab = result.current.tabs[1];
  const prepared = await result.current.resolveTabEnvelope(nextTab);
  await act(async () => result.current.selectTab(nextTab.id));
  expect(load.mock.calls.filter(([id]) => id === 'second')).toHaveLength(1);
  expect(result.current.envelope?.file).toBe(prepared?.file);
});
