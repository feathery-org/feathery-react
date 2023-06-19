import React, { useMemo, useState } from 'react';
import { validate as uuidValidate } from 'uuid';
import LoaderContainer from '../elements/components/LoaderContainer';
import FeatherySpinner from '../elements/components/Spinner';

export interface InitialLoader {
  show?: boolean;
  loader?: string | JSX.Element;
  initialContainerHeight?: string;
  initialContainerWidth?: string;
}

/**
 * The different loaders should behave as follows, based on initialLoader.show
 * default:
 * forms - no loader
 * auth - loader
 * buttons - loader
 *
 * explicitly false:
 * all - no loader
 *
 * explicitly true:
 * all - loader
 *
 * @param _isAuthLoading A boolean passed by LoginForm to designate whether auth is loading & the form requires a loader
 * @returns
 */
const useLoader = ({
  initialLoader,
  _isAuthLoading,
  loaderBackgroundColor = 'white',
  formRef
}: {
  initialLoader: InitialLoader | undefined;
  _isAuthLoading: boolean;
  loaderBackgroundColor: string | undefined;
  formRef: any;
}) => {
  const loader = getLoaderComponent(initialLoader);

  const [loaders, setLoaders] = useState<Record<string, any>>(
    initialLoader?.show
      ? {
          initialLoad: {
            showOn: 'full_page',
            loader: loader,
            type: 'default'
          }
        }
      : {}
  );

  const fullPageLoader = useMemo(() => {
    return Object.entries(loaders).find(
      ([, l]) => (l as any)?.showOn === 'full_page'
    );
  }, [loaders]);
  const stepLoader = useMemo(() => {
    if (!fullPageLoader) return null;
    const stepLoaderObj = fullPageLoader[1];
    return stepLoaderObj.type === 'default' ? (
      <div style={{ height: '20%', aspectRatio: '1 / 1' }}>
        {stepLoaderObj.loader}
      </div>
    ) : (
      stepLoaderObj.loader
    );
  }, [fullPageLoader]);
  const buttonLoaders = useMemo(() => {
    const buttonLoaders: Record<string, any> = {};
    Object.entries(loaders).forEach(([key, l]) => {
      if (l.showOn === 'on_button' && l.loader) buttonLoaders[key] = l.loader;
    });
    return buttonLoaders;
  }, [loaders]);

  const isStepLoaderForButton = fullPageLoader
    ? uuidValidate(fullPageLoader[0])
    : false;
  const isShowExplicitlyFalse = initialLoader && initialLoader.show === false;
  const showLoader: boolean =
    !isShowExplicitlyFalse && (_isAuthLoading || stepLoader);
  const { height, width } = getLoaderSize(
    _isAuthLoading,
    initialLoader,
    formRef
  );
  const loaderContainer = (
    <LoaderContainer
      isStepLoaderForButton={isStepLoaderForButton}
      showLoader={showLoader}
      backgroundColor={loaderBackgroundColor}
      height={height}
      width={width}
    >
      {stepLoader ?? loader}
    </LoaderContainer>
  );

  return {
    buttonLoaders,
    clearLoaders: () => setLoaders({}),
    setLoaders: (newVal: any) => !isShowExplicitlyFalse && setLoaders(newVal),
    stepLoader: loaderContainer
  };
};

const getLoaderComponent = (initialLoader?: InitialLoader) => {
  if (!initialLoader || !initialLoader.loader) return <FeatherySpinner />;

  if (typeof initialLoader?.loader === 'string')
    return <div dangerouslySetInnerHTML={{ __html: initialLoader.loader }} />;
  else return initialLoader.loader;
};

/**
 * initialLoader has default initial height & width, as well as ability to be set by user
 * if _isAuthLoading then we always want the loader to take the entire screen (100vw/vh)
 * if stepLoader is for full page button then we should make it the size of the form
 *
 * @param _isAuthLoading
 * @param initialLoader
 * @param formRef
 * @returns
 */
const getLoaderSize = (
  _isAuthLoading: boolean,
  initialLoader: InitialLoader | undefined,
  formRef: any
) => {
  let height = initialLoader?.initialContainerHeight ?? 'min-content';
  let width = initialLoader?.initialContainerWidth ?? '100%';
  const boundingRect = formRef?.current?.getBoundingClientRect();
  // If the auth loader is being shown, it should always cover the page to gate content
  if (_isAuthLoading) {
    height = '100vh';
    width = '100vw';
  }
  // If the form has loaded and we know the height, use that instead
  else if (boundingRect && boundingRect.height && boundingRect.width) {
    height = `${boundingRect.height}px`;
    width = `${boundingRect.width}px`;
  }

  return { height, width };
};

export default useLoader;
