import {
  BrowserMod,
  CheckButtonActionMod,
  ClientMod,
  GridMod,
  StepHelperMod,
  ValidationMod
} from './testMocks';
import {
  act,
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor
} from '@testing-library/react';
import { JSForm } from '..';
import FeatheryClient from '../../utils/featheryClient';
import internalState from '../../utils/internalState';
import { initState } from '../../utils/init';
import {
  _clearDocxDirtyRegistry,
  hasDirtyDocxEditors,
  setDocxEditorDirty
} from '../../elements/components/DocxEditor/docxDirtyRegistry';

let originalFetchForm: any;

beforeAll(() => {
  originalFetchForm = FeatheryClient.prototype.fetchForm;
});

afterEach(() => {
  jest.clearAllMocks();
  cleanup();

  // Reset useCheckButtonAction refs
  CheckButtonActionMod._spies.buttonActionStateRef.current = null;
  CheckButtonActionMod._spies.setButtonLoaderRef.current = jest.fn();
  GridMod._spies.actions = [];
  GridMod._spies.submit = false;
  GridMod._spies.form = null;
  ValidationMod._spies.invalid = false;
  BrowserMod._spies.confirm.mockReset();
  BrowserMod._spies.history.state = null;
  BrowserMod._spies.history.go.mockReset();
  BrowserMod._spies.history.pushState.mockClear();
  BrowserMod._spies.history.replaceState.mockClear();
  BrowserMod._spies.location.href = 'https://example.com/';
  _clearDocxDirtyRegistry();

  // Restore FeatheryClient prototype if a test overrode it
  FeatheryClient.prototype.fetchForm = originalFetchForm;
});

describe('docx discard navigation boundary', () => {
  const clickTrigger = async () =>
    fireEvent.click(await screen.findByTestId('btn'));

  // Editors register dirty state under the id the grid hands them, which must
  // match the id the Next/Back guard and browser history guard look up.
  it('renders the grid with the same form id the guard checks', async () => {
    render(<JSForm formId='f1' _internalId='iid-docx-key' />);
    await screen.findByTestId('btn');

    expect(GridMod._spies.form.formInstanceId).toBe('iid-docx-key');
  });

  it('prompts once when a Next action is about to run', async () => {
    BrowserMod._spies.confirm.mockReturnValue(true);
    GridMod._spies.actions = [{ type: 'next' }];
    setDocxEditorDirty('iid-docx-next', 'document-container-a', true);

    render(<JSForm formId='f1' _internalId='iid-docx-next' />);
    await clickTrigger();

    await waitFor(() =>
      expect(BrowserMod._spies.confirm).toHaveBeenCalledTimes(1)
    );
  });

  it('stops Next navigation when discarding docx changes is declined', async () => {
    BrowserMod._spies.confirm.mockReturnValue(false);
    GridMod._spies.actions = [{ type: 'next' }];
    setDocxEditorDirty('iid-docx-stay', 'document-container-a', true);

    render(<JSForm formId='f1' _internalId='iid-docx-stay' />);
    await clickTrigger();

    await waitFor(() =>
      expect(BrowserMod._spies.confirm).toHaveBeenCalledTimes(1)
    );
    expect(hasDirtyDocxEditors('iid-docx-stay')).toBe(true);
    expect(screen.getByTestId('btn')).toBeInTheDocument();
  });

  it('does not prompt when validation blocks the step before Next runs', async () => {
    BrowserMod._spies.confirm.mockReturnValue(true);
    ValidationMod._spies.invalid = true;
    GridMod._spies.actions = [{ type: 'next' }];
    GridMod._spies.submit = true;
    setDocxEditorDirty('iid-docx-invalid', 'document-container-a', true);

    render(<JSForm formId='f1' _internalId='iid-docx-invalid' />);
    await clickTrigger();

    await act(async () => {});
    expect(BrowserMod._spies.confirm).not.toHaveBeenCalled();
    expect(hasDirtyDocxEditors('iid-docx-invalid')).toBe(true);
  });

  it('does not prompt for actions that stay on the current step', async () => {
    BrowserMod._spies.confirm.mockReturnValue(true);
    GridMod._spies.actions = [
      { type: 'url', url: 'https://example.com/next', open_tab: false }
    ];
    setDocxEditorDirty('iid-docx-url', 'document-container-a', true);

    render(<JSForm formId='f1' _internalId='iid-docx-url' />);
    await clickTrigger();

    await waitFor(() =>
      expect(BrowserMod._spies.location.href).toBe('https://example.com/next')
    );
    // Full-page exits stay on the browser's own beforeunload warning
    expect(BrowserMod._spies.confirm).not.toHaveBeenCalled();
    expect(hasDirtyDocxEditors('iid-docx-url')).toBe(true);
  });
});

