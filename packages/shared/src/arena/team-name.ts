/**
 * The display name of a team: `model` alone, or `model:persona`. Some stored
 * matches already carry the persona inside `model` ("claude:architect" with
 * persona "architect"), so a naive join would read "claude:architect:architect".
 * Pure, so every host (web, reels, the 3D scene) shares one rule.
 */
export function teamDisplayName(model: string, persona?: string | null): string {
  if (!persona) return model;
  if (model.toLowerCase().endsWith(`:${persona.toLowerCase()}`)) return model;
  return `${model}:${persona}`;
}
