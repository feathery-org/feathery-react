import ae from './ae';
import au from './au';
import br from './br';
import ca from './ca';
import cl from './cl';
import cn from './cn';
import co from './co';
import eg from './eg';
import es from './es';
import gb from './gb';
import gt from './gt';
import hk from './hk';
import id from './id';
import ie from './ie';
import india from './in';
import it from './it';
import jp from './jp';
import kr from './kr';
import mx from './mx';
import my from './my';
import ng from './ng';
import nz from './nz';
import pa from './pa';
import pe from './pe';
import ph from './ph';
import pt from './pt';
import ro from './ro';
import ru from './ru';
import th from './th';
import us, { onlyStates } from './us';
import za from './za';
import React from 'react';

export const stateMap: Record<string, { name: string; code: string }[]> = {
  ae,
  au,
  br,
  ca,
  cl,
  cn,
  co,
  eg,
  es,
  gb,
  gt,
  hk,
  id,
  ie,
  in: india,
  it,
  jp,
  kr,
  mx,
  my,
  ng,
  nz,
  pa,
  pe,
  ph,
  pt,
  ro,
  ru,
  th,
  us,
  za
};

export function hasState(
  country: string,
  state: string,
  shortcode: boolean,
  coerce = false
) {
  if (coerce && !(country in stateMap)) return true;
  const stateVals = (stateMap[country] ?? []).map(({ name, code }: any) =>
    shortcode ? code : name
  );
  return stateVals.includes(state);
}

export function getStateOptions(
  country: string,
  shortcode: boolean,
  territories: boolean
) {
  let stateOptions = stateMap[country] ?? [];
  if (country === 'us' && !territories) stateOptions = onlyStates;
  return stateOptions.map(({ name, code }) => (
    <option key={code} value={shortcode ? code : name}>
      {name}
    </option>
  ));
}
