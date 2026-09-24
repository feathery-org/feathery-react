import { BrowserMod, ClientMod, FormHelperMod, GridMod } from './testMocks';
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor
} from '@testing-library/react';
import { JSForm } from '..';
import { fieldValues } from '../../utils/init';
import { runOAuthPopup } from '../../integrations/connectAccount/oauthPopup';
import { verifyAlloyId } from '../../integrations/alloy';

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
// Records what Form's onChangeAccount prop actually does when invoked -
// resolves with a message, resolves with nothing, or (a bug) rejects - so a
// test can assert it never rejects (an unhandled promise rejection with no
// user-facing feedback) even when the re-auth popup is blocked.
const changeAccountOutcome: { status: string; value?: any } = {
  status: 'idle'
};
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
        <button
          data-testid='modal-change-account'
          type='button' // prevent implicit form submit
          onClick={() => {
            props.onChangeAccount().then(
              (value: any) => {
                changeAccountOutcome.status = 'resolved';
                changeAccountOutcome.value = value;
              },
              (error: any) => {
                changeAccountOutcome.status = 'rejected';
                changeAccountOutcome.value = error;
              }
            );
          }}
        >
          change account
        </button>
      </div>
    );
  }
}));

const mockedRunOAuthPopup = runOAuthPopup as jest.Mock;
const mockedVerifyAlloyId = verifyAlloyId as jest.Mock;

const EMAIL_KEY = 'feathery.connections.box.email';
const FOLDER_KEY = 'feathery.connections.box.folder_id';
const SCHWAB_KEY = 'feathery.connections.charles-schwab.connected';
const DROPBOX_KEY = 'feathery.connections.dropbox.email';

