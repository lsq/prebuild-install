const runtimeRequire = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require // eslint-disable-line
if (typeof runtimeRequire.addon === 'function') { // if the platform supports native resolving prefer that
  module.exports = runtimeRequire.addon.bind(runtimeRequire)
} else { // else use the runtime version here
  const nodeGypBuild = require('./node-gyp-build.js')
  const download = require('./download.js')
  module.exports = nodeGypBuild
  module.exports.download = download
}
