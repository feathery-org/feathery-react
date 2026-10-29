import {
  cardResolverFor,
  historyRouteFor,
  liveDocumentAccessor
} from '../../../robin/document/mounts';
import { mountRobinDocument } from './robinDocument';

const SFDT = JSON.stringify({
  sections: [{ blocks: [{ inlines: [{ text: 'Hello' }] }] }]
});

function fakeEditor() {
  return {
    serialize: jest.fn(() => SFDT),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn()
  } as any;
}

describe('mountRobinDocument: where the Robin host is mounted, the session is created at open (review)', () => {
  it('mounting reads the document once and routes its keys; unmount removes everything', () => {
    const editor = fakeEditor();
    const off = mountRobinDocument({
      formKey: 'form-rd-1',
      slot: 'c1',
      editor,
      envelopeId: 'env'
    });
    expect(editor.serialize).toHaveBeenCalledTimes(1);
    expect(historyRouteFor(editor)).toBeDefined();
    expect(cardResolverFor(editor)).toBeDefined();
    // the rail asking about a card never builds anything mid-keystroke: the session exists
    expect(cardResolverFor(editor)?.owns('turn-from-before-the-reload')).toBe(
      false
    );
    expect(editor.serialize).toHaveBeenCalledTimes(1);
    expect(liveDocumentAccessor('form-rd-1').descriptor()).toEqual(
      expect.objectContaining({ target: { type: 'envelope', id: 'env' } })
    );
    off();
    expect(historyRouteFor(editor)).toBeUndefined();
    expect(cardResolverFor(editor)).toBeUndefined();
    expect(liveDocumentAccessor('form-rd-1').descriptor()).toBeNull();
  });
});
