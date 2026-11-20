export const PROTOCOL_DEFAULTS: Readonly<Record<string, boolean>> = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

export const withDefaults = (annotations: Record<string, unknown> | undefined): Record<string, boolean> => ({ ...PROTOCOL_DEFAULTS, ...(annotations as Record<string, boolean> | undefined) });

export const destroys = (annotations: Record<string, unknown> | undefined): boolean => {
  const hints = withDefaults(annotations);
  return !hints["readOnlyHint"]! && hints["destructiveHint"]!;
};
