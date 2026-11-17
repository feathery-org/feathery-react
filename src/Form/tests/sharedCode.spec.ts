import { extractExportedCodeInfoArray, runClientSideLogic } from '../logic';

jest.mock('../../utils/formHelperFunctions', () => ({
  httpHelpers: () => ({}),
  processFileValues: jest.fn(),
  rerenderAllForms: jest.fn()
}));

const runRuleImporting = (
  sharedCode: string,
  ruleCode: string,
  fields: Record<string, { value: unknown }> = {}
) =>
  runClientSideLogic(
    { id: 'rule-1', name: 'Rule', code: ruleCode } as any,
    {},
    extractExportedCodeInfoArray([
      { key: 'helpers', code: sharedCode, valid: true } as any
    ]),
    { fields } as any,
    [],
    {}
  );

describe('extractExportedCodeInfoArray', () => {
  it('keeps shared code whose stored valid flag is false', () => {
    const extracted = extractExportedCodeInfoArray([
      {
        key: 'helpers',
        code: "export function greet() { return 'hi'; }",
        valid: false
      } as any
    ]);
    expect(extracted.map((info) => info.key)).toEqual(['helpers']);
    expect(extracted[0].exportFunctions.map((f) => f.name)).toEqual(['greet']);
  });
});

describe('inlining shared code into a logic rule', () => {
  it("brings a helper's own dependencies along", async () => {
    const sharedCode = `
      const ADDRESS_FIELDS = ['street', 'city'];
      function formatAddress(address) {
        return ADDRESS_FIELDS.map((key) => address[key]).join(', ');
      }
      export function shippingLabel(address) {
        return 'Ship to ' + formatAddress(address);
      }
    `;
    const ruleCode = `
      import { shippingLabel } from 'helpers';
      return shippingLabel({ street: '1 Main St', city: 'Springfield' });
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe(
      'Ship to 1 Main St, Springfield'
    );
  });

  it('resolves helpers declared after the export', async () => {
    const sharedCode = `
      export function total(prices) {
        return applyTax(prices.reduce((sum, price) => sum + price, 0));
      }
      function applyTax(amount) {
        return amount * (1 + TAX_RATE);
      }
      const TAX_RATE = 0.5;
    `;
    const ruleCode = `
      import { total } from 'helpers';
      return total([2, 4]);
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe(9);
  });

  it('follows a three-level chain through an exported arrow function', async () => {
    const sharedCode = `
      const GREETING = 'Hello';
      const salute = (name) => GREETING + ', ' + name;
      function welcome(name) { return salute(name) + '!'; }
      export const greet = (name) => welcome(name);
    `;
    const ruleCode = `
      import { greet } from 'helpers';
      return greet('Ada');
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe(
      'Hello, Ada!'
    );
  });

  it('evaluates an exported constant built from other declarations', async () => {
    const sharedCode = `
      const STREET = 'street';
      const fieldKey = (name) => 'address_' + name;
      export const ADDRESS_FIELDS = [fieldKey(STREET), fieldKey('city')];
    `;
    const ruleCode = `
      import { ADDRESS_FIELDS } from 'helpers';
      return ADDRESS_FIELDS;
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toEqual([
      'address_street',
      'address_city'
    ]);
  });

  it('awaits an exported constant whose initializer awaits a helper', async () => {
    const sharedCode = `
      const loadRate = async () => 0.5;
      export const RATE = await loadRate();
    `;
    const ruleCode = `
      import { RATE } from 'helpers';
      return RATE;
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe(0.5);
  });

  it('leaves out declarations the export never reaches', async () => {
    const sharedCode = `
      const USED = 1;
      const UNUSED = (() => { throw new Error('evaluated'); })();
      export function value() { return USED; }
    `;
    const ruleCode = `
      import { value } from 'helpers';
      return value();
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe(1);
  });

  it('reads the current field value each time a helper is called', async () => {
    const sharedCode = `
      const doubled = price.value * 2;
      export function getDoubled() { return doubled; }
    `;
    const ruleCode = `
      import { getDoubled } from 'helpers';
      const first = getDoubled();
      price.value = 10;
      return [first, getDoubled()];
    `;

    await expect(
      runRuleImporting(sharedCode, ruleCode, { price: { value: 1 } })
    ).resolves.toEqual([2, 20]);
  });

  it('skips a field read when the rule never calls the helper', async () => {
    const sharedCode = `
      const upper = name.value.toUpperCase();
      export function shout() { return upper + '!'; }
    `;
    const ruleCode = `
      import { shout } from 'helpers';
      if (!name.value) return 'skipped';
      return shout();
    `;

    await expect(
      runRuleImporting(sharedCode, ruleCode, { name: { value: null } })
    ).resolves.toBe('skipped');
  });

  it("keeps a helper's own parameters and locals apart from module declarations", async () => {
    const sharedCode = `
      export function report(label) {
        const total = 2;
        return label + ': ' + total;
      }
      const label = 'Total';
      const total = 1;
    `;
    const ruleCode = `
      import { report } from 'helpers';
      return report('Q3');
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe('Q3: 2');
  });

  it('leaves out a declaration whose initializer calls the helper', async () => {
    const sharedCode = `
      export function formatPrice(amount) {
        return amount == null ? EMPTY_PRICE : '$' + amount.toFixed(2);
      }
      const EMPTY_PRICE = formatPrice(0);
    `;
    const ruleCode = `
      import { formatPrice } from 'helpers';
      return formatPrice(5);
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe('$5.00');
  });

  it('leaves an awaited declaration out of a synchronous helper', async () => {
    const sharedCode = `
      export function withRate(amount) { return amount * RATE; }
      export function label(amount) { return 'Amount: ' + amount; }
      const loadRate = async () => 0.5;
      const RATE = await loadRate();
    `;
    const ruleCode = `
      import { withRate, label } from 'helpers';
      return label(4);
    `;

    await expect(runRuleImporting(sharedCode, ruleCode)).resolves.toBe(
      'Amount: 4'
    );
  });
});
