// Bundle PowerPoint package preparation once per compiler, inline as a Blob worker. This
// avoids CDN/public-path assumptions in ESM, CJS, UMD and embedded forms.
const path = require('path');
const { rollup } = require('rollup');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(
  root,
  'src/elements/components/PptxEditor/loading/pptxWorkerSource.ts'
);
async function bundlePptxWorker() {
  const bundle = await rollup({
    input: path.join(path.dirname(sourcePath), 'pptxWorker.ts'),
    plugins: [
      nodeResolve({ extensions: ['.ts', '.js'] }),
      {
        name: 'pptx-worker-typescript',
        transform(code, id) {
          if (!id.endsWith('.ts')) return null;
          return {
            code: ts.transpileModule(code, {
              compilerOptions: {
                target: ts.ScriptTarget.ES2018,
                module: ts.ModuleKind.ESNext
              }
            }).outputText,
            map: null
          };
        }
      }
    ],
    onwarn(warning, warn) {
      if (warning.code === 'UNRESOLVED_IMPORT')
        throw new Error(warning.message);
      warn(warning);
    }
  });
  try {
    const { output } = await bundle.generate({ format: 'iife' });
    return { code: output[0].code, files: bundle.watchFiles };
  } finally {
    await bundle.close();
  }
}
function pptxWorkerPlugin() {
  return {
    name: 'inline-pptx-worker',
    async load(id) {
      if (id !== sourcePath) return null;
      const { code, files } = await bundlePptxWorker();
      for (const file of files) this.addWatchFile(file);
      return `export default ${JSON.stringify(code)};`;
    }
  };
}
module.exports = { bundlePptxWorker, pptxWorkerPlugin };
