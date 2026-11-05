import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { setShapeGeometry } from '../core/model/edit';
import { renderSlideSvg } from '../core/render/svg';
import { readChartData } from '../core/model/chart';
import { deckToJSON } from '../core/model/json';
import {
  child,
  childrenOf,
  descendant,
  el,
  getAttr,
  root,
  setAttr
} from '../core/opc/xml';

it('imports chart graphic frames as charts and resolves their chart parts', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/charts.pptx')))
  );
  expect(deck.slides[0].shapes.map((shape) => shape.type)).toEqual([
    'chart',
    'chart',
    'chart'
  ]);
  expect(deck.slides[0].shapes.map((shape) => shape.chartPart)).toEqual([
    'ppt/charts/chart1.xml',
    'ppt/charts/chart2.xml',
    'ppt/charts/chart3.xml'
  ]);
});

it('renders column, line, and pie chart cache data as native SVG marks', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/charts.pptx')))
  );
  const svg = renderSlideSvg(deck, deck.slides[0]);
  expect(svg.querySelectorAll('[data-chart]')).toHaveLength(3);
  expect(svg.querySelectorAll('[data-chart-mark="bar"]')).toHaveLength(6);
  expect(svg.querySelectorAll('[data-chart-mark="line"]')).toHaveLength(2);
  expect(svg.querySelectorAll('[data-chart-mark="point"]')).toHaveLength(8);
  expect(svg.querySelectorAll('[data-chart-mark="slice"]')).toHaveLength(3);
  expect(svg.textContent).toContain('Revenue');
  expect(svg.textContent).toContain('Growth');
  expect(svg.textContent).toContain('Mix');
  expect(svg.textContent).toContain('Q1');
});

it('resolves package-root-relative chart relationships used by PowerPoint-authored decks', () => {
  const deck = importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/charts-absolute-rels.pptx'))
    )
  );
  expect(deck.slides[0].shapes.map((shape) => shape.chartPart)).toEqual([
    'ppt/charts/chart1.xml',
    'ppt/charts/chart2.xml',
    'ppt/charts/chart3.xml'
  ]);
  expect(
    renderSlideSvg(deck, deck.slides[0]).querySelectorAll('[data-chart-mark]')
  ).toHaveLength(19);
});

it('renders radar charts used by the downloaded showcase deck', () => {
  const deck = importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/radar-chart.pptx'))
    )
  );
  const svg = renderSlideSvg(deck, deck.slides[0]);
  expect(svg.querySelector('[data-chart-type="radar"]')).toBeTruthy();
  expect(svg.querySelectorAll('[data-chart-mark="radar"]')).toHaveLength(2);
  expect(svg.querySelectorAll('[data-chart-mark="point"]')).toHaveLength(12);
  expect(svg.textContent).toContain('Fidelity');
});

it('renders every plot in a column-and-line combo chart', () => {
  const deck = importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/combo-chart.pptx'))
    )
  );
  const combo = renderSlideSvg(deck, deck.slides[0]).querySelector(
    '[data-chart-type="combo"]'
  )!;
  expect(combo.querySelectorAll('[data-chart-mark="bar"]')).toHaveLength(3);
  expect(combo.querySelectorAll('[data-chart-mark="line"]')).toHaveLength(1);
  expect(combo.querySelectorAll('[data-chart-mark="point"]')).toHaveLength(3);
});

