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

describe('mountRobinDocument: the session is created on first use (review)', () => {
  it('mounting reads nothing and routes no keys; the first liveDocument read creates the session and its undo route', () => {
    const editor = fakeEditor();
    const off = mountRobinDocument({
      formKey: 'form-rd-1',
      slot: 'c1',
      editor,
      envelopeId: 'env'
    });
    expect(editor.serialize).not.toHaveBeenCalled();
    expect(historyRouteFor(editor)).toBeUndefined();
    // the rail can ask about Robin's cards from the start
    expect(cardResolverFor(editor)).toBeDefined();

    expect(liveDocumentAccessor('form-rd-1').descriptor()).toEqual(
      expect.objectContaining({ target: { type: 'envelope', id: 'env' } })
    );
    expect(editor.serialize).toHaveBeenCalled();
    expect(historyRouteFor(editor)).toBeDefined();

    off();
    expect(historyRouteFor(editor)).toBeUndefined();
    expect(cardResolverFor(editor)).toBeUndefined();
    expect(liveDocumentAccessor('form-rd-1').descriptor()).toBeNull();
  });

  it('the rail asking about a Robin card creates the session, so a reloaded document keeps its engine-owned cards', () => {
    const editor = fakeEditor();
    const off = mountRobinDocument({
      formKey: 'form-rd-2',
      slot: 'c1',
      editor,
      envelopeId: 'env'
    });
    expect(cardResolverFor(editor)?.owns('turn-from-before-the-reload')).toBe(
      false
    );
    expect(editor.serialize).toHaveBeenCalled();
    expect(historyRouteFor(editor)).toBeDefined();
    off();
  });
});