describe('connect_account action', () => {
  let fakePopup: { close: jest.Mock };

  const clickTrigger = async () =>
    fireEvent.click(await screen.findByTestId('btn'));

  beforeEach(() => {
    jest.clearAllMocks();
    ClientMod._spies.state.authSensitiveActionsOnly = false;
    modalState.props = null;
    changeAccountOutcome.status = 'idle';
    changeAccountOutcome.value = undefined;
    delete (fieldValues as any)[EMAIL_KEY];
    delete (fieldValues as any)[SCHWAB_KEY];
    delete (fieldValues as any)[DROPBOX_KEY];

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
    ClientMod._spies.state.authSensitiveActionsOnly = false;
    cleanup();
  });

  it('opens the config modal directly when already connected', async () => {
    (fieldValues as any)[EMAIL_KEY] = 'existing@example.com';

    render(<JSForm formId='f1' _internalId='iid-connect-connected' />);
    await clickTrigger();

    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(modalState.props.provider).toBe('box');
    expect(modalState.props.chooseCredential).toBe(false);
    expect(modalState.props.lockedByOwner).toBe(false);
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    // Box never pre-opens an OAuth popup from the click: it always goes
    // through its account picker first.
    expect(BrowserMod._spies.open).not.toHaveBeenCalled();
  });

  it('opens the Box account picker when not connected and runs OAuth only from the modal', async () => {
    render(<JSForm formId='f1' _internalId='iid-connect-new' />);
    await clickTrigger();

    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(modalState.props.chooseCredential).toBe(true);
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    expect(BrowserMod._spies.open).not.toHaveBeenCalled();
    expect((fieldValues as any)[EMAIL_KEY]).toBeUndefined();

    // "Connect a new account..." in the modal is the only route to OAuth.
    await act(async () => {
      await modalState.props.onChangeAccount();
    });
    expect(mockedRunOAuthPopup).toHaveBeenCalledWith(
      expect.anything(),
      'box',
      fakePopup,
      false
    );
    expect((fieldValues as any)[EMAIL_KEY]).toBe('connected@example.com');
  });

  it('finishes a fresh connect without a modal when the provider has no setup', async () => {
    // Schwab reports no email, so the connection is recorded on its own
    // field - otherwise every click would re-run OAuth. With no config UI to
    // show, the modal would just be an empty dialog, so the flow advances
    // straight to the next action.
    GridMod._spies.actions = [
      { type: 'connect_account', provider: 'charles-schwab' },
      {
        type: 'url',
        url: 'https://example.com/after-connect',
        open_tab: false
      }
    ];
    mockedRunOAuthPopup.mockResolvedValue({ account_email: '' });

    render(<JSForm formId='f1' _internalId='iid-connect-schwab' />);
    await clickTrigger();

    await waitFor(() =>
      expect(BrowserMod._spies.location.href).toBe(
        'https://example.com/after-connect'
      )
    );
    expect((fieldValues as any)[SCHWAB_KEY]).toBe('true');
    expect((fieldValues as any)[EMAIL_KEY]).toBeUndefined();
    expect(modalState.props?.show).not.toBe(true);
  });

  it('hands the click-time popup to a second connect in the same chain', async () => {
    // A setup-less provider advances the chain from inside its own action,
    // straight off the OAuth result - the click's user gesture is long gone by
    // then, so the second connect can't open a popup for itself. It has to
    // inherit the one pre-opened at click time, or it reports a blocked popup
    // when nothing was ever blocked.
    // Box opens its picker instead of a popup, so the second connect here is
    // another setup-less OAuth provider.
    GridMod._spies.actions = [
      { type: 'connect_account', provider: 'charles-schwab' },
      { type: 'connect_account', provider: 'dropbox' }
    ];
    const schwabPopup = { close: jest.fn() };
    const dropboxPopup = { close: jest.fn() };
    BrowserMod._spies.open
      .mockReturnValueOnce(schwabPopup)
      .mockReturnValueOnce(dropboxPopup)
      // Past the two opened inside the click, the gesture is spent and the
      // browser hands back nothing.
      .mockReturnValue(null);
    mockedRunOAuthPopup.mockImplementation(
      async (_client: any, provider: string, popup: any) => {
        if (!popup) {
          throw new Error('Please allow pop-ups to connect your account.');
        }
        return {
          account_email:
            provider === 'charles-schwab' ? '' : 'connected@example.com'
        };
      }
    );

    render(<JSForm formId='f1' _internalId='iid-connect-chained' />);
    await clickTrigger();

    await waitFor(() => expect(mockedRunOAuthPopup).toHaveBeenCalledTimes(2));
    expect(mockedRunOAuthPopup).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'dropbox',
      dropboxPopup
    );
    expect((fieldValues as any)[SCHWAB_KEY]).toBe('true');
    await waitFor(() =>
      expect((fieldValues as any)[DROPBOX_KEY]).toBe('connected@example.com')
    );
    expect(FormHelperMod.setFormElementError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Please allow pop-ups to connect your account.'
      })
    );
  });

  it("does not relabel a later action's failure as a connect failure", async () => {
    // The modal-less path advances the chain from inside this action's own
    // branch, so a throw from a later action must not be caught by the
    // connect error handler and reported as "Unable to connect your account."
    GridMod._spies.actions = [
      { type: 'connect_account', provider: 'charles-schwab' },
      { type: 'alloy_verify_id' }
    ];
    mockedRunOAuthPopup.mockResolvedValue({ account_email: '' });
    mockedVerifyAlloyId.mockRejectedValue(new Error('Alloy is down'));

    render(<JSForm formId='f1' _internalId='iid-connect-downstream-error' />);
    await clickTrigger();

    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Error: Alloy is down' })
      )
    );
    expect(FormHelperMod.setFormElementError).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unable to connect your account.' })
    );
    // The connect itself still succeeded and was recorded.
    expect((fieldValues as any)[SCHWAB_KEY]).toBe('true');
  });

  it('offers Change account when an already-connected setup-less button is clicked again', async () => {
    GridMod._spies.actions = [
      { type: 'connect_account', provider: 'charles-schwab' }
    ];
    (fieldValues as any)[SCHWAB_KEY] = 'true';

    render(<JSForm formId='f1' _internalId='iid-connect-schwab-again' />);
    await clickTrigger();

    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    // The stored value is the bare 'true' flag, so Form must not pass it
    // through as an email - the modal would render it as the account.
    expect(modalState.props.accountEmail).toBe('');
  });

  it('surfaces a popup-blocked error without calling the API', async () => {
    // Box never pre-opens a popup; a provider that does is the one a blocker
    // can stop at click time.
    GridMod._spies.actions = [
      { type: 'connect_account', provider: 'charles-schwab' }
    ];
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

  it('surfaces a popup-blocked error from Change account without an unhandled rejection', async () => {
    // Start already connected so the modal opens directly, uncomplicated by
    // the initial OAuth call.
    (fieldValues as any)[EMAIL_KEY] = 'existing@example.com';

    render(<JSForm formId='f1' _internalId='iid-connect-change-blocked' />);
    await clickTrigger();
    await waitFor(() => expect(modalState.props?.show).toBe(true));

    // Now block the re-auth popup triggered by Change account.
    BrowserMod._spies.open.mockReturnValue(null);
    fireEvent.click(screen.getByTestId('modal-change-account'));

    await waitFor(() => expect(changeAccountOutcome.status).toBe('resolved'));
    expect(changeAccountOutcome.value).toBe(
      'Please allow pop-ups to connect your account.'
    );
  });

  it('ignores a second connect_account trigger while the first modal is still open', async () => {
    // isButtonActionRunning() only gates button/table triggers, so a second
    // non-button trigger (e.g. a different container) can reach the action
    // branch while the first trigger's modal is still open. Drive both
    // through the same entry point buttonOnClick itself uses:
    // form.runElementActions.
    render(<JSForm formId='f1' _internalId='iid-connect-concurrent' />);
    await screen.findByTestId('btn');
    // Grabbed only after the initial render, since GridMod._spies.form is
    // populated by GridMock's own render and would otherwise still be the
    // previous test's null (reset in afterEach).
    const form = GridMod._spies.form;

    // B uses a different provider than A's so that A's own successful
    // connect (which writes feathery.connections.box.email) can't put B on
    // the "already connected" fast path too and mask the guard: without it,
    // B would still reach a live, distinguishable second runOAuthPopup call.
    const actionA = [{ type: 'connect_account', provider: 'box' }];
    const actionB = [{ type: 'connect_account', provider: 'dropbox' }];

    // Trigger A opens the modal. Driven directly (not via a simulated DOM
    // event), so its state updates need an explicit act().
    await act(async () => {
      await form.runElementActions({
        actions: actionA,
        element: { id: 'containerA' },
        elementType: 'container'
      });
    });
    await waitFor(() => expect(modalState.props?.show).toBe(true));
    // Box opens its picker without OAuth or a pre-opened popup.
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    expect(BrowserMod._spies.open).not.toHaveBeenCalled();

    // Trigger B fires on a different element (and provider) while A's modal
    // is still open.
    await act(async () => {
      await form.runElementActions({
        actions: actionB,
        element: { id: 'containerB' },
        elementType: 'container'
      });
    });

    // B must be ignored: no OAuth call, and its own pre-opened popup (opened
    // before the guard is reached) is simply closed instead of used.
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    expect(BrowserMod._spies.open).toHaveBeenCalledTimes(1);
    expect(fakePopup.close).toHaveBeenCalledTimes(1);

    // B's own click lock must not be left stuck: a repeat trigger on the
    // same element reaches the guard branch again (another popup opened and
    // closed) instead of no-op'ing on a stale "already clicked" lock (which
    // would close nothing, since preOpenActionWindows never even runs for an
    // early-locked call).
    await act(async () => {
      await form.runElementActions({
        actions: actionB,
        element: { id: 'containerB' },
        elementType: 'container'
      });
    });
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    expect(fakePopup.close).toHaveBeenCalledTimes(2);
  });

  it('offers saved Box credentials before starting a new OAuth connection', async () => {
    render(<JSForm formId='f1' _internalId='iid-saved-box' />);
    await screen.findByTestId('btn');
    const credentials = [
      {
        id: 'saved',
        account_email: 'advisor@example.com',
        account_name: 'Advisor'
      }
    ];
    GridMod._spies.form.client.listAccountCredentials.mockResolvedValue({
      credentials
    });
    await clickTrigger();
    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(modalState.props.credentials).toEqual(credentials);
    expect(modalState.props.chooseCredential).toBe(true);
    expect(modalState.props.canSaveCredential).toBe(true);
    expect(modalState.props.lockedByOwner).toBe(false);
    expect(BrowserMod._spies.open).not.toHaveBeenCalled();
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    expect((fieldValues as any)[EMAIL_KEY]).toBeUndefined();
    act(() =>
      modalState.props.onCredentialSelected({
        [EMAIL_KEY]: 'advisor@example.com'
      })
    );
    expect((fieldValues as any)[EMAIL_KEY]).toBe('advisor@example.com');
  });

  it.each([
    [false, 'Please sign in to connect your Box account.'],
    [
      true,
      'This Box connection was set up by a signed-in user. Sign in as that user to change it.'
    ]
  ])(
    'requires sign-in and asks the host for login on a sensitive form (already connected: %s)',
    async (alreadyConnected, message) => {
      ClientMod._spies.state.authSensitiveActionsOnly = true;
      if (alreadyConnected)
        (fieldValues as any)[EMAIL_KEY] = 'advisor@example.com';
      render(<JSForm formId='f1' _internalId='iid-sensitive-guest' />);
      await screen.findByTestId('btn');
      await clickTrigger();
      await waitFor(() =>
        expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
          expect.objectContaining({ message })
        )
      );
      expect(BrowserMod._spies.dispatchEvent).toHaveBeenCalledTimes(1);
      expect(BrowserMod._spies.dispatchEvent.mock.calls[0][0].type).toBe(
        'feathery:request-login'
      );
      expect(modalState.props?.show).not.toBe(true);
      expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
      expect(BrowserMod._spies.open).not.toHaveBeenCalled();
    }
  );

  it('opens the modal locked for a signed-in user who does not own the connection', async () => {
    (fieldValues as any)[EMAIL_KEY] = 'owner@example.com';
    render(<JSForm formId='f1' _internalId='iid-locked-owner' />);
    await screen.findByTestId('btn');
    const credentials = [
      {
        id: 'mine',
        account_email: 'collaborator@example.com',
        account_name: 'Collaborator'
      }
    ];
    GridMod._spies.form.client.listAccountCredentials.mockResolvedValue({
      credentials,
      attached: { owner: false, account_email: 'owner@example.com' }
    });
    await clickTrigger();
    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(modalState.props.lockedByOwner).toBe(true);
    expect(modalState.props.credentials).toEqual(credentials);
    expect(modalState.props.chooseCredential).toBe(false);
    expect(modalState.props.canSaveCredential).toBe(true);
    expect(modalState.props.accountEmail).toBe('owner@example.com');
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
  });

  it('does not lock the modal for the signed-in owner of the connection', async () => {
    (fieldValues as any)[EMAIL_KEY] = 'owner@example.com';
    render(<JSForm formId='f1' _internalId='iid-owner-unlocked' />);
    await screen.findByTestId('btn');
    GridMod._spies.form.client.listAccountCredentials.mockResolvedValue({
      credentials: [],
      attached: { owner: true, account_email: 'owner@example.com' }
    });
    await clickTrigger();
    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(modalState.props.lockedByOwner).toBe(false);
  });

  it('allows a verified account with no saved credentials to connect on a sensitive form', async () => {
    ClientMod._spies.state.authSensitiveActionsOnly = true;
    render(<JSForm formId='f1' _internalId='iid-sensitive-auth' />);
    await screen.findByTestId('btn');
    GridMod._spies.form.client.listAccountCredentials.mockResolvedValue({
      credentials: []
    });
    await clickTrigger();
    await waitFor(() => expect(modalState.props?.show).toBe(true));
    expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
    expect(BrowserMod._spies.dispatchEvent).not.toHaveBeenCalled();
    expect(modalState.props.canSaveCredential).toBe(true);
    expect(modalState.props.chooseCredential).toBe(true);
  });

  it.each([false, true])(
    'continues without saved credentials after a list failure (already connected: %s)',
    async (alreadyConnected) => {
      if (alreadyConnected) (fieldValues as any)[EMAIL_KEY] = 'old@example.com';
      render(<JSForm formId='f1' _internalId='iid-list-error' />);
      await screen.findByTestId('btn');
      GridMod._spies.form.client.listAccountCredentials.mockRejectedValue(
        new Error('Unable to load saved accounts.')
      );
      await clickTrigger();
      await waitFor(() => expect(modalState.props?.show).toBe(true));
      // The picker still opens (offering an explicit new-account action)
      // rather than jumping straight into OAuth.
      expect(mockedRunOAuthPopup).not.toHaveBeenCalled();
      expect(modalState.props.chooseCredential).toBe(!alreadyConnected);
      expect(modalState.props.credentials).toEqual([]);
      expect(modalState.props.canSaveCredential).toBe(false);
      expect(modalState.props.lockedByOwner).toBe(false);
    }
  );
  it('shows the provider sign-in error when sensitive Schwab authorization is denied', async () => {
    ClientMod._spies.state.authSensitiveActionsOnly = true;
    GridMod._spies.actions = [
      { type: 'connect_account', provider: 'charles-schwab' }
    ];
    mockedRunOAuthPopup.mockRejectedValue(
      new Error(
        'Please sign in to connect or manage your Charles Schwab account.'
      )
    );
    render(<JSForm formId='f1' _internalId='iid-sensitive-schwab' />);
    await clickTrigger();
    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Please sign in to connect or manage your Charles Schwab account.'
        })
      )
    );
    expect(modalState.props?.show).not.toBe(true);
    expect(fakePopup.close).toHaveBeenCalledTimes(1);
  });
  it('forwards an explicit save choice from the modal to OAuth', async () => {
    render(<JSForm formId='f1' _internalId='iid-save-new-box' />);
    await screen.findByTestId('btn');
    GridMod._spies.form.client.listAccountCredentials.mockResolvedValue({
      credentials: []
    });
    await clickTrigger();
    await waitFor(() => expect(modalState.props?.show).toBe(true));
    await act(async () => {
      await modalState.props.onChangeAccount(true);
    });
    expect(mockedRunOAuthPopup).toHaveBeenCalledWith(
      expect.anything(),
      'box',
      fakePopup,
      true
    );
  });
});

