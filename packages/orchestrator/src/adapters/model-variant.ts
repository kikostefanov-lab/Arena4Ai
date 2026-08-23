/**
 * Model variants are user-supplied — the Agent Builder deliberately allows a
 * freeform model id ("allowCustom") so a self-hoster can name a model the
 * registry has never heard of. That string is handed to a CLI, so it must not be
 * able to become anything but a single argument.
 *
 * Adapters now spawn with an argv array (no shell), which already removes the
 * injection path. This check is the belt to that pair of braces: it keeps a
 * stray quote, space or `;` from silently turning into a second flag if any
 * caller ever builds a command string again.
 */
const MODEL_VARIANT_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

export function isSafeModelVariant(variant: string): boolean {
  return MODEL_VARIANT_RE.test(variant);
}

/**
 * Returns the variant if it is safe to pass to a CLI, otherwise undefined.
 * Rejecting quietly (rather than throwing) keeps a bad model id from killing a
 * competition — the CLI just runs with its own default model.
 */
export function safeModelVariant(variant: string | undefined): string | undefined {
  if (!variant) return undefined;
  if (isSafeModelVariant(variant)) return variant;
  console.warn(`[arena] ignoring unsafe model variant: ${JSON.stringify(variant)}`);
  return undefined;
}
