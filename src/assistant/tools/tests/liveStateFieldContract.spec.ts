import * as fs from 'fs';
import * as path from 'path';

import { getPanelRuntimeSnapshot } from '../panelRuntime';

const ASSISTANT_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../AssistantChat.tsx'),
  'utf8'
);

describe('live-state field contract supersedes the duplicate field-read tool', () => {
  it('does not register or import a duplicate field-read handler', () => {
    expect(ASSISTANT_SOURCE).not.toContain('dispatchGetFormFields');
    expect(ASSISTANT_SOURCE).not.toContain('getFormFields:');
  });

  it('keeps panelRuntime as the source attached to every request body', () => {
    expect(ASSISTANT_SOURCE).toContain('getPanelRuntimeSnapshot(instanceId)');
    expect(ASSISTANT_SOURCE).toContain(
      'if (panelRuntime) context.panel_runtime = panelRuntime'
    );
    expect(typeof getPanelRuntimeSnapshot).toBe('function');
  });
});
