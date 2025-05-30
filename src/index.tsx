import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import Elements from './elements';
import Form, { JSForm, Props as FormProps, StyledContainer } from './Form';
import {
  init,
  updateUserId,
  setFieldValues,
  getFieldValues
} from './utils/init';
import { OPERATOR_CODE } from './utils/logic';
import { featheryDoc } from './utils/browser';
import { getFormContext } from './utils/formContext';
import { v4 as uuidv4 } from 'uuid';
import { FormContext } from './types/Form';
import LoginForm from './auth/LoginForm';
import useAuthClient from './auth/useAuthClient';
import './utils/polyfills';

const mountedForms: Record<string, Root> = {};
/**
 * Utility function which renders a form with the provided props in the DOM element with the provided ID.
 * @param {string} elementId The ID of the DOM element to hold the form
 * @param {Object} props The props defined on the *Form* component
 */
function renderAt(elementId: any, props: FormProps, loginEnabled = false) {
  const container = featheryDoc().getElementById(elementId);

  if (mountedForms[elementId]) {
    mountedForms[elementId].unmount();
  }

  const root = createRoot(container);
  const destroy = () => {
    if (mountedForms[elementId]) {
      mountedForms[elementId].unmount();
      delete mountedForms[elementId];
    }
  };
  mountedForms[elementId] = root;

  const uuid = uuidv4();

  const formProps = { ...props, _internalId: uuid };

  const component = loginEnabled ? (
    <LoginForm formProps={formProps} />
  ) : (
    <JSForm {...formProps} />
  );

  root.render(component);

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
  getFieldValues,
  renderAt
};

export {
  Form,
  Elements,
  init,
  updateUserId,
  setFieldValues,
  getFieldValues,
  renderAt,
  LoginForm,
  useAuthClient,
  Feathery,
  StyledContainer
};

export type { OPERATOR_CODE, FormContext };
export type { StyledContainerProps } from './Form/grid/StyledContainer';
