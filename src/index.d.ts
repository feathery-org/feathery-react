/// <reference types="react" />
import Elements from './elements';
import { Form, FormProps } from './form/Form';
import {
  init,
  updateUserKey,
  setValues,
  validateStep,
  FieldValues,
  setAuthClient,
  getAuthClient
} from './utils/init';

declare function getAllValues(): FieldValues;

/**
 * Utility function which renders a form with the provided props in the DOM element with the provided ID.
 * @param {string} elementId The ID of the DOM element to hold the form
 * @param {Object} props The props defined on the *Form* component
 */
declare function renderAt(elementId: string, props: FormProps): void;
declare const Feathery: {
  Form: typeof Form;
  Elements: typeof Elements;
  init: typeof init;
  updateUserKey: typeof updateUserKey;
  validateStep: typeof validateStep;
  setValues: typeof setValues;
  getAllValues: typeof getAllValues;
  getAuthClient: typeof getAuthClient;
  setAuthClient: typeof setAuthClient;
  renderAt: typeof renderAt;
};

export {
  Form,
  Elements,
  init,
  updateUserKey,
  validateStep,
  setValues,
  getAllValues,
  getAuthClient,
  setAuthClient,
  renderAt,
  Feathery
};
