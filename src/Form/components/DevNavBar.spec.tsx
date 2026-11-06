import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DevNavBar from './DevNavBar';

it('brings the expanded test controls into view when reopened', () => {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  );
  const scrollIntoView = jest.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView
  });
  const step = {
    id: 'contact',
    key: 'Contact',
    origin: true,
    previous_conditions: [],
    next_conditions: []
  };

  try {
    render(
      <DevNavBar
        allSteps={{ Contact: step }}
        curStep={step}
        changeStep={jest.fn()}
        formName='Renewal review'
      />
    );
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Hide test controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show test controls' }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const revealedElement = scrollIntoView.mock.instances[0] as HTMLElement;
    expect(
      revealedElement.contains(
        screen.getByRole('button', { name: 'Hide test controls' })
      )
    ).toBe(true);
  } finally {
    cleanup();
    if (original)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});
