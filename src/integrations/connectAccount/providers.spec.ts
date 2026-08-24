import {
  connectAccountButtonLabel,
  connectionFieldKey,
  hasEmailIdentity,
  PROVIDER_LABELS
} from './providers';

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
