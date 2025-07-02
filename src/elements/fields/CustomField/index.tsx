import React, { memo, useMemo } from 'react';
import Status from './Status';
import { useCustomComponentIframe } from './useCustomComponentIframe';
import ErrorInput from '../../components/ErrorInput';

const CustomField = ({
  element,
  elementProps = {},
  responsiveStyles,
  onChange,
  rawValue,
  required,
  disabled,
  fieldStyles,
  editMode,
  rightToLeft,
  index
}: any) => {
  const componentCode = element.servar.metadata.code;
  const isCodeEmpty = !componentCode || componentCode.trim() === '';
  const showPlaceholder = isCodeEmpty && editMode;

  const customFieldProps = useMemo(
    () => ({
      fieldProperties: {
        description: element.servar.name,
        required,
        disabled,
        custom: element.servar.metadata?.custom || {},
        aria_label: element.properties.aria_label
      },
      fieldStyles: fieldStyles || {},
      formContext: {
        rightToLeft: rightToLeft || false,
        editMode: editMode || false
      }
    }),
    [
      required,
      disabled,
      fieldStyles,
      rightToLeft,
      editMode,
      element.servar.metadata?.custom
    ]
  );

  const { iframeRef, error, loading } = useCustomComponentIframe({
    componentCode: element.servar.metadata.code,
    elementId: index != null ? `${element.id}[${index}]` : element.id,
    value: rawValue,
    onChange,
    customProps: customFieldProps
  });

  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
        height: 'auto',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles?.getTarget('fc')
      }}
      {...elementProps}
    >
      {showPlaceholder ? (
        <Status.Placeholder />
      ) : (
        <>
          {error && <Status.Error error={error} />}
          {loading && <Status.Loading />}

          <iframe
            ref={iframeRef}
            sandbox='allow-scripts allow-same-origin'
            style={{
              width: '100%',
              border: 'none',
              backgroundColor: 'transparent',
              overflow: 'hidden',
              display: 'block'
            }}
          />
        </>
      )}
      {/* This input must always be rendered so we can set field errors */}
      <ErrorInput
        id={element.servar.key}
        name={element.servar.key}
        aria-label={element.properties.aria_label}
      />
    </div>
  );
};

export default memo(CustomField);