it('uses a PowerPoint-like 10-unit secondary scale and keeps dual-axis labels on their tick positions', () => {
  const deck = importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/combo-chart.pptx'))
    )
  );
  const chartRoot = root(deck.pkg.tree('ppt/charts/chart1.xml'));
  const plotArea = descendant(chartRoot, 'c:plotArea')!;
  const linePlot = descendant(chartRoot, 'c:lineChart')!;
  const secondaryCategoryId = 31001;
  const secondaryValueId = 31002;
  childrenOf(linePlot).push(
    el('c:axId', { val: String(secondaryCategoryId) }),
    el('c:axId', { val: String(secondaryValueId) })
  );
  childrenOf(plotArea).push(
    el('c:valAx', undefined, [
      el('c:axId', { val: String(secondaryValueId) }),
      el('c:scaling', undefined, [
        el('c:min', { val: '0' }),
        el('c:max', { val: '100' })
      ]),
      el('c:delete', { val: '0' }),
      el('c:axPos', { val: 'r' }),
      el('c:majorTickMark', { val: 'out' }),
      el('c:tickLblPos', { val: 'nextTo' }),
      el('c:crossAx', { val: String(secondaryCategoryId) })
    ]),
    el('c:catAx', undefined, [
      el('c:axId', { val: String(secondaryCategoryId) }),
      el('c:scaling'),
      el('c:delete', { val: '1' }),
      el('c:axPos', { val: 'b' }),
      el('c:crossAx', { val: String(secondaryValueId) })
    ])
  );

  const chart = readChartData(deck.pkg, 'ppt/charts/chart1.xml')!;
  const secondary = chart.axes.find((axis) => axis.id === secondaryValueId)!;
  expect(chart.plots.find((plot) => plot.kind === 'line')).toMatchObject({
    yAxisId: secondaryValueId
  });
  expect(secondary).toMatchObject({
    dimension: 'y',
    role: 'secondary',
    seriesIndexes: [1]
  });
  expect(secondary.resolvedScale).toMatchObject({
    min: 0,
    max: 100,
    majorUnit: 10,
    tickValues: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  });

  const combo = renderSlideSvg(deck, deck.slides[0]).querySelector(
    '[data-chart-type="combo"]'
  )!;
  const labels = [
    ...combo.querySelectorAll('[data-chart-axis-label="secondary"]')
  ];
  expect(labels.map((label) => label.textContent)).toEqual([
    '0',
    '10',
    '20',
    '30',
    '40',
    '50',
    '60',
    '70',
    '80',
    '90',
    '100'
  ]);
  for (const label of labels) {
    const value = label.getAttribute('data-chart-axis-value');
    const tick = combo.querySelector(
      `[data-chart-axis-tick="secondary"][data-chart-axis-value="${value}"]`
    );
    expect(tick?.parentElement).toBe(label.parentElement);
  }
});

it('renders a single-series legend and horizontal and vertical axis titles', () => {
  const deck = importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/chart-labels.pptx'))
    )
  );
  const chart = renderSlideSvg(deck, deck.slides[0]).querySelector(
    '[data-chart]'
  )!;
  const legend = chart.querySelector('[data-chart-legend]')!;
  expect(legend).toBeTruthy();
  expect(legend.getAttribute('data-legend-position')).toBe('b');
  const legendText = legend.querySelector('text')!;
  // No legend-local txPr: PowerPoint inherits the chartSpace 18pt default.
  expect(Number(legendText.getAttribute('font-size'))).toBeCloseTo(
    (18 * 96) / 72
  );
  expect(legendText.parentElement?.getAttribute('transform')).toContain(
    'scale(9525)'
  );
  expect(
    chart.querySelector('[data-chart-axis-title="horizontal"]')?.textContent
  ).toBe('Quarter');
  expect(
    chart.querySelector('[data-chart-axis-title="vertical"]')?.textContent
  ).toBe('Revenue ($M)');
  expect(chart.textContent).toContain('Legend series');
  const jsonChart = deckToJSON(deck).slides[0].shapes.find(
    (shape) => shape.chart
  )!.chart!;
  expect(jsonChart.defaultTextStyle).toMatchObject({ sizePt: 18 });
  expect(jsonChart.axes.find((axis) => axis.type === 'category')).toMatchObject(
    { majorTickMark: 'out', labelOffsetPct: 100 }
  );
});

