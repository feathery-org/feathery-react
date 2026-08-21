import {
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
