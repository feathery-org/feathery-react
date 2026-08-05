import { installRevisionGroupIsolation } from '../../../assistant/tools/docx/syncfusionDocumentOps';
import { configureTrackedChangeReview } from './useDocxEditor';

jest.mock('../../../assistant/tools/docx/syncfusionDocumentOps', () => ({
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
