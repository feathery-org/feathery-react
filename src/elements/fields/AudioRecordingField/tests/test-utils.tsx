import {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  createBaseElement,
  createFieldProps
} from '../../shared/tests/field-test-utils';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
};

export const createAudioRecordingElement = (metadata: any = {}) =>
  createBaseElement(
    'test-audio',
    'audio_recording',
    { ...metadata },
    { aria_label: 'Audio recording field' }
  );

export const createAudioRecordingProps = (
  element: any,
  customProps: any = {}
) =>
  createFieldProps(element, {
    onChange: jest.fn(),
    initialFile: null,
    ...customProps
  });

// Controllable MediaRecorder stand-in: tests drive dataavailable/stop manually
export class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static supportedTypes = ['audio/webm;codecs=opus', 'audio/webm'];
  // Set to emit a zero-byte recording
  static emitEmpty = false;
  static isTypeSupported = jest.fn((mimeType: string) =>
    MockMediaRecorder.supportedTypes.includes(mimeType)
  );

  stream: any;
  mimeType: string;
  state = 'inactive';
  ondataavailable: ((event: any) => void) | null = null;
  onstop: (() => void) | null = null;
  start = jest.fn(() => {
    this.state = 'recording';
  });
  // Distinct payload per instance, so a re-recording is distinguishable
  takeIndex: number;
  stop = jest.fn(() => {
    this.state = 'inactive';
    if (!MockMediaRecorder.emitEmpty)
      this.ondataavailable?.({
        data: new Blob(['audio-bytes'.repeat(this.takeIndex + 1)], {
          type: this.mimeType
        })
      });
    this.onstop?.();
  });

  constructor(stream: any, options: any = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType ?? '';
    this.takeIndex = MockMediaRecorder.instances.length;
    MockMediaRecorder.instances.push(this);
  }
}

export const createMockStream = () => {
  const track = { stop: jest.fn() };
  return { stream: { getTracks: () => [track] }, track };
};

export const installAudioMocks = () => {
  MockMediaRecorder.instances = [];
  MockMediaRecorder.emitEmpty = false;
  MockMediaRecorder.supportedTypes = ['audio/webm;codecs=opus', 'audio/webm'];
  MockMediaRecorder.isTypeSupported.mockClear();
  const { stream, track } = createMockStream();
  const getUserMedia = jest.fn().mockResolvedValue(stream);

  (global.window as any).MediaRecorder = MockMediaRecorder;
  Object.defineProperty(global.window.navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: { getUserMedia }
  });
  (global.URL as any).createObjectURL = jest.fn(() => 'blob:mock-audio-url');
  (global.URL as any).revokeObjectURL = jest.fn();

  return { getUserMedia, stream, track };
};
