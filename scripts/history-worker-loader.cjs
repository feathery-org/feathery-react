const { bundleHistoryWorker } = require('./history-worker-bundle.cjs');
module.exports = function () {
  const callback = this.async();
  bundleHistoryWorker().then(({ code, files }) => {
    for (const file of files) this.addDependency(file);
    callback(null, `export default ${JSON.stringify(code)};`);
  }, callback);
};