describe('ReactForm sharedCodes initialization', () => {
  it('sets sharedCodes to empty array when shared_codes is null', async () => {
    // Arrange: override FeatheryClient mock to return null shared_codes
    const MockClient = FeatheryClient;
    MockClient.prototype.fetchForm = async () => ({
      steps: [
        {
          key: 'step-1',
          id: 's1',
          servar_fields: [],
          buttons: [],
          next_conditions: []
        }
      ],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      shared_codes: null, // explicitly null
      track_hashes: false
    });

    render(<JSForm formId='f1' _internalId='iid-sc1' />);
    const btn = await screen.findByTestId('btn'); // wait for Grid render

    // Assert: sharedCodes should be initialized to empty array safely
    expect(btn).toBeInTheDocument();

    // Accessing internalState mock to confirm
    const sharedCodes: any = internalState.sharedCodes;
    expect(Array.isArray(internalState.sharedCodes)).toBe(true);
    expect(sharedCodes?.length).toBe(0);
  });

  it('sets sharedCodes to empty array when shared_codes is undefined', async () => {
    // Arrange: override FeatheryClient mock to return undefined shared_codes
    const MockClient = FeatheryClient;
    MockClient.prototype.fetchForm = async () => ({
      steps: [
        {
          key: 'step-1',
          id: 's1',
          servar_fields: [],
          buttons: [],
          next_conditions: []
        }
      ],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      // shared_codes is intentionally omitted to be undefined
      track_hashes: false
    });

    render(<JSForm formId='f1' _internalId='iid-sc2' />);
    const btn = await screen.findByTestId('btn');

    // Assert
    const sharedCodes: any = internalState.sharedCodes;
    expect(btn).toBeInTheDocument();
    expect(Array.isArray(sharedCodes)).toBe(true);
    expect(sharedCodes?.length).toBe(0);
  });
});

describe('session fetch failure fallback', () => {
  const originStep = {
    key: 'step-1',
    id: 's1',
    origin: true,
    servar_fields: [],
    buttons: [],
    next_conditions: []
  };

  afterEach(() => {
    delete ClientMod._spies.overrides.fetchForm;
    delete ClientMod._spies.overrides.fetchSession;
    initState.collaboratorId = '';
    initState.collaboratorReview = '';
  });

  // The session request fails for causes the form is meant to survive: a 400
  // when the org is over its daily session cap, or a fetch aborted by the
  // browser. The form definition still loads from the CDN, so the fallback has
  // to land the visitor on the origin step instead of rendering nothing.
  it('renders the origin step when the session request rejects', async () => {
    ClientMod._spies.overrides.fetchForm = async () => ({
      steps: [originStep],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      shared_codes: [],
      track_hashes: false
    });
    ClientMod._spies.overrides.fetchSession = () =>
      Promise.reject(new Error('Too many sessions'));

    render(<JSForm formId='f1' _internalId='iid-session-reject' />);

    expect(await screen.findByTestId('btn')).toBeInTheDocument();
  });

  // The hash branch reached for the outer `steps` state, which this effect
  // captured as {} on first render, so it hashed nothing and selected nothing.
  it('selects the origin step when hash navigation is on', async () => {
    ClientMod._spies.overrides.fetchForm = async () => ({
      steps: [
        originStep,
        { ...originStep, key: 'step-2', id: 's2', origin: false }
      ],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      shared_codes: [],
      track_hashes: true
    });
    ClientMod._spies.overrides.fetchSession = () =>
      Promise.reject(new Error('Too many sessions'));

    render(<JSForm formId='f1' _internalId='iid-session-reject-hash' />);

    expect(await screen.findByTestId('btn')).toBeInTheDocument();
    expect(StepHelperMod.setUrlStepHash).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ 'step-1': expect.anything() }),
      'step-1'
    );
  });

  // A one-step form never gets a hash, so the hash branch has to fall through
  // to setStepKey or nothing renders at all.
  it('selects the origin step on a single-step form with hash navigation', async () => {
    ClientMod._spies.overrides.fetchForm = async () => ({
      steps: [originStep],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      shared_codes: [],
      track_hashes: true
    });
    ClientMod._spies.overrides.fetchSession = () =>
      Promise.reject(new Error('Too many sessions'));

    render(<JSForm formId='f1' _internalId='iid-session-reject-hash-1' />);

    expect(await screen.findByTestId('btn')).toBeInTheDocument();
  });
});

