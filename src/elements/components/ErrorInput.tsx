import React, { ComponentProps } from 'react';
import { FORM_Z_INDEX } from '../../utils/styles';
import { iosScrollOnFocus } from '../../utils/browser';

export default function ErrorInput(props: ComponentProps<'input'>) {
  return (
    <input
      // Properties to disable all focus/input but still allow displaying errors
      // type="text", file inputs open a file picker on focus, instead we just use a text input
      // inputMode="none" this prevents the virtual keyboard from displaying on mobile devices caused by using text input
      // tabIndex={-1} prevents the user from accessing the field using the keyboard
      // pointerEvents: 'none' prevents clicking on the element, in the case they somehow are able to click it
      // onFocus and onClick are cancelled for a similar reason
      type='text'
      inputMode='none'
      onFocus={(e) => {
        iosScrollOnFocus(e);
        e.preventDefault();
      }}
      onClick={(e) => e.preventDefault()}
      tabIndex={-1}
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        opacity: 0,
        bottom: 0,
        left: '50%',
        width: '1px',
        height: '1px',
        zIndex: FORM_Z_INDEX - 2
      }}
      {...props}
    />
  );
}
