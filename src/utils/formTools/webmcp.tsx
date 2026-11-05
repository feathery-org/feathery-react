import { useEffect, useMemo } from 'react';
import { getFormTools } from './registry';
import { featheryDoc } from '../browser';
import { FormTool } from './types';

// Native WebMCP, or a polyfill the host page installed before the form mounted
export const hasWebMCPRuntime = (): boolean => 'modelContext' in featheryDoc();

// One AbortController aborts every registration together on unmount
export function FormWebMCPTools({ formUuid }: { formUuid: string }) {
  const tools = useMemo(() => getFormTools(formUuid), [formUuid]);

  useEffect(() => {
    const modelContext = (featheryDoc() as any).modelContext;
    if (!modelContext) return;
    const controller = new AbortController();

    tools.forEach((tool: FormTool) => {
      // A name collision rejects rather than throws; that tool goes dark
      // instead of crashing the form
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
