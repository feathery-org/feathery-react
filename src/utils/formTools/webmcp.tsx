import { useEffect, useMemo } from 'react';
import { getFormTools } from './registry';
import { featheryDoc } from '../browser';
import { FormTool } from './types';

// Native WebMCP, or a polyfill the host page installed before the form mounted
export const hasWebMCPRuntime = (): boolean => 'modelContext' in featheryDoc();

// Publishes the form tools on document.modelContext. One effect, one
// AbortController for the whole set: unmounting (or formUuid changing)
// aborts every registration together instead of per-tool.
export function FormWebMCPTools({ formUuid }: { formUuid: string }) {
  const tools = useMemo(() => getFormTools(formUuid), [formUuid]);

  useEffect(() => {
    const modelContext = (featheryDoc() as any).modelContext;
    if (!modelContext) return;
    const controller = new AbortController();

    tools.forEach((tool: FormTool) => {
      // Tool names are not suffixed per form. A name collision - e.g. a
      // double-invoked effect under StrictMode, or something else on the
      // page already holding the name - makes registerTool's promise reject
      // rather than throw; let that one tool go dark instead of crashing the
      // form or inventing a per-form name scheme.
      Promise.resolve(
        modelContext.registerTool(
          {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            execute: tool.execute
          },
          { signal: controller.signal }
        )
      ).catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.warn(
            `[formTools] registerTool("${tool.name}") rejected:`,
            err
          );
        }
      });
    });

    return () => controller.abort();
  }, [tools]);

  return null;
}
