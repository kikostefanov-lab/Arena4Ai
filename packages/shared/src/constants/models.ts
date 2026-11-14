/**
 * Stored model variant meaning "pass no model flag: let the agent CLI use its
 * own default". Model ids go stale as providers ship new models; the CLI's own
 * default never does, so this is what seeded agents and new agents start on.
 */
export const CLI_DEFAULT_MODEL = 'cli-default';

/** True when a stored variant means "use the CLI's own default model". */
export function isCliDefaultModel(variant: string | null | undefined): boolean {
  return !variant || variant === CLI_DEFAULT_MODEL;
}

/** Human-readable label for a stored model variant. */
export function formatModelVariant(variant: string | null | undefined): string {
  return isCliDefaultModel(variant) ? 'CLI default' : variant!;
}
