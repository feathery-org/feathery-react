/**
 * Every source file of the engine compiles with the repository's own babel configuration, as the
 * product bundles compile it. Jest transforms for its node target, which skips transforms the
 * browser build runs (the for-of transform infers iterable types and can throw on code that
 * type-checks); this runs the browser build's transforms over every file.
 */
import * as fs from 'fs';
import * as path from 'path';

/* eslint-disable @typescript-eslint/no-var-requires */
const babel = require('@babel/core');
/* eslint-enable @typescript-eslint/no-var-requires */

const files = (dir: string): string[] =>
  fs.readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return fs.statSync(p).isDirectory()
      ? files(p)
      : /\.tsx?$/.test(p)
      ? [p]
      : [];
  });

describe('the engine builds with the product babel configuration', () => {
  it.each(['production', 'development'])(
    'every file compiles (%s)',
    (envName) => {
      const failures: string[] = [];
      for (const file of files(__dirname))
        try {
          babel.transformFileSync(file, {
            envName,
            filename: file,
            configFile: path.resolve(__dirname, '../../../babel.config.js')
          });
        } catch (e) {
          failures.push(
            `${path.relative(__dirname, file)}: ${String((e as Error).message)
              .split('\n')[0]
              .slice(0, 200)}`
          );
        }
      expect(failures).toEqual([]);
    },
    120000
  );
});
