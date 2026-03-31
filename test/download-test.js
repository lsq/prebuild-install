const test = require('tape')
const fs = require('fs')
const rm = require('rimraf')
const path = require('path')
const http = require('http')
const https = require('https')
const download = require('../download')
const util = require('../util')
const error = require('../error')

const build = path.join(__dirname, 'build')
const unpacked = path.join(build, 'Release/leveldown.node')

test('downloading from GitHub, not cached', function (t) {
  t.plan(10)

  const _createWriteStream = fs.createWriteStream
  const _createReadStream = fs.createReadStream
  const _request = https.request
  t.teardown(function () {
    fs.createWriteStream = _createWriteStream
    fs.createReadStream = _createReadStream
    https.request = _request
  })
  rm.sync(build)
  rm.sync(util.prebuildCache())

  const opts = getOpts()
  const downloadUrl = util.getDownloadUrl(opts)
  const cachedPrebuild = util.cachedPrebuild(downloadUrl)
  let tempFile

  let writeStreamCount = 0
  fs.createWriteStream = function (path) {
    if (writeStreamCount++ === 0) {
      tempFile = path
      t.ok(/\.tmp$/i.test(path), 'this is the temporary file')
    } else {
      t.ok(/\.node$/i.test(path), 'this is the unpacked file')
    }
    return _createWriteStream(path)
  }

  fs.createReadStream = function (path) {
    t.equal(path, cachedPrebuild, 'createReadStream called for cachedPrebuild')
    return _createReadStream(path)
  }

  https.request = function (opts) {
    https.request = _request
    t.equal('https://' + opts.hostname + opts.path, downloadUrl, 'correct url')
    return _request.apply(https, arguments)
  }

  t.equal(fs.existsSync(build), false, 'no build folder')

  download(downloadUrl, opts, function (err) {
    t.error(err, 'no error')
    t.equal(fs.existsSync(util.prebuildCache()), true, 'prebuildCache created')
    t.equal(fs.existsSync(cachedPrebuild), true, 'prebuild was cached')
    t.equal(fs.existsSync(unpacked), true, unpacked + ' should exist')
    t.equal(fs.existsSync(tempFile), false, 'temp file should be gone')
    t.end()
  })
})

test('cached prebuild', function (t) {
  t.plan(5)

  const _createWriteStream = fs.createWriteStream
  const _createReadStream = fs.createReadStream
  const _request = http.request
  t.teardown(function () {
    fs.createWriteStream = _createWriteStream
    fs.createReadStream = _createReadStream
    http.request = _request
  })
  rm.sync(build)

  const opts = getOpts()
  const downloadUrl = util.getDownloadUrl(opts)
  const cachedPrebuild = util.cachedPrebuild(downloadUrl)

  fs.createWriteStream = function (path) {
    t.ok(/\.node$/i.test(path), 'this is the unpacked file')
    return _createWriteStream(path)
  }

  fs.createReadStream = function (path) {
    t.equal(path, cachedPrebuild, 'createReadStream called for cachedPrebuild')
    return _createReadStream(path)
  }

  t.equal(fs.existsSync(build), false, 'no build folder')

  download(downloadUrl, opts, function (err) {
    t.error(err, 'no error')
    t.equal(fs.existsSync(unpacked), true, unpacked + ' should exist')
    t.end()
  })
})

test('local prebuild', function (t) {
  t.plan(6)

  const _createWriteStream = fs.createWriteStream
  const _createReadStream = fs.createReadStream
  const _request = http.request
  t.teardown(function () {
    fs.createWriteStream = _createWriteStream
    fs.createReadStream = _createReadStream
    http.request = _request
  })
  rm.sync(build)

  const opts = getOpts()
  const downloadUrl = util.getDownloadUrl(opts)
  const cachedPrebuild = util.cachedPrebuild(downloadUrl)
  const localPrebuild = util.localPrebuild(downloadUrl, opts)

  t.ok(fs.existsSync(cachedPrebuild), 'cached prebuild exists')

  // fs.copyFileSync() not available before Node 8.5
  fs.writeFileSync(localPrebuild, fs.readFileSync(cachedPrebuild))

  fs.createWriteStream = function (path) {
    t.ok(/\.node$/i.test(path), 'this is the unpacked file')
    return _createWriteStream(path)
  }

  fs.createReadStream = function (path) {
    t.equal(path, localPrebuild, 'createReadStream called for localPrebuild')
    return _createReadStream(path)
  }

  t.equal(fs.existsSync(build), false, 'no build folder')

  download(downloadUrl, opts, function (err) {
    t.error(err, 'no error')
    t.equal(fs.existsSync(unpacked), true, unpacked + ' should exist')
    t.end()
    rm.sync(localPrebuild)
  })
})

