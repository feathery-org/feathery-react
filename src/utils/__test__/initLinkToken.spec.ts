import { featheryDoc, featheryWindow } from '../browser';

// `init` only runs once per module registry, and importing `../browser` above
// already pulls init in, so each case has to clear the registry to get a copy
// that has not been initialized yet.
const loadInit = () => {
  jest.resetModules();
  return require('../init');
};

const setSearch = (search: string) =>
  featheryWindow().history.replaceState({}, '', `/to/form${search}`);

describe('init with an access link', () => {
  beforeEach(() => {
    setSearch('');
    featheryDoc().cookie = 'feathery-link-tok=; max-age=0; path=/;';
    // localStorage is the primary secret store, so a leftover entry would
    // shadow the cookie the stored-secret case sets up
    featheryWindow().localStorage.clear();
  });

  it('picks the token up from the _lt url param', async () => {
    setSearch('?_lt=tok');
    const { init, initState } = loadInit();

    await init('sdkKey');

    expect(initState.linkToken).toBe('tok');
  });

  it('prefers an explicitly passed token over the url', async () => {
    setSearch('?_lt=from-url');
    const { init, initState } = loadInit();

    await init('sdkKey', { linkToken: 'from-host' });

    expect(initState.linkToken).toBe('from-host');
  });

  it('loads the device secret stored for that token', async () => {
    setSearch('?_lt=tok');
    featheryDoc().cookie = 'feathery-link-tok=secret; path=/;';
    const { init, initState } = loadInit();

    await init('sdkKey');

    expect(initState.linkSecret).toBe('secret');
  });

  // This case used to assert the opposite, that a token suppressed user
  // tracking. It moved because a token minted for another form is ignored by
  // the backend, which then has no fuser key to work with and rejects the
  // session: opening form B with form A's link showed "not collecting
  // responses". The link still wins whenever it resolves, since the session
  // endpoint overrides the fuser from the link row.
  it('still tracks a user id by cookie so a link for another form cannot strand it', async () => {
    setSearch('?_lt=tok');
    const { init, initState } = loadInit();

    await init('sdkKey');

    expect(initState.userId).toBeTruthy();
    expect(featheryDoc().cookie).toContain('feathery-user-id-sdkKey');
    // The device secret still loads alongside it
    expect(initState.linkToken).toBe('tok');
  });

  it('still tracks a user id by cookie when no link is present', async () => {
    const { init, initState } = loadInit();

    await init('sdkKey');

    expect(initState.linkToken).toBe('');
    expect(initState.userId).toBeTruthy();
  });

  it('keeps the token in the url when the user id is rewritten', async () => {
    setSearch('?_lt=tok&_id=old-fuser&_cid=collab&utm_source=email');
    const { init, updateUserId } = loadInit();
    await init('sdkKey');

    await updateUserId('new-fuser');

    // The device that redeemed the link keeps reopening the form through it,
    // so the token outlives the submission the url points at
    const params = new URLSearchParams(featheryWindow().location.search);
    expect(params.get('_lt')).toBe('tok');
    expect(params.get('_id')).toBe('new-fuser');
    expect(params.get('utm_source')).toBe('email');
    expect(params.has('_cid')).toBe(false);
  });

  it('rewrites the user id normally once the token has left the url', async () => {
    // The session fetch strips the token as soon as the server accepts it, so
    // by the time anything rewrites the url there is usually none to preserve
    setSearch('?_id=old-fuser&utm_source=email');
    const { init, updateUserId } = loadInit();
    await init('sdkKey');

    await updateUserId('new-fuser');

    const params = new URLSearchParams(featheryWindow().location.search);
    expect(params.has('_lt')).toBe(false);
    expect(params.get('_id')).toBe('new-fuser');
    expect(params.get('utm_source')).toBe('email');
  });
});

describe('adoptLinkRedemption', () => {
  const redemption = {
    fuser_key: 'fuser',
    collaborator_id: 'collab',
    device_secret: 'secret'
  };

  beforeEach(() => {
    setSearch('?_lt=tok');
    featheryDoc().cookie = 'feathery-link-tok=; max-age=0; path=/;';
    featheryWindow().localStorage.clear();
  });

  it('points the sdk at the submission the link opens', async () => {
    const initMod = loadInit();
    await initMod.init('sdkKey');

    initMod.adoptLinkRedemption('tok', redemption);

    expect(initMod.initState).toMatchObject({
      userId: 'fuser',
      collaboratorId: 'collab',
      overrideUserId: true,
      linkSecret: 'secret'
    });
  });

  it('stores the device secret so this browser can reopen the link', async () => {
    const initMod = loadInit();
    await initMod.init('sdkKey');

    initMod.adoptLinkRedemption('tok', redemption);

    expect(featheryWindow().localStorage.getItem('feathery-link-tok')).toBe(
      'secret'
    );
    // This case used to assert the cookie held a copy too. It moved when the
    // cookie became a true fallback: localStorage kept the secret here, and a
    // per link cookie would otherwise ride every request on the shared hosted
    // form domain for nothing.
    expect(featheryDoc().cookie).not.toContain('feathery-link-tok=secret');
  });

  it('clears a collaborator the page was opened with when the link has none', async () => {
    const initMod = loadInit();
    await initMod.init('sdkKey', { collaboratorId: 'stale-collab' });

    initMod.adoptLinkRedemption('tok', {
      ...redemption,
      collaborator_id: null
    });

    expect(initMod.initState.collaboratorId).toBe('');
  });

  it('drops the submission state the previous session left behind', async () => {
    const initMod = loadInit();
    await initMod.init('sdkKey');
    initMod.initState.formSessions = { 'form-key': {} };
    initMod.initState.fieldValuesInitialized = true;
    initMod.fieldValues.stale = 'value';

    initMod.adoptLinkRedemption('tok', redemption);

    expect(initMod.initState.formSessions).toEqual({});
    expect(initMod.initState.fieldValuesInitialized).toBe(false);
    // fieldValues is reassigned rather than emptied, so read it off the module
    expect(initMod.fieldValues).toEqual({});
  });
});
