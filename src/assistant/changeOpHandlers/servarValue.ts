import { setFieldValues } from '../../utils/init';
import internalState from '../../utils/internalState';
import type { ResourceHandler } from './types';

/**
 * Handler for `target.type === 'servar_value'` ChangeOps. Mirrors a
 * Builder resource handler but operates on form-runtime field state
 * instead of dashboard Redux state.
 *
 * `update` is the only op shape currently emitted by the Assistant;
 * create/delete have no meaning for a value write so they're unbound.
 */
export const servarValueHandler: ResourceHandler = {
  update: async (op, { formUuid }) => {
    if (!formUuid) return;
    const state = internalState[formUuid];
    if (!state) return;
    const fieldKey = op.target.id;
    const value = op.payload?.value;
    setFieldValues({ [fieldKey]: value as never }, true, true);
  },
};