it('keeps series fill separate from its outline and projects per-point chart colors', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/charts.pptx')))
  );
  const part = 'ppt/charts/chart1.xml';
  const series = descendant(root(deck.pkg.tree(part)), 'c:ser')!;
  const existing = child(series, 'c:spPr');
  if (existing)
    childrenOf(series).splice(childrenOf(series).indexOf(existing), 1);
  childrenOf(series).push(
    el('c:spPr', undefined, [
      el('a:solidFill', undefined, [el('a:schemeClr', { val: 'accent1' })]),
      el('a:ln', undefined, [
        el('a:solidFill', undefined, [el('a:srgbClr', { val: 'F9F9F9' })])
      ])
    ]),
    el('c:dPt', undefined, [
      el('c:idx', { val: '0' }),
      el('c:spPr', undefined, [
        el('a:solidFill', undefined, [el('a:srgbClr', { val: 'FF6B4A' })])
      ])
    ])
  );
  const chart = readChartData(deck.pkg, part)!;
  expect(chart.series[0]).toMatchObject({
    color: 'scheme:accent1',
    lineColor: '#F9F9F9',
    pointColors: { 0: '#FF6B4A' }
  });
});

it('uses scatterStyle to decide whether scatter points are connected', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/charts.pptx')))
  );
  const shape = deck.slides[0].shapes.find(
    (candidate) => candidate.chartPart === 'ppt/charts/chart2.xml'
  )!;
  const chartRoot = root(deck.pkg.tree(shape.chartPart!));
  const plot = descendant(chartRoot, 'c:lineChart')!;
  plot['c:scatterChart'] = plot['c:lineChart'];
  delete plot['c:lineChart'];
  const style = el('c:scatterStyle', { val: 'marker' });
  childrenOf(plot).unshift(style);
  expect(readChartData(deck.pkg, shape.chartPart!)!.plots[0].scatterStyle).toBe(
    'marker'
  );
  let group = renderSlideSvg(deck, deck.slides[0]).querySelector(
    `[data-shape-id="${shape.id}"]`
  )!;
  expect(group.querySelectorAll('[data-chart-mark="line"]')).toHaveLength(0);
  expect(group.querySelectorAll('[data-chart-mark="point"]')).toHaveLength(8);
  setAttr(style, 'val', 'lineMarker');
  group = renderSlideSvg(deck, deck.slides[0]).querySelector(
    `[data-shape-id="${shape.id}"]`
  )!;
  expect(group.querySelectorAll('[data-chart-mark="line"]')).toHaveLength(2);
  expect(group.querySelectorAll('[data-chart-mark="point"]')).toHaveLength(8);

  for (const series of childrenOf(plot).filter((node) => !!node['c:ser'])) {
    childrenOf(series).push(
      el('c:spPr', undefined, [el('a:ln', undefined, [el('a:noFill')])])
    );
  }
  const chart = readChartData(deck.pkg, shape.chartPart!)!;
  expect(chart.series.map((series) => series.lineVisible)).toEqual([
    false,
    false
  ]);
  expect(
    deckToJSON(deck)
      .slides[0].shapes.find((candidate) => candidate.id === shape.id)
      ?.chart?.series.map((series) => series.lineVisible)
  ).toEqual([false, false]);
  group = renderSlideSvg(deck, deck.slides[0]).querySelector(
    `[data-shape-id="${shape.id}"]`
  )!;
  expect(group.querySelectorAll('[data-chart-mark="line"]')).toHaveLength(0);
  expect(group.querySelectorAll('[data-chart-mark="point"]')).toHaveLength(8);
});