// A step whose own button carries a connect_account action gates every other
// submitting button on that flow. The gate must recognise a connection the
// submission already holds (e.g. the owner connected, a collaborator continues)
// and not only a flow run in this tab.
describe('required connect_account flow gate', () => {
  const REQUIRED_MESSAGE = 'You must connect your account before proceeding';

  // The step's required action is derived in an effect after the step
  // renders, so let that effect commit before clicking.
  const clickNext = async () => {
    const btn = await screen.findByTestId('btn');
    await act(async () => {});
    fireEvent.click(btn);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete (fieldValues as any)[EMAIL_KEY];
    delete (fieldValues as any)[FOLDER_KEY];
    ClientMod._spies.state.steps = [
      {
        key: 'step-1',
        id: 's1',
        servar_fields: [],
        buttons: [
          {
            id: 'connect-btn',
            properties: {
              actions: [{ type: 'connect_account', provider: 'box' }]
            }
          }
        ],
        next_conditions: []
      }
    ];
    // The clicked button is a plain submitting Next, not the connect button.
    GridMod._spies.actions = [{ type: 'next' }];
    GridMod._spies.submit = true;
  });

  afterEach(() => {
    ClientMod._spies.state.steps = null;
    GridMod._spies.submit = false;
    delete (fieldValues as any)[EMAIL_KEY];
    delete (fieldValues as any)[FOLDER_KEY];
    cleanup();
  });

  it('blocks a submit while the step has never been connected', async () => {
    render(<JSForm formId='f1' _internalId='iid-gate-blocked' />);
    await clickNext();

    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({ message: REQUIRED_MESSAGE })
      )
    );
    expect(FormHelperMod.setFormElementError).not.toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'b1', message: '' })
    );
  });

  it('still blocks when an account is attached but no folder is configured', async () => {
    (fieldValues as any)[EMAIL_KEY] = 'owner@example.com';

    render(<JSForm formId='f1' _internalId='iid-gate-unconfigured' />);
    await clickNext();

    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({ message: REQUIRED_MESSAGE })
      )
    );
  });

  it('lets a submit through when the submission already holds the connection', async () => {
    (fieldValues as any)[EMAIL_KEY] = 'owner@example.com';
    (fieldValues as any)[FOLDER_KEY] = '4206653';

    render(<JSForm formId='f1' _internalId='iid-gate-connected' />);
    await clickNext();

    // Past the gate, the first thing a submitting click does is clear the
    // button's previous error; a blocked click never gets that far.
    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({ fieldKey: 'b1', message: '' })
      )
    );
    expect(FormHelperMod.setFormElementError).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: REQUIRED_MESSAGE })
    );
  });
});
