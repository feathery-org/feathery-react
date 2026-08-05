import { featheryDoc } from '../utils/browser';
import { scrollChatContainerToBottom } from './chatScroll';

describe('assistant chat auto-scroll', () => {
  it('scrolls only the message container when a new message renders', () => {
    const doc = featheryDoc();
    const page = doc.createElement('div');
    const panel = doc.createElement('div');
    const messages = doc.createElement('div');
    page.appendChild(panel);
    panel.appendChild(messages);
    doc.body.appendChild(page);

    page.scrollTop = 431;
    panel.scrollTop = 127;
    messages.scrollTop = 24;
    Object.defineProperty(messages, 'scrollHeight', {
      configurable: true,
      value: 860
    });

    const scrollIntoView = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    scrollChatContainerToBottom(messages);

    expect(messages.scrollTop).toBe(860);
    expect(panel.scrollTop).toBe(127);
    expect(page.scrollTop).toBe(431);
    expect(scrollIntoView).not.toHaveBeenCalled();

    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    page.remove();
  });
});
