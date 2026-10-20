import { getRedirectUrl } from '../utils';
import { featheryWindow } from '../../../utils/browser';

jest.mock('../../../utils/browser', () => ({
  featheryWindow: jest.fn()
}));

jest.mock('../../LoginForm', () => ({ authState: {} }));

const atLocation = (pathname: string, search = '', hash = '') =>
  (featheryWindow as jest.Mock).mockReturnValue({
    location: { origin: 'https://form.feathery.io', pathname, search, hash }
  });

describe('getRedirectUrl', () => {
  it('keeps the access link token so login can hand the form back its credential', () => {
    atLocation('/', '?_lt=tok');

    expect(getRedirectUrl()).toBe('https://form.feathery.io/?_lt=tok');
  });

  it('keeps the slug', () => {
    atLocation('/', '?_slug=my-form');

    expect(getRedirectUrl()).toBe('https://form.feathery.io/?_slug=my-form');
  });

  it('keeps the slug and the token together', () => {
    atLocation('/', '?_slug=my-form&_lt=tok');

    expect(getRedirectUrl()).toBe(
      'https://form.feathery.io/?_slug=my-form&_lt=tok'
    );
  });

  it('keeps the locale, as the user-id rewrite does', () => {
    atLocation('/', '?_locale=fr&_lt=tok');

    expect(getRedirectUrl()).toBe(
      'https://form.feathery.io/?_locale=fr&_lt=tok'
    );
  });

  it('keeps the token wherever it sits among other params', () => {
    // Which other params survive is unchanged from before links existed
    atLocation('/', '?a=1&_lt=tok&b=2&_id=fuser&c=3&_cid=collab&d=4');

    const params = new URL(getRedirectUrl()).searchParams;
    expect(params.getAll('_lt')).toEqual(['tok']);
  });

  it('keeps a repeated token as it is, which the SDK then ignores', () => {
    atLocation('/', '?_lt=tok-a&_lt=tok-b');

    expect(getRedirectUrl()).toBe(
      'https://form.feathery.io/?_lt=tok-a&_lt=tok-b'
    );
  });

  it('has no query string once everything is dropped', () => {
    atLocation('/', '?_id=fuser&utm_source=email');

    expect(getRedirectUrl()).toBe('https://form.feathery.io/');
  });

  it('takes the slug out of the /to/<slug> path and strips the segment', () => {
    atLocation('/to/my-form/', '?_lt=tok');

    expect(getRedirectUrl()).toBe(
      'https://form.feathery.io/?_lt=tok&_slug=my-form'
    );
  });

  it('preserves the hash', () => {
    atLocation('/to/my-form/', '?_lt=tok', '#step-2');

    expect(getRedirectUrl()).toBe(
      'https://form.feathery.io/?_lt=tok&_slug=my-form#step-2'
    );
  });

  it('preserves the hash with no params at all', () => {
    atLocation('/', '', '#step-2');

    expect(getRedirectUrl()).toBe('https://form.feathery.io/#step-2');
  });
});
