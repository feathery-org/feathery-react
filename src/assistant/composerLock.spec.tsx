// The composer must refuse a new message while a turn is running.
//
// Every other control in the composer already takes `isLoading`
// (`status === 'submitted' || status === 'streaming'`): the attach button, the
// send button, the mic, the workflow chips. The text input did not, so it kept
// inviting typing into a send that `handleSend` would refuse anyway - the user
// only found out after pressing Enter and watching nothing happen.
//
// These tests pin the input's own state first - readOnly, aria-disabled, and
// the draft it is holding - because that is the behaviour. The grey is checked
// separately at the bottom, once, since a lock the user cannot see is only half
// the feature.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';

// `status` is the only thing these tests vary, so it lives outside the factory
// and each test sets it before rendering.
const chatState = { status: 'ready' as string };

jest.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage: jest.fn(),
    setMessages: jest.fn(),
    status: chatState.status,
    error: null
  }),
  Chat: class {
    messages: any[] = [];
    addToolOutput = jest.fn();
  }
}));

jest.mock('ai', () => ({
  DefaultChatTransport: jest.fn(),
  lastAssistantMessageIsCompleteWithToolCalls: jest.fn(() => false)
}));

// Network on mount: the semantic-index POST and the thread list. Neither has
// anything to do with the composer.
jest.mock('./tools/docx/documentIndex', () => ({
  ENVELOPE_TARGET_TYPE: 'envelope',
  getDocumentTargetContentHash: () => undefined,
  useDocumentIndex: () => undefined
}));
jest.mock('./utils', () => ({
  deleteThread: jest.fn(),
  generateThreadTitle: jest.fn(() => Promise.resolve(null)),
  getThreadDetail: jest.fn(() => Promise.resolve(null)),
  getThreadList: jest.fn(() => Promise.resolve([]))
}));
jest.mock('../Form/logic', () => ({ runLogicRuleById: jest.fn() }));
// Message rendering pulls in `streamdown`, which ships ESM only. No message is
// rendered in these tests.
jest.mock('./MarkdownText', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children ?? null
}));

// Voice swaps the input out for a status pill; `voiceState` picks the branch.
const voiceState = { current: 'idle' as string };
jest.mock('./voice/useAssistantVoice', () => ({
  useAssistantVoice: () => ({
    voiceState: voiceState.current,
    voiceActive:
      voiceState.current !== 'idle' && voiceState.current !== 'error',
    micAvailable: true,
    spokenChars: 0,
    audioDraining: false,
    startVoice: jest.fn(),
    stopVoice: jest.fn(),
    skipSpeaking: jest.fn()
  })
}));

// eslint-disable-next-line import/first
import AssistantChat from './AssistantChat';

const PLACEHOLDER = 'Type a message...';

// The chat mounts collapsed to a FAB; the composer only exists once it is open.
const openComposer = () => {
  const utils = render(
    <AssistantChat
      instanceId='form-1'
      baseUrl='https://example.test/api/'
      getTargets={() => []}
      getJwt={() => 'jwt'}
    />
  );
  act(() => {
    fireEvent.click(utils.container.querySelector('button') as HTMLElement);
  });
  return utils;
};

const composerInput = (utils: ReturnType<typeof render>) =>
  utils.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;

beforeEach(() => {
  chatState.status = 'ready';
  voiceState.current = 'idle';
});

describe('composer input lock while the assistant is working', () => {
  test('an idle chat leaves the input open for typing', () => {
    const utils = openComposer();
    const input = composerInput(utils);

    expect(input.readOnly).toBe(false);
    expect(input.getAttribute('aria-disabled')).toBe('false');

    fireEvent.change(input, { target: { value: 'hello' } });
    expect(input.value).toBe('hello');
  });

  test.each(['submitted', 'streaming'])(
    'a %s turn locks the input against typing',
    (status) => {
      chatState.status = status;
      const utils = openComposer();
      const input = composerInput(utils);

      expect(input.readOnly).toBe(true);
      expect(input.getAttribute('aria-disabled')).toBe('true');
      // Locked, not removed: a screen reader still finds the composer and is
      // told it is unavailable, which `disabled` would not do - it drops the
      // field out of the tab order with nothing left to announce.
      expect(input.disabled).toBe(false);
      expect(input.placeholder).toBe(PLACEHOLDER);
    }
  );

  test('an error state leaves the input open so the user can retry', () => {
    chatState.status = 'error';
    const utils = openComposer();

    expect(composerInput(utils).readOnly).toBe(false);
  });

  test('a draft typed before the turn started survives the lock', () => {
    const utils = openComposer();
    fireEvent.change(composerInput(utils), { target: { value: 'half a th' } });

    // A turn can start without this draft being sent - a workflow chip, or a
    // voice turn. The lock must not cost the user what they had typed.
    chatState.status = 'streaming';
    utils.rerender(
      <AssistantChat
        instanceId='form-1'
        baseUrl='https://example.test/api/'
        getTargets={() => []}
        getJwt={() => 'jwt'}
      />
    );

    const locked = composerInput(utils);
    expect(locked.readOnly).toBe(true);
    expect(locked.value).toBe('half a th');

    chatState.status = 'ready';
    utils.rerender(
      <AssistantChat
        instanceId='form-1'
        baseUrl='https://example.test/api/'
        getTargets={() => []}
        getJwt={() => 'jwt'}
      />
    );

    const released = composerInput(utils);
    expect(released.readOnly).toBe(false);
    expect(released.value).toBe('half a th');
  });

  test('voice mode renders its own control, so the lock cannot reach it', () => {
    voiceState.current = 'listening';
    chatState.status = 'streaming';
    const utils = openComposer();

    // The text input is not in the tree at all in voice mode; the pill that
    // replaces it is untouched by this change.
    expect(utils.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
    expect(utils.getByText('Listening…')).toBeTruthy();
  });
});

// The grey is emotion CSS keyed off the same attribute, so it is worth proving
// the rule actually lands rather than trusting that it was written.
describe('the locked input reads as greyed out', () => {
  test('a streaming turn paints the muted fill and the not-allowed cursor', () => {
    chatState.status = 'streaming';
    const utils = openComposer();
    const style = getComputedStyle(composerInput(utils));

    expect(style.cursor).toBe('not-allowed');
    // GRAY_100 / GRAY_500 from ./colors - the composer's existing disabled
    // vocabulary, not a new grey.
    expect(style.backgroundColor).toBe('rgb(243, 244, 246)');
    expect(style.color).toBe('rgb(107, 114, 128)');
  });

  test('an idle turn paints none of it', () => {
    const utils = openComposer();
    const style = getComputedStyle(composerInput(utils));

    expect(style.cursor).not.toBe('not-allowed');
    expect(style.backgroundColor).not.toBe('rgb(243, 244, 246)');
  });
});
