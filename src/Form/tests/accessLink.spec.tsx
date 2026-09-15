import { ClientMod, FormHelperMod, PollFuserDataMod } from './testMocks';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { JSForm } from '..';

// Only the storage probe is stubbed: whether this browser can hold a device
// secret is a browser fact the Form can only react to, and jsdom always can.
jest.mock('../../utils/accessLink', () => ({
  ...jest.requireActual('../../utils/accessLink'),
  canPersistLinkSecret: jest.fn()
}));

const InitMod: any = jest.requireMock('../../utils/init');
const AccessLinkMod: any = jest.requireMock('../../utils/accessLink');

const CONTINUE_COPY = 'This form link can only be opened on one device.';
const BLOCKED_COPY = 'Please open this form from your personal link.';
const CLOSED_COPY = "This form isn't currently collecting responses.";
const LOAD_FAILED_COPY = "We couldn't load this form. Please refresh the page.";
const RETRY_COPY = "Couldn't open this link. Try again.";
const STORAGE_BLOCKED_COPY =
  "This browser can't remember this device, so the link can't be opened here. " +
  'Open it directly in a new browser tab instead.';

const renderWithSession = (session: any, internalId: string, props = {}) => {
  ClientMod._spies.state.session = session;
  render(<JSForm formId='f1' _internalId={internalId} {...props} />);
};

const clickContinue = async () => {
  const button = await screen.findByText('Continue');
  await act(async () => {
    fireEvent.click(button);
  });
};

