import { getStepTool } from './getStep';
import { fillStepTool } from './fillStep';
import { nextStepTool } from './nextStep';
import { gateToolInteraction } from './interaction';
import { FormTool } from './types';

// Builds the WebMCP-shaped tool list for one mounted form. Reads form state
// fresh on every execute() call, so the tools stay correct across re-renders.
export const getFormTools = (formUuid: string): FormTool[] => [
  {
    name: 'feathery_get_step',
    title: 'Get current step',
    description:
      'Read the fields, values, and buttons on the current step of this form. A repeated field reports repeated: true, its repeatContainerId, and rowCount; repeatGroups lists each container with canAddRow/maxRows.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    // Read-only: must not open the interaction gate itself (that's reserved
    // for a tool that actually acts on the form, below).
    execute: async () => getStepTool(formUuid)
  },
  {
    name: 'feathery_fill_step',
    title: 'Fill current step',
    description:
      "Fill one or more fields on the current step of this form, exactly as a user typing/selecting would. For a repeated field (get_step reports it with repeated: true), pass an array instead - one entry per row, row 0 first; rows beyond the current row count are added automatically, up to the step's repeatGroups.maxRows. A null entry leaves that row as it is; a repeated file_upload field's array holds one FileInput or null per row.",
    inputSchema: {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          description:
            'Map of field key to the value to write - an array, one entry per row, for a repeated field.',
          additionalProperties: true
        }
      },
      required: ['values'],
      additionalProperties: false
    },
    annotations: {},
    execute: async (input: any) => {
      gateToolInteraction();
      return fillStepTool(formUuid, input);
    }
  },
  {
    name: 'feathery_next_step',
    title: 'Advance to the next step',
    description:
      "Press this step's Next button, exactly as a user clicking it would, and report whether the press saved the step. Refuses rather than completing the form or starting a flow the person must drive themselves.",
    inputSchema: {
      type: 'object',
      properties: {
        buttonId: {
          type: 'string',
          description:
            "id of the button to press; omit to use the step's own save-and-advance button."
        }
      },
      additionalProperties: false
    },
    annotations: { consequentialHint: true },
    execute: async (input: any) => {
      gateToolInteraction();
      return nextStepTool(formUuid, input ?? {});
    }
  }
];
