import { realpath } from 'node:fs/promises';
import path from 'node:path';

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Check the nearest existing parent before creating or reading a project-owned path. */
export async function assertContainedPath(root: string, candidate: string): Promise<void> {
  const actualRoot = await realpath(root);
  let existing = path.resolve(candidate);
  // Compare lexical paths in the same namespace before resolving symlinks.
  // Windows realpath expands 8.3 aliases (e.g. RUNNER~1), and the trusted root
  // itself may be an alias. Accept its supplied or canonical spelling, then
  // independently verify the nearest existing parent's physical containment.
  if (!within(path.resolve(root), existing) && !within(actualRoot, existing)) {
    throw new Error('Managed path escapes project root');
  }
  while (true) {
    try {
      if (!within(actualRoot, await realpath(existing))) throw new Error('Managed path resolves outside project root');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}
