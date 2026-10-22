import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * True when the module at `moduleUrl` (pass `import.meta.url`) is the script
 * Node was asked to run. Builds the URL with pathToFileURL so it also matches
 * on Windows, where argv holds `C:\...` paths and module URLs are `file:///C:/...`.
 */
export function isMain(moduleUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  let path = argv1;
  try {
    path = realpathSync(argv1);
  } catch {
    // Not on disk (e.g. in tests): compare the path as given.
  }
  return pathToFileURL(path).href === moduleUrl;
}
