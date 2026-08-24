import { BrowserMod, ClientMod, FormHelperMod, GridMod } from './testMocks';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor
} from '@testing-library/react';
import { JSForm } from '..';
import { fieldValues } from '../../utils/init';

const INVITEE_KEY = 'invitees';

const inviteAction = {
  type: 'invite_collaborator',
  email_field_key: INVITEE_KEY,
  template_id: 't1'
};

describe('invite_collaborator action', () => {
  const clickTrigger = async () =>
    fireEvent.click(await screen.findByTestId('btn'));

  const invitees = () => ClientMod._spies.inviteCollaborator.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    delete (fieldValues as any)[INVITEE_KEY];
    BrowserMod._spies.location.href = 'https://example.com/';
    GridMod._spies.actions = [inviteAction];
    GridMod._spies.submit = false;
  });

  afterEach(() => {
    cleanup();
  });

  // A repeating invite field always carries an unfilled trailing row while the
  // user is on the step, since addRepeatedRow appends one as soon as the last
  // row is filled. Sending that blank on made the backend reject the whole
  // invite, so a filled field never actually invited anyone.
  it('drops the unfilled trailing repeat row', async () => {
    (fieldValues as any)[INVITEE_KEY] = ['collab@gmail.com', ''];

    render(<JSForm formId='f1' _internalId='iid-invite-blank' />);
    await clickTrigger();

    await waitFor(() =>
      expect(ClientMod._spies.inviteCollaborator).toHaveBeenCalled()
    );
    expect(invitees()).toEqual(['collab@gmail.com']);
  });

  // Repeated select/signature/file_upload fields default to null rather than
  // '', so the same unfilled row shows up as a null entry.
  it('drops a null entry from a repeated non-text field', async () => {
    (fieldValues as any)[INVITEE_KEY] = ['collab@gmail.com', null];

    render(<JSForm formId='f1' _internalId='iid-invite-null' />);
    await clickTrigger();

    await waitFor(() =>
      expect(ClientMod._spies.inviteCollaborator).toHaveBeenCalled()
    );
    expect(invitees()).toEqual(['collab@gmail.com']);
  });

  it('drops the empty segment left by a trailing comma in a CSV field', async () => {
    (fieldValues as any)[INVITEE_KEY] = 'collab@gmail.com, ';

    render(<JSForm formId='f1' _internalId='iid-invite-csv' />);
    await clickTrigger();

    await waitFor(() =>
      expect(ClientMod._spies.inviteCollaborator).toHaveBeenCalled()
    );
    expect(invitees()).toEqual(['collab@gmail.com']);
  });

  it.each([
    ['a single blank row', ['']],
    ['a single null row', [null]],
    ['whitespace only', ['   ']],
    ['blank and null rows', ['', null]],
    ['an unset field', undefined]
  ])('asks for collaborators when the field holds %s', async (_label, val) => {
    if (val !== undefined) (fieldValues as any)[INVITEE_KEY] = val;

    render(<JSForm formId='f1' _internalId='iid-invite-empty' />);
    await clickTrigger();

    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Collaborators required' })
      )
    );
    expect(ClientMod._spies.inviteCollaborator).not.toHaveBeenCalled();
  });

  it('stops the action chain when there is nobody to invite', async () => {
    (fieldValues as any)[INVITEE_KEY] = [''];
    GridMod._spies.actions = [
      inviteAction,
      { type: 'url', url: 'https://example.com/after-invite', open_tab: false }
    ];

    render(<JSForm formId='f1' _internalId='iid-invite-chain' />);
    await clickTrigger();

    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalled()
    );
    expect(BrowserMod._spies.location.href).toBe('https://example.com/');
  });
});
