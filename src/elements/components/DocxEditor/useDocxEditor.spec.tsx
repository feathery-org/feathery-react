import { installRevisionGroupIsolation } from '../../../utils/documentEditorPrimitives';
import {
  configureTrackedChangeReview,
  resizeDocxEditor
} from './useDocxEditor';

jest.mock('../../../utils/documentEditorPrimitives', () => ({
  findReplaceCounterpart: jest.fn(),
  installRevisionGroupIsolation: jest.fn(),
  preserveDocumentViewDuring: jest.fn((_editor, run) => run())
}));

describe('configureTrackedChangeReview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('leaves a gated-off editor fully native', () => {
    const editor = {
      showRevisions: true,
      commentReviewPane: { isUserClosed: false }
    };

    configureTrackedChangeReview(editor, false);

    expect(editor.showRevisions).toBe(true);
    expect(editor.commentReviewPane.isUserClosed).toBe(false);
    expect(installRevisionGroupIsolation).not.toHaveBeenCalled();
  });

  it('installs review behavior only when the rail is enabled', () => {
    const editor = {
      showRevisions: true,
      commentReviewPane: { isUserClosed: false }
    };

    configureTrackedChangeReview(editor, true);

    expect(editor.showRevisions).toBe(false);
    expect(editor.commentReviewPane.isUserClosed).toBe(true);
    expect(installRevisionGroupIsolation).toHaveBeenCalledWith(editor);
  });
});

describe('resizeDocxEditor', () => {
  it('relayouts an assistant-off host and its status chrome without cursor homing', () => {
    const updateZoomContent = jest.fn();
    const containerResize = jest.fn();
    const handleControlHomeKey = jest.fn();
    const editorResize = jest.fn();
    const fitPage = jest.fn();
    const container = {
      resize: containerResize,
      statusBar: { updateZoomContent }
    };
    const editor = {
      showRevisions: true,
      commentReviewPane: { isUserClosed: false },
      selection: { handleControlHomeKey },
      viewer: { zoomType: 'FitPageWidth' },
      resize: editorResize,
      fitPage
    };

    configureTrackedChangeReview(editor, false);
    resizeDocxEditor(container, editor, true);

    expect(editorResize).toHaveBeenCalledTimes(1);
    expect(fitPage).toHaveBeenCalledWith('FitPageWidth');
    expect(updateZoomContent).toHaveBeenCalledTimes(1);
    expect(containerResize).not.toHaveBeenCalled();
    expect(handleControlHomeKey).not.toHaveBeenCalled();
    expect(editor.showRevisions).toBe(true);
    expect(editor.commentReviewPane.isUserClosed).toBe(false);
  });
});
