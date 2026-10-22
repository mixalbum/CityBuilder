import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMain } from '../pipeline/util/isMain';

describe('isMain', () => {
  it('matches the script Node was asked to run', () => {
    const script = pathToFileURL('/work/city plan/pipeline/build.ts').href;
    expect(isMain(script, '/work/city plan/pipeline/build.ts')).toBe(true);
  });

  it('ignores other modules and a missing argv', () => {
    const script = pathToFileURL('/work/pipeline/build.ts').href;
    expect(isMain(script, '/work/pipeline/fetch/overpass.ts')).toBe(false);
    expect(isMain(script, '')).toBe(false);
  });
});