describe('access link session flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AccessLinkMod.canPersistLinkSecret.mockReturnValue(true);
    Object.assign(InitMod.initState, {
      linkToken: 'tok',
      linkSecret: '',
      userId: '',
      collaboratorId: '',
      overrideUserId: false,
      authenticationError: undefined
    });
  });

  afterEach(() => {
    cleanup();
    ClientMod._spies.state.session = null;
    ClientMod._spies.state.sessionError = null;
    ClientMod._spies.state.formOff = false;
  });

  it('blocks the form when it can only be opened from a link', async () => {
    renderWithSession({ link: { required: true } }, 'iid-link-required');

    expect(await screen.findByText(BLOCKED_COPY)).toBeInTheDocument();
  });

  it('holds a single-use link behind the continue screen', async () => {
    renderWithSession({ link: { confirm: true } }, 'iid-link-confirm');

    expect(await screen.findByText(CONTINUE_COPY)).toBeInTheDocument();
    // Never a submit: the Continue screen replaces the form element the way
    // FormOff does, but an embed can still sit inside the host page's own form,
    // where a default submit button would post that form on the click
    expect(screen.getByText('Continue')).toHaveAttribute('type', 'button');
    // The link must not be consumed before the user asks for it
    expect(ClientMod._spies.redeemLink).not.toHaveBeenCalled();
  });

  it('shows a turned off form instead of offering to burn the link', async () => {
    ClientMod._spies.state.formOff = true;
    renderWithSession({ link: { confirm: true } }, 'iid-link-confirm-off');

    expect(await screen.findByText(CLOSED_COPY)).toBeInTheDocument();
    expect(screen.queryByText(CONTINUE_COPY)).not.toBeInTheDocument();
  });

  it('adopts the redeemed submission and restarts the load', async () => {
    const redemption = {
      fuser_key: 'fuser',
      collaborator_id: 'collab',
      device_secret: 'secret'
    };
    ClientMod._spies.redeemLink.mockResolvedValue(redemption);
    renderWithSession({ link: { confirm: true } }, 'iid-link-redeem');

    await clickContinue();

    await waitFor(() =>
      expect(FormHelperMod.remountAllForms).toHaveBeenCalled()
    );
    expect(ClientMod._spies.redeemLink).toHaveBeenCalledWith('tok');
    // Switching the sdk over to the redeemed submission belongs to init
    expect(InitMod.adoptLinkRedemption).toHaveBeenCalledWith('tok', redemption);
  });

  it('leaves the link unredeemed when the device cannot hold the secret', async () => {
    // A cross origin iframe with storage blocked: redeeming would burn the one
    // opening the link has and lock the user out of every other browser
    AccessLinkMod.canPersistLinkSecret.mockReturnValue(false);
    renderWithSession({ link: { confirm: true } }, 'iid-link-no-storage');

    await clickContinue();

    expect(await screen.findByText(STORAGE_BLOCKED_COPY)).toBeInTheDocument();
    expect(ClientMod._spies.redeemLink).not.toHaveBeenCalled();
    expect(InitMod.adoptLinkRedemption).not.toHaveBeenCalled();
    // Allowing storage and clicking again has to be possible without a reload
    expect(screen.getByText('Continue')).not.toBeDisabled();
  });

  it('leaves the session alone when the link is rejected', async () => {
    // A rejected link answers with a 403, which the client turns into the
    // blocked form state and reports here as no redemption.
    ClientMod._spies.redeemLink.mockImplementation(async () => {
      InitMod.initState.authenticationError = 'This link has expired.';
      return undefined;
    });
    renderWithSession({ link: { confirm: true } }, 'iid-link-rejected');

    await clickContinue();

    await waitFor(() =>
      expect(ClientMod._spies.redeemLink).toHaveBeenCalledWith('tok')
    );
    expect(InitMod.adoptLinkRedemption).not.toHaveBeenCalled();
    expect(FormHelperMod.remountAllForms).not.toHaveBeenCalled();
    // The blocked state takes over the screen, so no retry is offered
    expect(screen.queryByText(RETRY_COPY)).not.toBeInTheDocument();
  });

  it('offers a retry when redeeming is rate limited', async () => {
    ClientMod._spies.redeemLink.mockRejectedValue(new Error('Unknown error'));
    renderWithSession({ link: { confirm: true } }, 'iid-link-throttled');

    await clickContinue();

    expect(await screen.findByText(RETRY_COPY)).toBeInTheDocument();
    expect(screen.getByText('Continue')).not.toBeDisabled();
    expect(InitMod.adoptLinkRedemption).not.toHaveBeenCalled();
  });

  it('offers a retry when the redeem request never lands', async () => {
    ClientMod._spies.redeemLink.mockResolvedValue(undefined);
    renderWithSession({ link: { confirm: true } }, 'iid-link-offline');

    await clickContinue();

    expect(await screen.findByText(RETRY_COPY)).toBeInTheDocument();
    expect(FormHelperMod.remountAllForms).not.toHaveBeenCalled();
  });

  it('offers a retry when the redemption carries no device secret', async () => {
    ClientMod._spies.redeemLink.mockResolvedValue({
      fuser_key: 'fuser',
      collaborator_id: null
    });
    renderWithSession({ link: { confirm: true } }, 'iid-link-no-secret');

    await clickContinue();

    expect(await screen.findByText(RETRY_COPY)).toBeInTheDocument();
    expect(InitMod.adoptLinkRedemption).not.toHaveBeenCalled();
  });

  it('asks for a refresh instead of opening the origin step when the session fails', async () => {
    // Only the session resolves which submission the link opens, so the form
    // has to block. A token this device kept for the form makes this reachable
    // on an ordinary connectivity failure, where nothing is closed at all.
    ClientMod._spies.state.sessionError = new Error('session down');

    render(<JSForm formId='f1' _internalId='iid-link-session-error' />);

    expect(await screen.findByText(LOAD_FAILED_COPY)).toBeInTheDocument();
    expect(screen.queryByText(CLOSED_COPY)).not.toBeInTheDocument();
  });

  it('does not poll fuser data before the link resolves a user id', async () => {
    renderWithSession({ link: { confirm: true } }, 'iid-link-poll', {
      _pollFuserData: true
    });

    await screen.findByText(CONTINUE_COPY);
    expect(PollFuserDataMod.default).toHaveBeenCalled();
    PollFuserDataMod.default.mock.calls.forEach((call: any[]) =>
      expect(call[0]).toBe(false)
    );
  });
});
