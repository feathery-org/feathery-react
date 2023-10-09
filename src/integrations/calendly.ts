import { fieldValues } from '../utils/init';
import { encodeGetParams } from '../utils/primitives';

export function transformCalendlyParams(params: any) {
  if (!params) return '';
  const newParams = Object.entries(params)
    .map(([cKey, { key }]: any[]) => [cKey, fieldValues[key]])
    .reduce((cur, [cKey, val]) => {
      return { ...cur, [cKey]: val };
    }, {});
  return encodeGetParams(newParams);
}
