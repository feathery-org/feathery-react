import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

describe('generic content-control binding primitive', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('creates a tracked input binding in an ordinary paragraph and rejects exactly', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const baseline = await session.call<string>('serialize');
    const heading = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Project cost estimate'
    );

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'create_binding',
          group: 'g01-create-budget',
          anchor: heading.anchor,
          kind: 'input',
          name: 'project_budget',
          valueType: 'currency:USD:2',
          initial: '$1,000.00'
        }
      ],
      'generic-paragraph-binding'
    );

    expect(result).toMatchObject({ outcomes: ['ok'] });
    expect(result.groups).toBe(1);
    expect(await session.call<string>('serialize')).toContain(
      'name=project_budget'
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('reuses an explicit global identity without renaming it', async () => {
    await session.call(
      'open',
      JSON.stringify(buildCostsFixture({ globalTaxRate: true }))
    );
    const baseline = await session.call<string>('serialize');
    const heading = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Project cost estimate'
    );

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'create_binding',
          group: 'g02-global-tax-rate',
          anchor: heading.anchor,
          kind: 'input',
          name: 'tax_rate',
          valueType: 'percent',
          global: true,
          initial: '0%'
        }
      ],
      'generic-global-binding'
    );

    expect(result.outcomes).toEqual(['ok']);
    const taxTags = (await session.call<string[]>('serializedTags')).filter(
      (tag) => tag.includes('name=tax_rate')
    );
    expect(taxTags).toHaveLength(3);
    expect(new Set(taxTags)).toEqual(
      new Set(['[[name=tax_rate|type=percent|del=keep|global=true]]'])
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('binds one paragraph in a multi-paragraph cell without deleting its siblings', async () => {
    const fixture = buildCostsFixture() as any;
    const costsTable = fixture.sections[0].blocks[2].blocks[0];
    costsTable.rows[1].cells[0].blocks = [
      { inlines: [{ text: 'Keep this paragraph' }] },
      { inlines: [{ text: 'Bind this paragraph' }] }
    ];
    await session.call('open', JSON.stringify(fixture));
    const baseline = await session.call<string>('serialize');
    const target = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Bind this paragraph'
    );

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'create_binding',
          group: 'g03-bind-second-paragraph',
          anchor: target.anchor,
          expect: 'Bind this paragraph',
          kind: 'input',
          name: 'second_paragraph'
        }
      ],
      'multi-paragraph-cell-binding'
    );

    expect(result.outcomes).toEqual(['ok']);
    const serialized = await session.call<string>('serialize');
    expect(serialized).toContain('Keep this paragraph');
    expect(serialized).toContain('Bind this paragraph');
    expect(serialized).toContain('name=second_paragraph');

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);
});
