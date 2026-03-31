const test = require('tape')
const fs = require('fs')
const rm = require('rimraf')
const path = require('path')
const https = require('https')
const download = require('../download')
const util = require('../util')
const asset = require('../asset')
const nock = require('nock')
const releases = require('./releases.json')

const build = path.join(__dirname, 'build')
const unpacked = path.join(build, 'Release/leveldown.node')

// Release assets call
nock('https://api.github.com:443', {
  encodedQueryParams: true,
  reqheaders: {
    'User-Agent': 'simple-get',
    Authorization: 'token TOKEN'
  }
})
  .persist()
  .get('/repos/ralphtheninja/a-native-module/releases')
  .reply(200, releases)

// Binary download
nock('https://api.github.com:443', {
  encodedQueryParams: true,
  reqheaders: {
    'User-Agent': 'simple-get'
  }
})
  .persist()
  .get(function (uri) {
    return /\/repos\/ralphtheninja\/a-native-module\/releases\/assets\/\d*/g.test(uri)
  }).reply(302, undefined, {
    Location: function (req, res, body) {
      const assetId = req.path
        .replace('/repos/ralphtheninja/a-native-module/releases/assets/', '')

      for (const release of releases) {
        for (const asset of release.assets) {
          if (asset.id.toString() === assetId) {
            return asset.browser_download_url
          }
        }
      }
    }
  })

test('downloading from GitHub with token', function (t) {
  t.plan(11)

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
  asset(opts, function (err, assetId) {
    t.error(err, 'no error')

    const downloadUrl = util.getAssetUrl(opts, assetId)
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

    let requestCount = 0
    https.request = function (req) {
      requestCount++
      if (requestCount === 1) {
      // https.request = _request
        t.equal('https://' + req.hostname + req.path, downloadUrl, 'correct url')
      }
      // return _request.apply(https, arguments)
      const rq = _request.apply(https, arguments)
      // 👇 添加调试：监听 request 错误
      rq.on('error', (err) => {
        console.error('[DEBUG] Request error:', err.message, '| Code:', err.code)
      })

      // 👇 添加调试：如果 response 有 error 也捕获
      const originalOn = rq.on
      rq.on = function (event, listener) {
        if (event === 'response') {
          const wrappedListener = function (res) {
            res.on('error', (err) => {
              console.error('[DEBUG] Response error:', err.message)
            })
            listener(res)
          }
          return originalOn.call(this, event, wrappedListener)
        }
        return originalOn.call(this, event, listener)
      }

      return rq
    }

    t.equal(fs.existsSync(build), false, 'no build folder')

    // console.log(`opts: ${JSON.stringify(opts)}`)
    // console.log(`downloadUrl: ${downloadUrl}`)
    download(downloadUrl, opts, function (err) {
      if (err) {
        console.error('[FINAL ERROR]', err)
        console.error('[STACK]', err.stack)
      }
      t.error(err, 'no error')
      t.equal(fs.existsSync(util.prebuildCache()), true, 'prebuildCache created')
      t.equal(fs.existsSync(cachedPrebuild), true, 'prebuild was cached')
      t.equal(fs.existsSync(unpacked), true, unpacked + ' should exist')
      t.equal(fs.existsSync(tempFile), false, 'temp file should be gone')
      t.end()
    })
  })
})

test('non existing version should fail asset request', function (t) {
  t.plan(3)
  rm.sync(build)
  rm.sync(util.prebuildCache())

  const opts = getOpts()
  opts.pkg = Object.assign({}, opts.pkg, { version: '0' })
  asset(opts, function (err, assetId) {
    t.ok(err, 'should error')
    t.equal(assetId, undefined)

    const downloadUrl = util.getAssetUrl(opts, assetId)
    const cachedPrebuild = util.cachedPrebuild(downloadUrl)

    t.equal(fs.existsSync(cachedPrebuild), false, 'nothing cached')
    t.end()
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
    token: 'TOKEN',
    'tag-prefix': 'v'
  }
}
