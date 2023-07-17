import React from 'react';
import ReactDOM, { unmountComponentAtNode } from 'react-dom';
import Elements from './elements';
import Form, { JSForm, Props as FormProps, StyledContainer } from './Form';
import { init, updateUserId, setFieldValues, fieldValues } from './utils/init';
import { OPERATOR_CODE } from './utils/logic';
import { featheryDoc } from './utils/browser';
import { getFormContext } from './utils/formContext';
import { v4 as uuidv4 } from 'uuid';
import { FormContext } from './types/Form';
import LoginForm from './auth/LoginForm';
import useAuthClient from './auth/useAuthClient';
import './utils/polyfills';

function getAllValues() {
  // Make a copy so users can't set fieldValues directly
  return { ...fieldValues };
}

const mountedForms: Record<string, boolean> = {};
/**
 * Utility function which renders a form with the provided props in the DOM element with the provided ID.
 * @param {string} elementId The ID of the DOM element to hold the form
 * @param {Object} props The props defined on the *Form* component
 */
function renderAt(elementId: any, props: FormProps) {
  const container = featheryDoc().getElementById(elementId);
  const destroy = () => unmountComponentAtNode(container);
  if (mountedForms[elementId]) destroy();
  else mountedForms[elementId] = true;

  const uuid = uuidv4();

  ReactDOM.render(<JSForm {...props} _internalId={uuid} />, container);

  return {
    ...getFormContext(uuid),
    destroy
  };
}

// Entrypoint for globally namespaced JS library
const Feathery = {
  Form,
  Elements,
  init,
  updateUserId,
  setFieldValues,
  getAllValues,
  renderAt
};

export {
  Form,
  Elements,
  init,
  updateUserId,
  setFieldValues,
  getAllValues,
  renderAt,
  LoginForm,
  useAuthClient,
  Feathery,
  StyledContainer
};

export type { OPERATOR_CODE, FormContext };
export type { StyledContainerProps } from './Form/grid/StyledContainer';
