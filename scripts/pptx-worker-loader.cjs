const { bundlePptxWorker } = require('./pptx-worker-bundle.cjs');
module.exports = function () {
  const callback = this.async();
  bundlePptxWorker().then(({ code, files }) => {
    for (const file of files) this.addDependency(file);
    callback(null, `export default ${JSON.stringify(code)};`);
  }, callback);
};
