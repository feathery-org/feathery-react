import { fieldValues } from '../utils/init';
import { encodeGetParams } from '../utils/primitives';

export function transformCalendlyParams(config: any) {
  if (!config) return '';

  const params = { ...config.prefill_info, ...config.custom_questions };
  const newParams = Object.entries(params)
    .map(([cKey, { key }]: any[]) => [cKey, fieldValues[key]])
    .reduce((cur, [cKey, val]) => {
      return { ...cur, [cKey]: val };
    }, {});
  return encodeGetParams(newParams);
}

export function isCalendlyWindowEvent(e: any) {
  return (
    e.origin === 'https://calendly.com' &&
    e.data.event &&
    e.data.event.indexOf('calendly.') === 0
  );
}
