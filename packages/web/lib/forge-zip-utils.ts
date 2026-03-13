import type { ForgeArtifact } from '@arena/shared';
import JSZip from 'jszip';

const TYPE_OVERRIDES: Partial<Record<string, string | null>> = {
  project_readme:           'README.md',
  environment_template:     'infrastructure/.env.example',
  github_actions:           '.github/workflows/ci.yml',
  reference_implementation: null,   // multi-file — expanded separately
  test_suite_template:      null,   // multi-file — expanded separately
};

const FORMAT_FOLDERS: Record<string, string> = {
  markdown:   'docs/',
  sql:        'infrastructure/',
  yaml:       'infrastructure/',
  dockerfile: 'infrastructure/',
  csv:        'data/',
  json:       'data/',
  text:       'infrastructure/',
};

/**
 * Returns the full ZIP path for a single-file artifact,
 * or null for multi-file types (reference_implementation, test_suite_template).
 */
export function resolveZipPath(artifact: ForgeArtifact): string | null {
  if (artifact.type in TYPE_OVERRIDES) {
    return TYPE_OVERRIDES[artifact.type] ?? null;
  }
  const folder = FORMAT_FOLDERS[artifact.outputFormat] ?? 'docs/';
  return `${folder}${artifact.filename}`;
}

/**
 * Expands a multi-file artifact (reference_implementation or test_suite_template)
 * by parsing content as a JSON file map and adding each file to the JSZip instance.
 * Files are placed under src/ or tests/ respectively.
 */
export function expandMultiFileArtifact(zip: JSZip, artifact: ForgeArtifact): void {
  const folder = artifact.type === 'reference_implementation' ? 'src/' : 'tests/';
  let fileMap: Record<string, string>;
  try {
    fileMap = JSON.parse(artifact.content) as Record<string, string>;
  } catch {
    // Fallback: treat content as a single file
    zip.file(`${folder}index.txt`, artifact.content);
    return;
  }
  for (const [filename, content] of Object.entries(fileMap)) {
    zip.file(`${folder}${filename}`, content);
  }
}
