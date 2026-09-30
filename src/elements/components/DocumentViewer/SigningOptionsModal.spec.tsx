import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { featheryDoc } from '../../../utils/browser';
import SigningOptionsModal, { SigningOptions } from './SigningOptionsModal';

const values: SigningOptions = {
  recipients: [
    {
      envelope_id: 'env',
      recipient_index: 0,
      name: 'Alex',
      email: 'alex@example.com',
      routing_order: 1,
      role_labels: ['Owner']
    }
  ],
  email_subject: 'Please sign',
  email_blurb: 'Thank you'
};
const setup = (overrides = {}) => {
  const props = {
    initialValues: values,
    busy: false,
    onClose: jest.fn(),
    onSubmit: jest.fn(),
    ...overrides
  };
  return { ...render(<SigningOptionsModal {...props} />), props };
};

it('edits recipients and email across both steps without mutating defaults', async () => {
  const user = userEvent.setup();
  const { props } = setup();
  expect(screen.getByText('Owner')).toBeInTheDocument();
  await user.clear(screen.getByLabelText('Name 1'));
  await user.type(screen.getByLabelText('Name 1'), 'Sam');
  await user.clear(screen.getByLabelText('Signing order 1'));
  await user.type(screen.getByLabelText('Signing order 1'), '2');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(props.onSubmit).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Subject'));
  await user.clear(screen.getByLabelText('Message'));
  await user.type(screen.getByLabelText('Message'), 'Custom message');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Name 1')).toHaveValue('Sam');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(props.onSubmit).toHaveBeenCalledWith({
    ...values,
    recipients: [{ ...values.recipients[0], name: 'Sam', routing_order: 2 }],
    email_subject: '',
    email_blurb: 'Custom message'
  });
  expect(values.recipients[0].name).toBe('Alex');
});

it.each(['0', '-1', '1.5', ''])('rejects invalid signing order %s', (order) => {
  const { props } = setup();
  fireEvent.change(screen.getByLabelText('Signing order 1'), {
    target: { value: order }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('positive integer');
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it('validates email recipients and permits parallel in-person recipients', () => {
  const { rerender, props } = setup();
  fireEvent.change(screen.getByLabelText('Name 1'), { target: { value: ' ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('name');
  fireEvent.change(screen.getByLabelText('Name 1'), {
    target: { value: 'Alex' }
  });
  fireEvent.change(screen.getByLabelText('Email 1'), {
    target: { value: 'invalid' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('email');
  const parallel = {
    ...values,
    recipients: [
      values.recipients[0],
      {
        ...values.recipients[0],
        recipient_index: 1,
        is_self: true,
        name: '',
        email: ''
      }
    ]
  };
  rerender(
    <SigningOptionsModal
      key='parallel'
      {...props}
      initialValues={parallel}
      draft
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));
  expect(props.onSubmit).toHaveBeenCalledWith(parallel);
});

it('retains edits after server errors and blocks all actions while busy', () => {
  const { props, rerender } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Keep this' }
  });
  rerender(<SigningOptionsModal {...props} busy error='Send failed' />);
  expect(screen.getByRole('alert')).toHaveTextContent('Send failed');
  for (const button of screen.getAllByRole('button'))
    expect(button).toBeDisabled();
  expect(screen.getByLabelText('Message')).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(props.onClose).not.toHaveBeenCalled();
  rerender(<SigningOptionsModal {...props} error='Send failed' />);
  expect(screen.getByLabelText('Message')).toHaveValue('Keep this');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(props.onSubmit).toHaveBeenCalledTimes(1);
});

it('traps focus, isolates keyboard events, and restores focus on close', async () => {
  const user = userEvent.setup();
  const opener = featheryDoc().createElement('button');
  featheryDoc().body.appendChild(opener);
  opener.focus();
  const outerKey = jest.fn();
  featheryDoc().addEventListener('keydown', outerKey);
  const { unmount, props } = setup();
  expect(
    screen.getByRole('heading', { name: 'Configure signers' })
  ).toHaveFocus();
  screen.getByRole('button', { name: 'Next' }).focus();
  await user.tab();
  expect(
    screen.getByRole('button', { name: 'Close signing options' })
  ).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(outerKey).not.toHaveBeenCalled();
  unmount();
  expect(opener).toHaveFocus();
  featheryDoc().removeEventListener('keydown', outerKey);
  opener.remove();
});

it('enforces subject and message limits and rejects empty recipient lists', () => {
  const { props, rerender } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByLabelText('Subject')).toHaveAttribute('maxlength', '256');
  expect(screen.getByLabelText('Message')).toHaveAttribute(
    'maxlength',
    '10000'
  );
  fireEvent.change(screen.getByLabelText('Subject'), {
    target: { value: 'a'.repeat(257) }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('alert')).toHaveTextContent('256');
  expect(props.onSubmit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'a'.repeat(10001) }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('alert')).toHaveTextContent('10000');
  rerender(
    <SigningOptionsModal
      key='empty'
      {...props}
      initialValues={{ ...values, recipients: [] }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'No signers are configured for these documents. Close this dialog and update the signer configuration.'
  );
});

it('locks the self recipient email while allowing name and order edits', async () => {
  const user = userEvent.setup();
  const selfValues = {
    ...values,
    recipients: [{ ...values.recipients[0], is_self: true }]
  };
  const { props } = setup({ initialValues: selfValues });
  expect(screen.getByText('You')).toBeInTheDocument();
  expect(screen.getByLabelText('Email 1')).toBeDisabled();
  await user.type(screen.getByLabelText('Email 1'), 'other@example.com');
  await user.clear(screen.getByLabelText('Name 1'));
  await user.type(screen.getByLabelText('Name 1'), 'Alex Updated');
  await user.clear(screen.getByLabelText('Signing order 1'));
  await user.type(screen.getByLabelText('Signing order 1'), '2');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Send' }));
  expect(props.onSubmit).toHaveBeenCalledWith({
    ...selfValues,
    recipients: [
      { ...selfValues.recipients[0], name: 'Alex Updated', routing_order: 2 }
    ]
  });
});
