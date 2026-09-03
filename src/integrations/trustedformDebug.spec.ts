import { featheryDoc, featheryWindow } from '../utils/browser';
import {
  auditControls,
  describeControl,
  installTrustedFormDebug,
  isTrustedFormDebugEnabled,
  TF_DEBUG_FLAG,
  whenDomSettles
} from './trustedformDebug';

const mount = (html: string) => {
  featheryDoc().body.innerHTML = `<form class="feathery">${html}</form>`;
  return featheryDoc().querySelector('form.feathery') as HTMLFormElement;
};

describe('describeControl', () => {
  it.each([
    ['name', '<input name="email" id="e1" aria-label="Email" />', 'email'],
    ['id', '<input id="e1" aria-label="Email" />', 'e1'],
    ['label', '<label>Email <input aria-label="x" /></label>', 'Email'],
    ['aria-label', '<input aria-label="Email" placeholder="you@x" />', 'Email'],
    [
      'aria-labelledby',
      '<span id="l1">Email</span><input aria-labelledby="l1" />',
      'Email'
    ],
    ['placeholder', '<input placeholder="you@x" />', 'you@x'],
    ['text', '<button type="button">Continue</button>', 'Continue']
  ])(
    'names a control from its %s before weaker sources',
    (source, html, expected) => {
      const form = mount(html);
      const el = form.querySelector('input, button') as Element;
      const described = describeControl(el);
      expect(described).toMatchObject({
        name: expected,
        source,
        isUnnamed: false
      });
    }
  );

  it('reports the tag of anything it cannot name', () => {
    const form = mount('<div class="card"></div>');
    expect(describeControl(form.querySelector('div') as Element)).toMatchObject(
      {
        name: '[unnamed div]',
        source: 'unnamed',
        isUnnamed: true
      }
    );
  });

  it('masks values under data-tf-sensitive and honours a nested false', () => {
    const form = mount(`
      <div data-tf-sensitive="true">
        <input name="ssn" value="123" />
        <input name="zip" value="94107" data-tf-sensitive="false" />
      </div>
      <input name="pw" type="password" value="hunter2" />`);
    const [ssn, zip, pw] = Array.from(form.querySelectorAll('input')).map(
      describeControl
    );
    expect(ssn).toMatchObject({ isSensitive: true, value: '********' });
    expect(zip).toMatchObject({ isSensitive: false, value: '94107' });
    expect(pw).toMatchObject({ isSensitive: true, value: '********' });
  });

  it('shows checked state for checkboxes and radios', () => {
    const form = mount(
      '<input type="checkbox" name="agree" value="yes" checked />'
    );
    expect(describeControl(form.querySelector('input') as Element).value).toBe(
      'yes (checked)'
    );
  });
});

describe('auditControls', () => {
  it('lists every control in the feathery form with unnamed ones first', () => {
    mount(`
      <input name="first" />
      <div role="button">Pick</div>
      <button name="next">Next</button>`);
    const rows = auditControls();
    expect(rows.map((r) => r.name)).toEqual(['[unnamed div]', 'first', 'next']);
  });
});

describe('installTrustedFormDebug', () => {
  let api: ReturnType<typeof installTrustedFormDebug>;
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    api = installTrustedFormDebug();
  });
  afterEach(() => {
    api.uninstall();
    jest.restoreAllMocks();
  });

  it('records a click on an unnamed div the way a certificate would', () => {
    const form = mount('<div class="card"><span>Premium</span></div>');
    (form.querySelector('span') as HTMLElement).click();
    expect(api.events).toHaveLength(1);
    expect(api.events[0]).toMatchObject({
      event: 'click',
      name: '[unnamed span]'
    });
  });

  it('attributes a click inside a button to the button', () => {
    const form = mount(
      '<button type="button" name="plan-a"><span>A</span></button>'
    );
    (form.querySelector('span') as HTMLElement).click();
    expect(api.events[0]).toMatchObject({ name: 'plan-a', source: 'name' });
  });

  it('logs typing once per focus and the final value on change', () => {
    const form = mount('<input name="first" />');
    const input = form.querySelector('input') as HTMLInputElement;
    const fire = (type: string) =>
      input.dispatchEvent(new Event(type, { bubbles: true }));
    input.value = 'A';
    fire('input');
    input.value = 'Al';
    fire('input');
    fire('change');
    expect(api.events.map((e) => [e.event, e.value])).toEqual([
      ['input', 'A'],
      ['change', 'Al']
    ]);
  });

  it('is idempotent and exposes itself on the window', () => {
    expect(installTrustedFormDebug()).toBe(api);
    expect(featheryWindow().__featheryTrustedForm).toBe(api);
  });
});

describe('isTrustedFormDebugEnabled', () => {
  afterEach(() => featheryWindow().localStorage.removeItem(TF_DEBUG_FLAG));

  it('is off by default', () => {
    expect(isTrustedFormDebugEnabled()).toBe(false);
  });

  it('turns on from localStorage', () => {
    featheryWindow().localStorage.setItem(TF_DEBUG_FLAG, '1');
    expect(isTrustedFormDebugEnabled()).toBe(true);
  });
});

describe('whenDomSettles', () => {
  it('waits for mutations to stop before resolving', async () => {
    const root = featheryDoc().body;
    root.innerHTML = '';
    let settled = false;
    const promise = whenDomSettles(root, 30, 1000).then(() => {
      settled = true;
    });
    for (let i = 0; i < 3; i++) {
      root.appendChild(featheryDoc().createElement('div'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(settled).toBe(false);
    await promise;
    expect(root.children).toHaveLength(3);
  });
});
