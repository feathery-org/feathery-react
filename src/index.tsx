import React from 'react';
import ReactDOM from 'react-dom';
import Elements from './elements';
import Form, { FormContext, Props as FormProps } from './Form';
import {
  init,
  updateUserId,
  setValues,
  validateStep,
  fieldValues,
  setAuthClient,
  getAuthClient
} from './utils/init';
import { OPERATOR_CODE } from './utils/logic';
import { featheryDoc } from './utils/browser';

function getAllValues() {
  // Make a copy so users can't set fieldValues directly
  return { ...fieldValues };
}

/**
 * Utility function which renders a form with the provided props in the DOM element with the provided ID.
 * @param {string} elementId The ID of the DOM element to hold the form
 * @param {Object} props The props defined on the *Form* component
 */
function renderAt(elementId: any, props: FormProps) {
  const container = featheryDoc().getElementById(elementId);

  ReactDOM.render(<Form {...props} />, container);
}

// TODO: deprecate
const updateUserKey = updateUserId;

// Entrypoint for globally namespaced JS library
const Feathery = {
  Form,
  Elements,
  init,
  updateUserKey,
  updateUserId,
  validateStep,
  setValues,
  getAllValues,
  setAuthClient,
  getAuthClient,
  renderAt
};

export {
  Form,
  Elements,
  init,
  updateUserKey,
  updateUserId,
  validateStep,
  setValues,
  getAllValues,
  setAuthClient,
  getAuthClient,
  renderAt,
  Feathery
};
export type { OPERATOR_CODE, FormContext };
