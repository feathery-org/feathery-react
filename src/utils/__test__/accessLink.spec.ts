import {
  canPersistLinkSecret,
  forgetLinkToken,
  getLinkTokenFromUrl,
  getStoredLinkCredentials,
  getStoredLinkSecret,
  isRejectedLinkMessage,
  linkRequestHeaders,
  retainLinkToken,
  storeLinkSecret
} from '../accessLink';
import { deleteCookie, featheryWindow, getCookie, setCookie } from '../browser';

jest.mock('../browser', () => ({
  featheryWindow: jest.fn(() => ({})),
  deleteCookie: jest.fn(),
  getCookie: jest.fn(),
  setCookie: jest.fn()
}));

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

const mockWindow = (window: any) =>
  (featheryWindow as jest.Mock).mockReturnValue(window);

const localStorageStub = () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn()
});

// A store that actually round-trips, which is the only thing the probe accepts.
const workingLocalStorage = () => {
  const entries: Record<string, string> = {};
  const localStorage = localStorageStub();
  localStorage.setItem.mockImplementation((key: string, value: string) => {
    entries[key] = value;
  });
  localStorage.getItem.mockImplementation((key: string) => entries[key]);
  localStorage.removeItem.mockImplementation((key: string) => {
    delete entries[key];
  });
  return { entries, localStorage };
};

const workingCookies = () => {
  const cookies: Record<string, string> = {};
  (setCookie as jest.Mock).mockImplementation((key: string, value: string) => {
    cookies[key] = value;
  });
  (getCookie as jest.Mock).mockImplementation((key: string) => cookies[key]);
  (deleteCookie as jest.Mock).mockImplementation((key: string) => {
    delete cookies[key];
  });
  return cookies;
};

// A window on a real page: a store that keeps what it is given, plus the
// location and history the token strip rewrites.
const pageWindow = (search = '', hash = '') => {
  const { entries, localStorage } = workingLocalStorage();
  const replaceState = jest.fn();
  mockWindow({
    localStorage,
    location: { pathname: '/to/form', search, hash },
    history: { replaceState }
  });
  return { entries, replaceState };
};

const throwingLocalStorage = () => {
  const localStorage = localStorageStub();
  const blocked = () => {
    throw new Error('storage blocked');
  };
  localStorage.getItem.mockImplementation(blocked);
  localStorage.setItem.mockImplementation(blocked);
  localStorage.removeItem.mockImplementation(blocked);
  return localStorage;
};

