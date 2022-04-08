import React from 'react';
import ReactDOM from 'react-dom';
import Elements from './elements';
import Form from './form/Form';
import { init, updateUserKey, setValues, fieldValues } from './utils/init';

function getAllValues() {
  // Make a copy so users can't set fieldValues directly
  return { ...fieldValues };
}

/**
 * Utility function which renders a form with the provided props in the DOM element with the provided ID.
 * @param {string} elementId The ID of the DOM element to hold the form
 * @param {Object} props The props defined on the *Form* component
 */
function renderAt(elementId, props) {
  const container = document.getElementById(elementId);
  ReactDOM.render(<Form {...props} />, container);
}

// Entrypoint for globally namespaced JS library
const Feathery = {
  Form,
  Elements,
  init,
  updateUserKey,
  setValues,
  getAllValues,
  renderAt
};

export {
  Form,
  Elements,
  init,
  updateUserKey,
  setValues,
  getAllValues,
  renderAt,
  Feathery
};
