import { init } from '../utils/init';

const FeatheryProvider = ({ init: initProps, children }: any) => {
  init(initProps.sdkKey, initProps);

  return children;
};

export default FeatheryProvider;
