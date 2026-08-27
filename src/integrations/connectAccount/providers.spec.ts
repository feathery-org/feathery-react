import {
  connectAccountButtonLabel,
  connectionFieldKey,
  hasEmailIdentity,
  managedConnectAccountElement,
  PROVIDER_LABELS
} from './providers';
import { fieldValues } from '../../utils/init';
import { ACTION_CONNECT_ACCOUNT } from '../../utils/elementActions';

describe('provider connection fields', () => {
  it('uses the account email for providers that report one', () => {
    expect(connectionFieldKey('box')).toBe('feathery.connections.box.email');
    expect(hasEmailIdentity('box')).toBe(true);
  });

  it('records only that a connection exists when there is no identity', () => {
    // Schwab exposes no endpoint identifying the authorizing user.
    expect(connectionFieldKey('charles-schwab')).toBe(
      'feathery.connections.charles-schwab.connected'
    );
    expect(hasEmailIdentity('charles-schwab')).toBe(false);
  });

  it('defaults an unknown provider to the email field', () => {
    expect(connectionFieldKey('whoever')).toBe(
      'feathery.connections.whoever.email'
    );
    expect(hasEmailIdentity('whoever')).toBe(true);
  });

  it('labels every provider it can connect', () => {
    expect(PROVIDER_LABELS['charles-schwab']).toBe('Charles Schwab');
  });
});

describe('managed button label', () => {
  it('prompts to connect when nothing is connected', () => {
    expect(connectAccountButtonLabel('box', '')).toBe(
      'Connect your Box account'
    );
    expect(connectAccountButtonLabel('box', undefined)).toBe(
      'Connect your Box account'
    );
    expect(connectAccountButtonLabel('charles-schwab')).toBe(
      'Connect your Charles Schwab account'
    );
  });

  it('shows the account for a provider that reports one', () => {
    expect(connectAccountButtonLabel('box', 'user@example.com')).toBe(
      'user@example.com'
    );
  });

  it('names the provider when the connection carries no identity', () => {
    // Schwab stores a flag, so 'true' must never reach the button.
    expect(connectAccountButtonLabel('charles-schwab', 'true')).toBe(
      'Charles Schwab connected'
    );
  });

  it('falls back to the raw provider name when unlabelled', () => {
    expect(connectAccountButtonLabel('whoever')).toBe(
      'Connect your whoever account'
    );
  });
});

describe('managedConnectAccountElement', () => {
  const EMAIL_KEY = 'feathery.connections.box.email';
  const LABEL_STYLES = { font_size: 24, font_color: 'FF0000FF' };

  const button = (action: any) => ({
    id: 'btn-1',
    properties: {
      text: "Builder's label",
      text_formatted: [
        { insert: "Builder's label", attributes: { ...LABEL_STYLES } }
      ],
      actions: [action]
    }
  });

  afterEach(() => {
    delete (fieldValues as any)[EMAIL_KEY];
  });

  it('reports the connected account', () => {
    (fieldValues as any)[EMAIL_KEY] = 'respondent@example.com';
    const managed = managedConnectAccountElement(
      button({ type: ACTION_CONNECT_ACCOUNT, provider: 'box' })
    );

    expect(managed.properties.text).toBe('respondent@example.com');
  });

  it('prompts to connect when nothing is connected yet', () => {
    // The builder canvas has no field values either, so this is also what it
    // previews.
    const managed = managedConnectAccountElement(
      button({ type: ACTION_CONNECT_ACCOUNT, provider: 'box' })
    );

    expect(managed.properties.text).toBe('Connect your Box account');
  });

  it("keeps the builder's font styling on the managed label", () => {
    // The delta run's attributes carry the font styles; replacing the run with
    // a bare insert would render the managed label unstyled.
    const managed = managedConnectAccountElement(
      button({ type: ACTION_CONNECT_ACCOUNT, provider: 'box' })
    );

    expect(managed.properties.text_formatted).toEqual([
      { insert: 'Connect your Box account', attributes: LABEL_STYLES }
    ]);
  });

  it('leaves an opted-out or unrelated button alone', () => {
    expect(
      managedConnectAccountElement(
        button({
          type: ACTION_CONNECT_ACCOUNT,
          provider: 'box',
          manage_button_label: false
        })
      )
    ).toBeNull();
    expect(managedConnectAccountElement(button({ type: 'next' }))).toBeNull();
    expect(managedConnectAccountElement({ properties: {} })).toBeNull();
  });
});