describe('accessLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWindow({});
    (getCookie as jest.Mock).mockReturnValue(undefined);
  });

  describe('getLinkTokenFromUrl', () => {
    it('reads the token out of _lt', () => {
      mockWindow({ location: { search: '?_lt=tok&utm_source=email' } });

      expect(getLinkTokenFromUrl()).toBe('tok');
    });

    it('is empty when the page carries no token', () => {
      mockWindow({ location: { search: '?_id=fuser' } });

      expect(getLinkTokenFromUrl()).toBe('');
    });

    it('ignores a repeated _lt rather than picking one of them', () => {
      mockWindow({ location: { search: '?_lt=tok-a&_lt=tok-b' } });

      expect(getLinkTokenFromUrl()).toBe('');
    });

    it('is empty outside the browser, where there is no location', () => {
      expect(getLinkTokenFromUrl()).toBe('');
    });
  });

  describe('linkRequestHeaders', () => {
    it('sends the bare token before the device has redeemed', () => {
      expect(linkRequestHeaders('tok')).toEqual({ 'X-Feathery-Link': 'tok' });
    });

    it('appends the device secret once the link is redeemed', () => {
      expect(linkRequestHeaders('tok', 'secret')).toEqual({
        'X-Feathery-Link': 'tok.secret'
      });
    });

    it('sends no header at all without a token', () => {
      expect(linkRequestHeaders('', 'secret')).toBeUndefined();
      expect(linkRequestHeaders(undefined)).toBeUndefined();
    });
  });

  describe('getStoredLinkSecret', () => {
    it('prefers localStorage', () => {
      (getCookie as jest.Mock).mockReturnValue('from-cookie');
      const localStorage = localStorageStub();
      localStorage.getItem.mockReturnValue('from-storage');
      mockWindow({ localStorage });

      expect(getStoredLinkSecret('tok')).toBe('from-storage');
      expect(localStorage.getItem).toHaveBeenCalledWith('feathery-link-tok');
    });

    it('falls back to the cookie when localStorage has nothing', () => {
      (getCookie as jest.Mock).mockReturnValue('from-cookie');
      mockWindow({ localStorage: localStorageStub() });

      expect(getStoredLinkSecret('tok')).toBe('from-cookie');
      expect(getCookie).toHaveBeenCalledWith('feathery-link-tok');
    });

    it('falls back to the cookie when storage is unavailable', () => {
      (getCookie as jest.Mock).mockReturnValue('from-cookie');
      const localStorage = localStorageStub();
      localStorage.getItem.mockImplementation(() => {
        throw new Error('storage blocked');
      });
      mockWindow({ localStorage });

      expect(getStoredLinkSecret('tok')).toBe('from-cookie');
    });

    it('is empty when neither store can be read', () => {
      (getCookie as jest.Mock).mockImplementation(() => {
        throw new Error('cookies blocked');
      });
      const localStorage = localStorageStub();
      localStorage.getItem.mockImplementation(() => {
        throw new Error('storage blocked');
      });
      mockWindow({ localStorage });

      expect(getStoredLinkSecret('tok')).toBe('');
    });

    it('is empty when there is no storage at all', () => {
      expect(getStoredLinkSecret('tok')).toBe('');
    });
  });

  describe('storeLinkSecret', () => {
    it('keeps the secret in localStorage alone when it holds', () => {
      // One cookie is written per link, and on the shared hosted form domain
      // every one of them rides every request, so the fallback stays unused
      // while the primary store works
      const { entries, localStorage } = workingLocalStorage();
      mockWindow({ localStorage });

      storeLinkSecret('tok', 'secret');

      expect(entries['feathery-link-tok']).toBe('secret');
      expect(setCookie).not.toHaveBeenCalled();
    });

    it('falls back to the cookie when the storage write throws', () => {
      const localStorage = localStorageStub();
      localStorage.setItem.mockImplementation(() => {
        throw new Error('storage blocked');
      });
      mockWindow({ localStorage });

      storeLinkSecret('tok', 'secret');

      // The per token cookie expires long before the SDK's identity cookies,
      // since an abandoned link would otherwise keep riding every request
      expect(setCookie).toHaveBeenCalledWith(
        'feathery-link-tok',
        'secret',
        THIRTY_DAYS_SECONDS
      );
    });

    it('falls back to the cookie when the storage write is silently dropped', () => {
      // Private and partitioned modes accept the write and hand back nothing,
      // so only reading it back proves the secret is really held
      const localStorage = localStorageStub();
      mockWindow({ localStorage });

      storeLinkSecret('tok', 'secret');

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'feathery-link-tok',
        'secret'
      );
      expect(setCookie).toHaveBeenCalledWith(
        'feathery-link-tok',
        'secret',
        THIRTY_DAYS_SECONDS
      );
    });

    it('does not throw when both stores reject the write', () => {
      (setCookie as jest.Mock).mockImplementation(() => {
        throw new Error('cookies blocked');
      });
      const localStorage = localStorageStub();
      localStorage.setItem.mockImplementation(() => {
        throw new Error('storage blocked');
      });
      mockWindow({ localStorage });

      expect(() => storeLinkSecret('tok', 'secret')).not.toThrow();
    });
  });

  describe('getStoredLinkCredentials', () => {
    it('reads the token kept for the form and the secret it belongs to', () => {
      const { entries } = pageWindow();
      entries['feathery-link-token-form-key'] = 'tok';
      entries['feathery-link-tok'] = 'secret';

      expect(getStoredLinkCredentials('form-key')).toEqual({
        token: 'tok',
        secret: 'secret'
      });
    });

    it('is empty for a form this device never opened from a link', () => {
      pageWindow();

      expect(getStoredLinkCredentials('form-key')).toEqual({
        token: '',
        secret: ''
      });
    });

    it('has no secret for a link this device never redeemed', () => {
      // An expiring link is never redeemed, so it has a token and no secret
      const { entries } = pageWindow();
      entries['feathery-link-token-form-key'] = 'tok';

      expect(getStoredLinkCredentials('form-key')).toEqual({
        token: 'tok',
        secret: ''
      });
    });
  });

  describe('retainLinkToken', () => {
    it('keeps the token per form and takes only _lt out of the url', () => {
      const { entries, replaceState } = pageWindow(
        '?_lt=tok&utm_source=email&_id=fuser',
        '#step-2'
      );

      retainLinkToken('form-key', 'tok');

      expect(entries['feathery-link-token-form-key']).toBe('tok');
      // localStorage held it, so the cookie fallback is not written
      expect(setCookie).not.toHaveBeenCalled();
      expect(replaceState).toHaveBeenCalledWith(
        {},
        '',
        '/to/form?utm_source=email&_id=fuser#step-2'
      );
    });

    it('leaves a url that never carried the token alone', () => {
      const { entries, replaceState } = pageWindow('?utm_source=email');

      retainLinkToken('form-key', 'tok');

      expect(entries['feathery-link-token-form-key']).toBe('tok');
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('drops the query string entirely when the token was all of it', () => {
      const { replaceState } = pageWindow('?_lt=tok');

      retainLinkToken('form-key', 'tok');

      expect(replaceState).toHaveBeenCalledWith({}, '', '/to/form');
    });

    it('keeps nothing for a form opened without a token', () => {
      const { entries, replaceState } = pageWindow('?_lt=tok');

      retainLinkToken('form-key', '');

      expect(entries).toEqual({});
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('leaves the token in the url when no store will hold it', () => {
      // An embed where storage is blocked has nothing but the address bar to
      // carry the token through a reload or a login redirect
      (setCookie as jest.Mock).mockImplementation(() => {
        throw new Error('cookies blocked');
      });
      const replaceState = jest.fn();
      mockWindow({
        localStorage: throwingLocalStorage(),
        location: { pathname: '/to/form', search: '?_lt=tok', hash: '' },
        history: { replaceState }
      });

      retainLinkToken('form-key', 'tok');

      expect(replaceState).not.toHaveBeenCalled();
    });

    it('does not throw outside the browser, where there is no history', () => {
      mockWindow({});

      expect(() => retainLinkToken('form-key', 'tok')).not.toThrow();
    });
  });

  describe('forgetLinkToken', () => {
    it('drops the token and its device secret from both stores', () => {
      // The secret only ever proves this device redeemed that one token, so a
      // spent token leaves nothing for it to prove
      const { entries } = pageWindow();
      entries['feathery-link-token-form-key'] = 'tok';
      entries['feathery-link-tok'] = 'secret';

      forgetLinkToken('form-key', 'tok');

      expect(entries).toEqual({});
      expect(deleteCookie).toHaveBeenCalledWith('feathery-link-token-form-key');
      expect(deleteCookie).toHaveBeenCalledWith('feathery-link-tok');
    });

    it('drops the secret of a token this device kept only in a cookie', () => {
      const cookies = workingCookies();
      cookies['feathery-link-token-form-key'] = 'tok';
      cookies['feathery-link-tok'] = 'secret';
      mockWindow({ localStorage: throwingLocalStorage() });

      forgetLinkToken('form-key', 'tok');

      expect(cookies).toEqual({});
    });

    it('keeps a newer token the form holds when an old one is rejected', () => {
      // A revoked link reopened from an earlier email must not take the
      // re-issued link's secret with it: that secret cannot be recovered
      const { entries } = pageWindow();
      entries['feathery-link-token-form-key'] = 'new';
      entries['feathery-link-new'] = 'new-secret';
      entries['feathery-link-old'] = 'old-secret';

      forgetLinkToken('form-key', 'old');

      expect(entries).toEqual({
        'feathery-link-token-form-key': 'new',
        'feathery-link-new': 'new-secret'
      });
    });

    it('does not throw when the stores are blocked', () => {
      (deleteCookie as jest.Mock).mockImplementation(() => {
        throw new Error('cookies blocked');
      });
      mockWindow({ localStorage: throwingLocalStorage() });

      expect(() => forgetLinkToken('form-key', 'tok')).not.toThrow();
    });
  });

  describe('isRejectedLinkMessage', () => {
    it('recognizes the 403s that mean the link itself is spent', () => {
      expect(isRejectedLinkMessage('This link has expired.')).toBe(true);
      expect(
        isRejectedLinkMessage(
          'This link has already been used on another device.'
        )
      ).toBe(true);
      expect(isRejectedLinkMessage('This link is not valid.')).toBe(true);
    });

    it('leaves every other blocked message to its own handling', () => {
      // Expectation moved: "only from its access link" used to count too, but
      // it means no usable token was presented (another form's, say), so it
      // says nothing about a token this device holds. Nor does the
      // require-a-link answer.
      expect(
        isRejectedLinkMessage(
          'This submission can only be opened from its access link.'
        )
      ).toBe(false);
      expect(
        isRejectedLinkMessage('Please open this form from your personal link.')
      ).toBe(false);
      expect(isRejectedLinkMessage('Access to this form is restricted')).toBe(
        false
      );
      expect(isRejectedLinkMessage(undefined)).toBe(false);
    });
  });

  describe('canPersistLinkSecret', () => {
    it('is true when localStorage round-trips the probe', () => {
      const { entries, localStorage } = workingLocalStorage();
      mockWindow({ localStorage });

      expect(canPersistLinkSecret()).toBe(true);
      // The probe is not a secret, so it must not be left in either store
      expect(entries).toEqual({});
      expect(setCookie).not.toHaveBeenCalled();
    });

    it('is true when localStorage is blocked but cookies round-trip', () => {
      const cookies = workingCookies();
      mockWindow({ localStorage: throwingLocalStorage() });

      expect(canPersistLinkSecret()).toBe(true);
      expect(cookies).toEqual({});
    });

    it('is false when both stores throw', () => {
      (setCookie as jest.Mock).mockImplementation(() => {
        throw new Error('cookies blocked');
      });
      mockWindow({ localStorage: throwingLocalStorage() });

      expect(canPersistLinkSecret()).toBe(false);
    });

    it('is false when a store takes the write but hands back nothing', () => {
      // Partitioned and private modes accept a write and silently drop it, so
      // only reading the probe back proves the secret would survive
      (setCookie as jest.Mock).mockImplementation(() => undefined);
      mockWindow({ localStorage: localStorageStub() });

      expect(canPersistLinkSecret()).toBe(false);
    });

    it('is false when there is no storage at all', () => {
      expect(canPersistLinkSecret()).toBe(false);
    });
  });
});
