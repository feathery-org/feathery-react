import { preparePackage } from './preparePackage';

const scope = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; bytes: Uint8Array }>) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data: { id, bytes } }) => {
  try {
    scope.postMessage({ id, result: preparePackage(bytes) });
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
