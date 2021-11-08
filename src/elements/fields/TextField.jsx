import { IMaskMixin } from 'react-imask';
import React, { memo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import { emailPatternStr } from '../../utils/formHelperFunctions';
import { useHotkeys } from 'react-hotkeys-hook';

function getTextFieldProps(servar, styles, value) {
  let methods, onlyPhone;
  switch (servar.type) {
    case 'integer_field':
      return {
        mask: servar.format === 'currency' ? '$num' : 'num',
        blocks: {
          num: {
            mask: Number,
            thousandsSeparator: ',',
            scale: 0,
            signed: false
          }
        },
        value: value.toString(),
        type: 'tel'
      };
    case 'email':
      return {
        mask: /.+/,
        type: 'email',
        pattern: emailPatternStr,
        value
      };
    case 'login':
      methods = servar.metadata.login_methods;
      onlyPhone = methods.length === 1 && methods[0] === 'phone';
      return {
        mask: methods.map((method) => {
          return {
            method,
            mask: method === 'phone' ? '(000) 000-0000' : /.+/
          };
        }),
        type: onlyPhone ? 'tel' : 'text',
        value
      };
    case 'phone_number':
      return {
        mask: '(000) 000-0000',
        type: 'tel',
        value
      };
    case 'ssn':
      return {
        mask: '000 - 00 - 0000',
        type: 'tel',
        value
      };
    case 'text_area':
      return {
        mask: /.+/,
        as: 'textarea',
        rows: styles.num_rows,
        value
      };
    case 'url':
      return {
        mask: /.+/,
        type: 'url',
        value
      };
    default:
      return {
        mask: servar.metadata.only_alpha ? /^[a-z0-9]*$/i : /.*/,
        value
      };
  }
}

function TextField({
  element,
  applyStyles,
  fieldLabel,
  required = false,
  fieldValue = '',
  onChange = () => {},
  onClick = () => {},
  inlineError,
  inputRef,
  ...fieldProps
}) {
  const servar = element.servar;
  const inputType = fieldProps.as === 'textarea' ? 'textarea' : 'input';

  console.log("fieldProp: ", fieldProps)
  useHotkeys(
    'enter',
    (e) => e.stopPropagation(),
    {
      enableOnTags: ['TEXTAREA']
    }
  );

  return (
    <div
      css={{
        maxWidth: '100%',
        ...applyStyles.getTarget('fc')
      }}
    >
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          ...(inputType === 'textarea'
            ? {}
            : {
                whiteSpace: 'nowrap',
                overflowX: 'hidden'
              }),
          ...applyStyles.getTarget('sub-fc')
        }}
      >
        <ReactForm.Control
          id={servar.key}
          css={{
            height: '100%',
            width: '100%',
            ...bootstrapStyles,
            ...applyStyles.getTarget('field'),
            ...(inlineError ? { borderColor: '#F42525' } : {}),
            '&:focus': applyStyles.getTarget('active'),
            '&:hover': applyStyles.getTarget('hover'),
            '&:not(:focus)':
              fieldValue || !element.properties.placeholder
                ? {}
                : { color: 'transparent' }
          }}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          required={required}
          onChange={onChange}
          onClick={onClick}
          autoComplete={servar.metadata.autocomplete || 'on'}
          ref={inputRef}
          placeholder=''
          {...fieldProps}
        />
        <span
          css={{
            position: 'absolute',
            pointerEvents: 'none',
            left: '0.75rem',
            transition: '0.2s ease all',
            top: inputType === 'textarea' ? '0.375rem' : '50%',
            ...applyStyles.getTarget('placeholder'),
            ...(fieldValue ? applyStyles.getTarget('placeholderFocus') : {}),
            [`${inputType}:focus + &`]: {
              ...applyStyles.getTarget('placeholderFocus'),
              ...applyStyles.getTarget('placeholderActive')
            }
          }}
        >
          {element.properties.placeholder || ''}
        </span>
        {element.properties.tooltipText && (
          <InlineTooltip
            id={`tooltip-${element.id}`}
            text={element.properties.tooltipText}
            applyStyles={applyStyles}
          />
        )}
      </div>
    </div>
  );
}

const MaskedTextField = IMaskMixin((props) => <TextField {...props} />);

const MaskedPropsTextField = ({ element, fieldValue = '', ...props }) => {
  const servar = element.servar;
  const fieldProps = getTextFieldProps(servar, element.styles, fieldValue);
  return (
    <MaskedTextField
      element={element}
      fieldValue={fieldValue}
      {...props}
      {...fieldProps}
    />
  );
};

export default memo(MaskedPropsTextField);
