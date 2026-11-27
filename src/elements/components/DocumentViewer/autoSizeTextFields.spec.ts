import 'jest-canvas-mock';
import { featheryDoc } from '../../../utils/browser';
import { fitAutoSizedTextFields } from './autoSizeTextFields';

it('fits auto-sized text on load and edit, leaving explicit sizes and other widgets alone', () => {
  const doc = featheryDoc();
  const container = doc.createElement('div');
  const inputs = ['auto', 'fixed', 'multiline', 'comb'].map((id) => {
    const input = doc.createElement('input');
    input.dataset.elementId = id;
    input.style.font = '27px Helvetica';
    input.style.padding = '2px';
    input.value = 'advisor@longcompanyname.com';
    Object.defineProperty(input, 'clientWidth', { value: 336 });
    container.append(input);
    return input;
  });
  const context = doc.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Canvas context unavailable');
  const metrics = context.measureText('');
  jest.spyOn(context, 'measureText').mockImplementation((text) => ({
    ...metrics,
    width: text.length > 10 ? 355 : 100
  }));
  const getContext = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context);
  const cleanup = fitAutoSizedTextFields(
    container,
    inputs.map((input) => ({
      id: input.dataset.elementId ?? '',
      fieldType: 'Tx',
      multiLine: input.dataset.elementId === 'multiline',
      comb: input.dataset.elementId === 'comb',
      defaultAppearanceData: {
        fontSize: input.dataset.elementId === 'fixed' ? 9 : 0
      }
    }))
  );
  const [auto, ...unchanged] = inputs;
  expect(parseFloat(auto.style.fontSize)).toBeLessThan(27);
  expect(auto.value).toBe('advisor@longcompanyname.com');
  expect(unchanged.map((input) => input.style.fontSize)).toEqual([
    '27px',
    '27px',
    '27px'
  ]);

  auto.value = 'short';
  auto.dispatchEvent(new Event('input', { bubbles: true }));
  expect(auto.style.fontSize).toBe('27px');
  auto.value = 'advisor@longcompanyname.com';
  auto.dispatchEvent(new Event('input', { bubbles: true }));
  expect(parseFloat(auto.style.fontSize)).toBeLessThan(27);

  cleanup();
  auto.style.fontSize = '27px';
  auto.dispatchEvent(new Event('input', { bubbles: true }));
  expect(auto.style.fontSize).toBe('27px');
  getContext.mockRestore();
});
