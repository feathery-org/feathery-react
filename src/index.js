import React from 'react';
import ReactDOM from 'react-dom';
import Elements from './elements';
import Form from './form/Form';
import { init, updateUserKey } from './utils/init';

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
const Feathery = { Form, Elements, init, updateUserKey, renderAt };

export { Form, Elements, init, updateUserKey, renderAt, Feathery };