it('binds scatter X and Y value axes separately and preserves the PowerPoint tick interval in JSON', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/charts.pptx')))
  );
  const shape = deck.slides[0].shapes.find(
    (candidate) => candidate.chartPart === 'ppt/charts/chart2.xml'
  )!;
  const chartRoot = root(deck.pkg.tree(shape.chartPart!));
  const plot = descendant(chartRoot, 'c:lineChart')!;
  plot['c:scatterChart'] = plot['c:lineChart'];
  delete plot['c:lineChart'];
  childrenOf(plot).unshift(el('c:scatterStyle', { val: 'marker' }));

  const categoryAxis = descendant(chartRoot, 'c:catAx')!;
  categoryAxis['c:valAx'] = categoryAxis['c:catAx'];
  delete categoryAxis['c:catAx'];
  const valueAxes = childrenOf(descendant(chartRoot, 'c:plotArea')!).filter(
    (node) => !!node['c:valAx']
  );
  const xAxis = valueAxes.find((axis) => getAxisPosition(axis) === 'b')!;
  const yAxis = valueAxes.find((axis) => getAxisPosition(axis) === 'l')!;
  childrenOf(xAxis).push(el('c:majorUnit', { val: '20' }));
  childrenOf(yAxis).push(el('c:majorUnit', { val: '10' }));

  const chart = readChartData(deck.pkg, shape.chartPart!)!;
  const chartPlot = chart.plots[0];
  expect(
    chart.axes.find((axis) => axis.id === chartPlot.xAxisId)
  ).toMatchObject({ dimension: 'x', position: 'b', majorUnit: 20 });
  expect(
    chart.axes.find((axis) => axis.id === chartPlot.yAxisId)
  ).toMatchObject({
    dimension: 'y',
    position: 'l',
    majorUnit: 10,
    resolvedScale: { majorUnit: 10, majorUnitAutomatic: false }
  });
  const jsonChart = deckToJSON(deck).slides[0].shapes.find(
    (candidate) => candidate.id === shape.id
  )!.chart!;
  expect(jsonChart.plots[0]).toMatchObject({
    xAxisId: chartPlot.xAxisId,
    yAxisId: chartPlot.yAxisId
  });
  expect(
    jsonChart.axes.find((axis) => axis.dimension === 'y')?.resolvedScale
  ).toMatchObject({ majorUnit: 10, majorUnitAutomatic: false });

  const group = renderSlideSvg(deck, deck.slides[0]).querySelector(
    `[data-shape-id="${shape.id}"]`
  )!;
  const yLabels = [
    ...group.querySelectorAll('[data-chart-axis-label="primary"]')
  ].map((label) => label.textContent);
  expect(yLabels).toEqual(['0', '10']);
});

function getAxisPosition(axis: ReturnType<typeof descendant>) {
  return getAttr(child(axis!, 'c:axPos') || {}, 'val');
}

it('uses radarStyle to distinguish outline and filled radar plots', () => {
  const deck = importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/radar-chart.pptx'))
    )
  );
  const plot = descendant(
    root(deck.pkg.tree('ppt/charts/chart1.xml')),
    'c:radarChart'
  )!;
  const style = child(plot, 'c:radarStyle')!;
  setAttr(style, 'val', 'standard');
  let radar = renderSlideSvg(deck, deck.slides[0]).querySelector(
    '[data-chart-mark="radar"]'
  )!;
  expect(radar.getAttribute('fill')).toBe('none');
  setAttr(style, 'val', 'filled');
  const chart = readChartData(deck.pkg, 'ppt/charts/chart1.xml')!;
  expect(chart.plots[0].radarStyle).toBe('filled');
  radar = renderSlideSvg(deck, deck.slides[0]).querySelector(
    '[data-chart-mark="radar"]'
  )!;
  expect(radar.getAttribute('fill')).not.toBe('none');
  expect(radar.getAttribute('fill-opacity')).toBeTruthy();
});

it('preserves a chart relationship and its chart XML after moving and exporting it', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/charts.pptx')))
  );
  const slide = deck.slides[0];
  setShapeGeometry(deck, slide, slide.shapes[0], { x: 500000, y: 600000 });
  const saved = importDeck(exportDeckBytes(deck));
  const chart = saved.slides[0].shapes[0];
  expect(chart.type).toBe('chart');
  expect(chart.chartPart).toBe('ppt/charts/chart1.xml');
  expect(chart.xfrm).toMatchObject({ x: 500000, y: 600000 });
  expect(
    renderSlideSvg(saved, saved.slides[0]).querySelectorAll(
      '[data-chart-mark="bar"]'
    )
  ).toHaveLength(6);
});
