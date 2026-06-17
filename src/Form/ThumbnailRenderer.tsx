import React, { useMemo, useRef } from 'react';
import { calculateGlobalCSS, calculateStepCSS } from '../utils/hydration';
import { FeatheryCacheProvider } from '../utils/emotionCache';
import { getVisiblePositions } from '../utils/hideAndRepeats';
import { FieldValues, fieldValues } from '../utils/init';
import { DEFAULT_MOBILE_BREAKPOINT } from '../elements/styles';
import { Grid } from './grid';

type ThumbnailFormSettings = Record<string, any> & {
  autocomplete?: string;
  globalStyles?: any;
  mobileBreakpoint?: number;
  readOnly?: boolean;
  rightToLeft?: boolean;
};

export type ThumbnailRendererProps = {
  step: any;
  formId?: string;
  formSettings?: ThumbnailFormSettings;
  values?: FieldValues;
  viewport?: 'desktop' | 'mobile';
  className?: string;
  style?: Record<string, any>;
};

const noop = () => undefined;

const setThumbnailFieldValues = (values: FieldValues) => {
  Object.keys(fieldValues).forEach((key) => {
    delete fieldValues[key];
  });
  Object.assign(fieldValues, values);
};

const ThumbnailRenderer = ({
  step,
  formId = '',
  formSettings = {},
  values = {},
  viewport = 'desktop',
  className,
  style = {}
}: ThumbnailRendererProps) => {
  const internalIdRef = useRef(`thumbnail-${formId || step?.id || 'form'}`);
  const formRef = useRef<HTMLFormElement>(null);
  const focusRef = useRef<string>('');

  const settings = useMemo(
    () => ({
      autocomplete: 'off',
      globalStyles: {},
      mobileBreakpoint: DEFAULT_MOBILE_BREAKPOINT,
      ...formSettings,
      readOnly: true
    }),
    [formSettings]
  );

  const visiblePositions = useMemo(
    () => (step ? getVisiblePositions(step, internalIdRef.current) : {}),
    [step]
  );
  const stepCSS = useMemo(() => calculateStepCSS(step), [step]);
  const globalCSS = useMemo(
    () => calculateGlobalCSS(settings.globalStyles),
    [settings.globalStyles]
  );

  setThumbnailFieldValues(values);

  const form = {
    userProgress: 0,
    curDepth: 0,
    maxDepth: 0,
    elementProps: {},
    customComponents: {},
    activeStep: step,
    steps: step ? [step] : [],
    customClickSelectionState: () => false,
    runElementActions: noop,
    buttonOnClick: noop,
    tableOnClick: noop,
    fieldOnChange: () => noop,
    buttonLoaders: {},
    inlineErrors: {},
    setInlineErrors: noop,
    changeValue: noop,
    changeStep: noop,
    client: null,
    updateFieldValues: noop,
    submitCustom: noop,
    elementOnView: undefined,
    onViewElements: [],
    formSettings: settings,
    focusRef,
    formRef,
    setCardElement: noop,
    visiblePositions,
    calendly: undefined,
    featheryContext: { formId },
    assistantClient: undefined
  };

  return (
    <FeatheryCacheProvider>
      <form
        autoComplete={settings.autocomplete}
        className={`feathery ${className || ''}`}
        ref={formRef}
        css={{
          ...globalCSS.getTarget('form'),
          ...stepCSS,
          ...style,
          position: 'relative',
          display: 'flex'
        }}
        dir={settings.rightToLeft ? 'rtl' : 'ltr'}
      >
        <Grid step={step} form={form} viewport={viewport} />
      </form>
    </FeatheryCacheProvider>
  );
};

export default ThumbnailRenderer;
