import { BrowserMod, FormHelperMod, GridMod } from './testMocks';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor
} from '@testing-library/react';
import { JSForm } from '..';
import { fieldValues } from '../../utils/init';
import { runOAuthPopup } from '../../integrations/connectAccount/oauthPopup';

// Mocked at the same boundary as the other third-party integrations (plaid,
// persona, flinks, ...) in testMocks.tsx: Form only needs to know it calls
// runOAuthPopup correctly and reacts to what it resolves/rejects with. The
// popup-blocked / API-call contract itself is oauthPopup's own responsibility
// and is covered by its own spec.
jest.mock('../../integrations/connectAccount/oauthPopup', () => ({
  ACCOUNT_CONNECT_POPUP_NAME: 'feathery-account-connect',
  getPopupFeatures: () => '',
  runOAuthPopup: jest.fn()
}));

// Mocked the same way: this spec is about Form's wiring (does it open the
// modal with the right props, does it advance the flow only from onSaved),
// not the modal's own rendering/accessibility, which has its own spec.
const modalState: { props: any } = { props: null };
jest.mock('../../integrations/connectAccount/ConnectAccountModal', () => ({
  __esModule: true,
  default: (props: any) => {
    modalState.props = props;
    if (!props.show) return null;
    return (
      <div data-testid='connect-account-modal'>
        <button
          data-testid='modal-saved'
          type='button' // prevent implicit form submit
          onClick={() =>
            props.onSaved({
              'feathery.connections.box.email': 'saved@example.com'
            })
          }
        >
          save
        </button>
      </div>
    );
  }
}));

const mockedRunOAuthPopup = runOAuthPopup as jest.Mock;

const EMAIL_KEY = 'feathery.connections.box.email';

describe('connect_account action', () => {
  let fakePopup: { close: jest.Mock };

  const clickTrigger = async () =>
    fireEvent.click(await screen.findByTestId('btn'));

  beforeEach(() => {
    jest.clearAllMocks();
    modalState.props = null;
    delete (fieldValues as any)[EMAIL_KEY];

    fakePopup = { close: jest.fn() };
    BrowserMod._spies.open.mockReturnValue(fakePopup);
    BrowserMod._spies.location.href = 'https://example.com/';

    // Mirrors the real runOAuthPopup contract (reject on a null popup,
    // resolve with account_email otherwise) without exercising its actual
    // postMessage/polling machinery, which belongs to its own test suite.
    mockedRunOAuthPopup.mockImplementation(
      async (_client: any, _provider: string, popup: any) => {
        if (!popup) {
          throw new Error('Please allow pop-ups to connect your account.');
        }
        return { account_email: 'connected@example.com' };
      }
    );

    GridMod._spies.actions = [{ type: 'connect_account', provider: 'box' }];
    GridMod._spies.submit = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the config modal directly when already connected', async () => {
    (fieldValues as any)[EMAIL_KEY] = 'existing@example.com';

    render(<JSForm formId='f1' _internalId='iid-connect-connected' />);
    await clickTrigger();

    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(modalState.props.provider).toBe('box');
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    expect(fakePopup.close).toHaveBeenCalledTimes(1);
  });

  it('runs OAuth first when not connected', async () => {
    render(<JSForm formId='f1' _internalId='iid-connect-new' />);
    await clickTrigger();

    await waitFor(() =>
      expect(mockedRunOAuthPopup).toHaveBeenCalledWith(
        expect.anything(),
        'box',
        fakePopup
      )
    );
    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect((fieldValues as any)[EMAIL_KEY]).toBe('connected@example.com');
  });

  it('surfaces a popup-blocked error without calling the API', async () => {
    BrowserMod._spies.open.mockReturnValue(null);

    render(<JSForm formId='f1' _internalId='iid-connect-blocked' />);
    await clickTrigger();

    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Please allow pop-ups to connect your account.'
        })
      )
    );
    expect(
      GridMod._spies.form.client.startAccountConnect
    ).not.toHaveBeenCalled();
    expect(modalState.props?.show).not.toBe(true);
  });

  it('advances the flow only after config is saved', async () => {
    GridMod._spies.actions = [
      { type: 'connect_account', provider: 'box' },
      {
        type: 'url',
        url: 'https://example.com/after-connect',
        open_tab: false
      }
    ];

    render(<JSForm formId='f1' _internalId='iid-connect-flow' />);
    await clickTrigger();

    await waitFor(() => expect(modalState.props?.show).toBe(true));
    // The next action in the chain (the url redirect) must not have run yet.
    expect(BrowserMod._spies.location.href).toBe('https://example.com/');

    fireEvent.click(screen.getByTestId('modal-saved'));

    await waitFor(() =>
      expect(BrowserMod._spies.location.href).toBe(
        'https://example.com/after-connect'
      )
    );
    expect((fieldValues as any)[EMAIL_KEY]).toBe('saved@example.com');
  });
});
