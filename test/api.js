const test = require('tape')
const path = require('path')
const os = require('os')
const prebuildify = require('../prebuildify')
const gt8 = process.version.match(/^v(\d+)\./)[1] > 8

test('build with current node version', function (t) {
  prebuildify({
    cwd: path.join(__dirname, 'package'),
    targets: [{ runtime: 'node', target: process.version }]
  }, function (err) {
    t.ifError(err)
    t.doesNotThrow(function () {
      const folder = os.platform() + '-' + os.arch()
      const name = 'addon.abi' + process.versions.modules + '.node'
      const addon = require(path.join(__dirname, 'package', 'prebuilds', folder, name))
      t.equal(addon.check(), 'prebuildify')
    })
    t.end()
  })
})

test('uv, armv and libc tags', function (t) {
  prebuildify({
    cwd: path.join(__dirname, 'package'),
    targets: [{ runtime: 'node', target: process.version }],
    tagUv: 123,
    tagArmv: false, // Should be excluded (unless you run these tests on ARM)
    tagLibc: true // Should be glibc (unless you run these tests on Alpine)
  }, function (err) {
    t.ifError(err)
    t.doesNotThrow(function () {
      const folder = os.platform() + '-' + os.arch()
      const name = [
        'addon',
        'abi' + process.versions.modules,
        'uv123',
        'glibc',
        'node'
      ].join('.')
      const addon = require(path.join(__dirname, 'package', 'prebuilds', folder, name))
      t.equal(addon.check(), 'prebuildify')
    })
    t.end()
  })
})

gt8 && test('prefers locally installed node-gyp bin', function (t) {
  prebuildify({
    cwd: path.join(__dirname, 'mock-gyp'),
    targets: [{ runtime: 'node', target: process.version }]
  }, function (err) {
    t.is(err.message, 'node-gyp exited with 123')
    t.end()
  })
})