test('non existing host should fail with no dangling temp file', function (t) {
  t.plan(3)

  const _createWriteStream = fs.createWriteStream
  const _createReadStream = fs.createReadStream
  const _request = https.request
  t.teardown(function () {
    fs.createWriteStream = _createWriteStream
    fs.createReadStream = _createReadStream
    https.request = _request
  })

  const opts = getOpts()
  opts.pkg.binary = {
    host: 'https://foo.bar.baz'
  }

  const downloadUrl = util.getDownloadUrl(opts)
  const cachedPrebuild = util.cachedPrebuild(downloadUrl)

  fs.createWriteStream = function (path) {
    t.ok(false, 'no temporary file should be written')
    return _createWriteStream(path)
  }

  t.equal(fs.existsSync(cachedPrebuild), false, 'nothing cached')

  download(downloadUrl, opts, function (err) {
    t.ok(err, 'should error')
    t.equal(fs.existsSync(cachedPrebuild), false, 'nothing cached')
    t.end()
  })
})

test('existing host but invalid url should fail', function (t) {
  t.plan(3)

  const opts = getOpts()
  opts.pkg.binary = {
    host: 'http://localhost:8888',
    remote_path: 'prebuilds',
    package_name: 'woohooo-{abi}'
  }

  const downloadUrl = util.getDownloadUrl(opts)
  const cachedPrebuild = util.cachedPrebuild(downloadUrl)

  const server = http.createServer(function (req, res) {
    t.equal(req.url, '/prebuilds/woohooo-' + opts.abi, 'correct url')
    res.statusCode = 404
    res.end()
  }).listen(8888, function () {
    download(downloadUrl, opts, function (err) {
      t.same(err, error.noPrebuilts(opts))
      t.equal(fs.existsSync(cachedPrebuild), false, 'nothing cached')
      t.end()
      server.unref()
    })
  })
})

test('error during download should fail with no dangling temp file', function (t) {
  t.plan(7)

  const _createWriteStream = fs.createWriteStream
  const _createReadStream = fs.createReadStream
  const _request = http.request
  t.teardown(function () {
    fs.createWriteStream = _createWriteStream
    fs.createReadStream = _createReadStream
    http.request = _request
  })

  const downloadError = new Error('something went wrong during download')

  const opts = getOpts()
  opts.pkg.binary = {
    host: 'http://localhost:8889',
    remote_path: 'prebuilds',
    package_name: 'woohooo-{abi}'
  }

  const downloadUrl = util.getDownloadUrl(opts)
  const cachedPrebuild = util.cachedPrebuild(downloadUrl)
  let tempFile

  fs.createWriteStream = function (path) {
    tempFile = path
    t.ok(/\.tmp$/i.test(path), 'this is the temporary file')
    return _createWriteStream(path)
  }

  http.request = function (opts) {
    http.request = _request
    t.equal('http://' + opts.hostname + ':' + opts.port + opts.path, downloadUrl, 'correct url')
    const wrapped = arguments[1]
    arguments[1] = function (res) {
      t.equal(res.statusCode, 200, 'correct statusCode')
      // simulates error during download
      setTimeout(function () { res.emit('error', downloadError) }, 10)
      wrapped(res)
    }
    return _request.apply(http, arguments)
  }

  const server = http.createServer(function (req, res) {
    t.equal(req.url, '/prebuilds/woohooo-' + opts.abi, 'correct url')
    res.statusCode = 200
    res.write('yep') // simulates hanging request
  }).listen(8889, function () {
    download(downloadUrl, opts, function (err) {
      t.equal(err.message, downloadError.message, 'correct error')
      t.equal(fs.existsSync(tempFile), false, 'no dangling temp file')
      t.equal(fs.existsSync(cachedPrebuild), false, 'nothing cached')
      t.end()
      server.unref()
    })
  })
})

test('should fail if abi is system abi with invalid binary', function (t) {
  const opts = getOpts()
  opts.abi = process.versions.modules
  opts.pkg.binary = { host: 'http://localhost:8890' }

  const server = http.createServer(function (req, res) {
    res.statusCode = 200
    const archive = path.join(__dirname, 'invalid.tar.gz')
    fs.createReadStream(archive).pipe(res)
  }).listen(8890, function () {
    download(util.getDownloadUrl(opts), opts, function (err) {
      server.unref()
      if (err && typeof err.message === 'string') {
        t.pass('require failed because of invalid abi')
      } else {
        t.fail('should have caused a require() error')
      }
      t.end()
    })
  })
})

function getOpts () {
  return {
    pkg: require('a-native-module/package'),
    runtime: 'node',
    abi: 64,
    platform: process.platform,
    arch: process.arch,
    path: __dirname,
    'tag-prefix': 'v',
    'local-prebuilds': __dirname
  }
}