describe('session failure fallback stays closed for collaborators', () => {
  const originStep = {
    key: 'step-1',
    id: 's1',
    origin: true,
    servar_fields: [],
    buttons: [],
    next_conditions: []
  };

  afterEach(() => {
    delete ClientMod._spies.overrides.fetchForm;
    delete ClientMod._spies.overrides.fetchSession;
    initState.collaboratorId = '';
    initState.collaboratorReview = '';
  });

  const rejectSession = () => {
    ClientMod._spies.overrides.fetchForm = async () => ({
      steps: [originStep],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      shared_codes: [],
      track_hashes: false
    });
    ClientMod._spies.overrides.fetchSession = () =>
      Promise.reject(new Error('Too many sessions'));
  };

  // A collaborator's invalid/completed/direct_submission_disabled status and
  // their field allow lists only arrive on the session response. Without it the
  // form must not render, or a restricted collaborator gets an active form.
  it.each([
    ['collaboratorId', 'collab-1'],
    ['collaboratorReview', 'readOnly']
  ])('renders FormOff when %s is set', async (key, value) => {
    (initState as any)[key] = value;
    rejectSession();

    render(<JSForm formId='f1' _internalId={`iid-collab-${key}`} />);

    expect(
      await screen.findByText("This form isn't currently collecting responses.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId('btn')).not.toBeInTheDocument();
  });
});

describe('useCheckButtonAction behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocked hook internal state
    CheckButtonActionMod._spies.buttonActionStateRef.current = null;
    CheckButtonActionMod._spies.setButtonLoaderRef.current = jest.fn();
    CheckButtonActionMod._spies.clearLoadersRef.current = jest.fn();
  });

  it('calls setButtonLoader when _setButtonLoading(true) with a tracked button', async () => {
    // Arrange: inject a custom setButtonLoader
    const setButtonLoader = jest.fn(async () => {});
    const api = CheckButtonActionMod.useCheckButtonAction(setButtonLoader);

    // No tracked button yet - should not call loader
    await api._setButtonLoading(true);
    expect(setButtonLoader).not.toHaveBeenCalled();

    // Create tracked state via updateButtonActionState
    const el = {
      id: 'b-load',
      properties: {
        actions: []
      }
    };
    api.updateButtonActionState('button', el);

    // Act
    await api._setButtonLoading(true);

    // Assert
    expect(setButtonLoader).toHaveBeenCalledTimes(1);
    expect(setButtonLoader).toHaveBeenCalledWith(el);
  });

  it('calls clearLoaders when _setButtonLoading(false) and there is no running state', async () => {
    const setButtonLoader = jest.fn();
    const clearLoaders = jest.fn();
    const api = CheckButtonActionMod.useCheckButtonAction(
      setButtonLoader,
      clearLoaders
    );

    // Create tracked button state, then end element action
    const el = {
      id: 'b-clear',
      properties: {
        actions: []
      }
    };
    api.updateButtonActionState('button', el);
    api.clearButtonActionState();

    // Ensure not running
    expect(api.isButtonActionRunning()).toBe(false);

    // Act
    await api._setButtonLoading(false);

    // Assert
    expect(clearLoaders).toHaveBeenCalledTimes(1);
  });

  it('JSForm flow: tracks button state even when block_button_clicks is not set', async () => {
    render(<JSForm formId='f1' _internalId='iid-btn-1' />);

    const btn = await screen.findByTestId('btn');
    fireEvent.click(btn);

    await waitFor(() =>
      expect(
        CheckButtonActionMod._spies.updateButtonActionState
      ).toHaveBeenCalledWith(
        'button',
        expect.objectContaining({ id: 'b1' }),
        undefined
      )
    );
  });

  it('sets running when a button action starts and triggers setButtonLoader while user logic running', async () => {
    // Initialize mocked hook with an injectable setButtonLoader
    const setButtonLoader = jest.fn(async () => {});
    const api = CheckButtonActionMod.useCheckButtonAction(setButtonLoader);

    const element = {
      id: 'b-button',
      properties: {
        actions: []
      }
    };

    // button clicks should set the internal state
    api.updateButtonActionState('button', element);

    expect(CheckButtonActionMod._spies.buttonActionStateRef.current).toEqual({
      button: element,
      isElementActionRunning: true
    });

    // Starting user logic
    await api.setUserLogicRunning(true);

    // Still running due to element action
    expect(api.isButtonActionRunning()).toBe(true);

    // Stopping user logic keeps running because element action is still true
    await api.setUserLogicRunning(false);
    expect(api.isButtonActionRunning()).toBe(true);

    // Stopping element action ends running state
    api.clearButtonActionState();
    expect(api.isButtonActionRunning()).toBe(false);
  });

  it('does not call setButtonLoader when user logic running is set to false', async () => {
    const setButtonLoader = jest.fn(async () => {});
    const api = CheckButtonActionMod.useCheckButtonAction(setButtonLoader);

    // No state yet: setting false should not call loader
    await api.setUserLogicRunning(false);
    expect(setButtonLoader).not.toHaveBeenCalled();

    // Create state then set false again: still should not call loader
    const el = {
      id: 'b-x',
      properties: {
        actions: []
      }
    };
    api.updateButtonActionState('button', el);
    await api.setUserLogicRunning(false);
    expect(setButtonLoader).not.toHaveBeenCalled();
  });

  it('ignores non-button element types in updateButtonActionState', () => {
    const api = CheckButtonActionMod.useCheckButtonAction(jest.fn());

    // container element should not be tracked
    api.updateButtonActionState('container', {
      id: 'c1',
      properties: {}
    });

    expect(CheckButtonActionMod._spies.buttonActionStateRef.current).toBeNull();
    expect(api.isButtonActionRunning()).toBe(false);
  });
});
