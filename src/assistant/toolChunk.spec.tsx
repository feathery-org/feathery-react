import { render, screen } from '@testing-library/react';

import { ToolChunk, type ToolRow } from './ToolStatus';

const row = (toolName: string, state: string): ToolRow => ({
  key: `${toolName}-${state}`,
  toolName,
  state
});

describe('assistant tool chunk', () => {
  // The pinned status strip owns the live indicator. A second copy here rode
  // the transcript upward, in gray, holding whichever phrase it started with
  it('leaves the live indicator to the pinned strip while the turn runs', () => {
    render(
      <ToolChunk
        rows={[row('setFieldValue', 'input-available')]}
        turnFinished={false}
        followedByText={false}
      />
    );

    expect(screen.queryByText('Working on it...')).toBeNull();
    expect(screen.getByText('Updating form fields...')).toBeInTheDocument();
  });

  it('renders nothing while running when no tool has a label of its own', () => {
    const { container } = render(
      <ToolChunk
        rows={[row('someInternalTool', 'input-available')]}
        turnFinished={false}
        followedByText={false}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('still settles a finished turn to the "Finished working" summary', () => {
    render(
      <ToolChunk
        rows={[
          row('getPanelSnapshot', 'output-available'),
          row('setFieldValue', 'output-available')
        ]}
        turnFinished
        followedByText
      />
    );

    expect(screen.getByText('Finished working')).toBeInTheDocument();
  });

  it('summarises a finished turn whose tools have no labels of their own', () => {
    render(
      <ToolChunk
        rows={[row('someInternalTool', 'output-available')]}
        turnFinished
        followedByText
      />
    );

    expect(screen.getByText('Finished working')).toBeInTheDocument();
  });

  it('keeps a lone finished tool inline under its own name', () => {
    render(
      <ToolChunk
        rows={[row('searchWeb', 'output-available')]}
        turnFinished
        followedByText
      />
    );

    expect(screen.getByText('Searched the web')).toBeInTheDocument();
    expect(screen.queryByText('Finished working')).toBeNull();
  });
});
