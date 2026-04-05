const os = require('os')
const path = require('path')
const fs = require('fs')
const proc = require('child_process')
const napi = require('napi-build-utils')
const mkdirp = require('mkdirp-classic')
const tar = require('tar-fs')
const pump = require('pump')
const abi = require('node-abi')
const assert = require('assert')

const backends = {
  'node-gyp': require('node-gyp')(),
  'node-ninja': require('node-ninja')(),
  'nw-gyp': require('nw-gyp')()
}

// Use system installed node-gyp for other JS engines
const osType = os.type()
const jsEngine = process.jsEngine || 'v8'
if (jsEngine !== 'v8' || osType.startsWith('MINGW32_NT')) {
  backends['node-gyp'] = require(path.join(
    path.dirname(process.execPath), '../lib/node_modules/npm/node_modules/node-gyp'))()
}

function build (opts, cb) {
  // const build = opts.backend || gypbuild
  const version = opts.target
  gypbuild(opts, version, function (code) {
    if (code) return cb(spawnError('node-gyp', code))
    // log.verbose('completed building ')

    findBuild(opts.output, function (err, output) {
      if (err) return cb(err)

      // log.warn('build output: ' + output)
      strip(output, opts, function (err) {
        if (err) return cb(err)
        cb(null, output)
      })
    })
  })
}

function preinstall (rc, cb) {
  if (!rc.armv) {
    rc.armv = process.env.PREBUILD_ARMV || armv(rc)
  }

  if (!rc.out) {
    rc.out = rc.path
  }

  const buildFolder = path.join(rc.out, 'prebuilds', rc.platform + '-' + rc.arch + ((typeof rc.libc === 'string' && rc.libc.trim() !== '') ? ('-' + rc.libc) : ''))
  const opts = Object.assign({}, rc, {
    buildFolder,
    shell: process.env.PREBUILD_SHELL || shell(),
    // nodeGyp: process.env.PREBUILD_NODE_GYP || npmbin('node-gyp'),
    output: path.join(rc.path, 'build', rc.debug ? 'Debug' : 'Release'),
    cwd: '.'
  })

  if (opts.arch === 'ia32' && opts.platform === 'linux' && opts.arch !== os.arch()) {
    opts.env.CFLAGS = '-m32'
  }

  mkdirp(opts.buildFolder, function (err) {
    if (err) return cb(err)
    run(opts.preinstall, opts, function (err) {
      if (err) return cb(err)

      build(opts, function (err, filename) {
        if (err) return cb(err)

        run(opts.postinstall, opts, function (err) {
          if (err) return cb(err)

          copySharedLibs(opts.output, opts.buildFolder, opts, function (err) {
            if (err) return cb(err)

            const name = prebuildName(opts)
            const dest = path.join(opts.buildFolder, name)

            fs.rename(filename, dest, function (err) {
              if (err) return cb(err)
              if (opts.artifacts) return copyRecursive(opts.artifacts, opts.buildFolder, cb)
              return cb()
            })
          })
        })
      })
    })
  })
}

function encodeName (name) {
  return name.replace(/\//g, '+')
}

function prebuildName (opts) {
  const tags = [encodeName(opts.pkg.name || opts.runtime)]

  if (opts.runtime !== 'napi') {
    tags.push('abi' + abi.getAbi(opts.target, opts.runtime))
  }

  if (opts.tagUv) {
    const uv = opts.tagUv === true ? opts.uv : opts.tagUv
    if (uv) tags.push('uv' + uv)
  }

  if (opts.tagArmv) {
    const armv = opts.tagArmv === true ? opts.armv : opts.tagArmv
    if (armv) tags.push('armv' + armv)
  }

  if (opts.tagLibc) {
    const libc = opts.tagLibc === true ? opts.libc : opts.tagLibc
    if (libc) tags.push(libc)
  }

  return tags.join('.') + '.node'
}

function shell () {
  switch (os.platform()) {
    case 'win32': return true
    case 'android': return 'sh'
    default: return undefined
  }
}

function copySharedLibs (builds, folder, opts, cb) {
  fs.readdir(builds, function (err, files) {
    if (err) return cb()

    const libs = files.filter(function (name) {
      return /\.dylib$/.test(name) || /\.so(\.\d+)?$/.test(name) || /\.dll$/.test(name)
    })

    loop()

    function loop (err) {
      if (err) return cb(err)
      const next = libs.shift()
      if (!next) return cb()

      strip(path.join(builds, next), opts, function (err) {
        if (err) return cb(err)
        copy(path.join(builds, next), path.join(folder, next), loop)
      })
    }
  })
}

function run (cmd, opts, cb) {
  if (!cmd) return cb()

  const child = proc.spawn(cmd, [], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: 'inherit',
    shell: opts.shell || true,
    windowsHide: true
  })

  child.on('exit', function (code) {
    if (code) return cb(spawnError(cmd, code))
    cb()
  })
}

function findBuild (dir, cb) {
  fs.readdir(dir, function (err, files) {
    if (err) return cb(err)

    files = files.filter(function (name) {
      return /\.node$/i.test(name)
    })

    if (!files.length) return cb(new Error('Could not find build'))
    cb(null, path.join(dir, files[0]))
  })
}

function strip (file, opts, cb) {
  const platform = os.platform()
  if (!opts.strip || (platform !== 'darwin' && platform !== 'linux')) return cb()

  const args = platform === 'darwin' ? [file, '-Sx'] : [file, '--strip-all']
  const child = proc.spawn(opts.stripBin, args, {
    stdio: 'ignore',
    shell: opts.shell,
    windowsHide: true
  })

  child.on('exit', function (code) {
    if (code) return cb(spawnError(opts.stripBin, code))
    cb()
  })
}

function spawnError (name, code) {
  return new Error(name + ' exited with ' + code)
}

function copy (a, b, cb) {
  fs.stat(a, function (err, st) {
    if (err) return cb(err)
    fs.readFile(a, function (err, buf) {
      if (err) return cb(err)
      fs.writeFile(b, buf, function (err) {
        if (err) return cb(err)
        fs.chmod(b, st.mode, cb)
      })
    })
  })
}

function copyRecursive (src, dst, cb) {
  pump(tar.pack(src), tar.extract(dst), cb)
}

function armv (opts) {
  const host = os.arch()
  const target = opts.arch

  // Can't detect armv in cross-compiling scenarios.
  if (host !== target) return ''

  return (host === 'arm64' ? '8' : process.config.variables.arm_version) || ''
}

function runGyp (opts, cb) {
  const backend = opts.backend || 'node-gyp'
  const gyp = opts.gyp || backends[backend]
  assert(gyp, 'missing backend')
  const log = opts.log
  const args = opts.args
  assert(Array.isArray(args), 'args must be an array')

  log.verbose('execute ' + backend + ' with `' + args.join(' ') + '`')
  gyp.parseArgv(args)
  gyp.devDir = devDir(opts.runtime || 'node')

  function runStep () {
    const command = gyp.todo.shift()
    if (!command) {
      return cb()
    }

    if (opts.filter) {
      if (opts.filter(command)) {
        process.nextTick(runStep)
        return
      }
    }

    gyp.commands[command.name](command.args).then(function () {
      log.verbose('ok')
      process.nextTick(runStep)
    }, function (err) {
      log.error(command.name + ' error')
      log.error('stack', err.stack)
      log.error('not ok')
      return cb(err)
    })
  }

  if (gyp.todo.length > 0) {
    runStep()
  } else {
    log.verbose('no gyp tasks needed')
    cb()
  }
}

function devDir (runtime) {
  // Since electron and node are reusing the versions now (fx 6.0.0) and
  // node-gyp only uses the version to store the dev files, they have started
  // clashing. To work around this we explicitly set devdir to tmpdir/runtime(/target)
  return path.join(os.tmpdir(), 'prebuild', runtime)
}

function gypbuild (opts, target, cb) {
  const args = ['node', 'index.js']
  if (opts.backend === 'node-ninja') {
    args.push('configure')
    args.push('build')
    args.push('--builddir=build/' + target)
  } else {
    args.push('rebuild')
  }
  if (napi.isNapiRuntime(opts.runtime)) {
    args.push('--napi_build_version=' + target)
  } else {
    args.push('--target=' + target)
  }
  args.push('--arch=' + opts.arch.split('+')[0])
  if (opts.runtime === 'electron') {
    args.push('--runtime=electron')
    args.push('--dist-url=https://electronjs.org/headers')
  } else if (opts.runtime === 'node-webkit') {
    args.push('--runtime=node-webkit')
  } else if (opts.runtime === 'node') {
    // work around bug introduced in node 10's build https://github.com/nodejs/node-gyp/issues/1457
    args.push('--build_v8_with_gn=false')
    // work around the same kind of bug for node 11
    args.push('--enable_lto=false')
  }
  if (opts.debug) args.push('--debug')

  if (opts.format) args.push('--', '--format', opts.format)

  runGyp({
    gyp: opts.gyp,
    runtime: opts.runtime,
    backend: opts.backend,
    log: opts.log,
    args,
    filter: function (command) {
      if (command.name === 'configure') {
        return configurePreGyp(command, opts)
      }
    }
  }, cb)
}

function configurePreGyp (command, opts) {
  const binary = opts.pkg.binary
  if (binary && binary.module_name) {
    command.args.push('-Dmodule_name=' + binary.module_name)
  }
  if (binary && binary.module_path) {
    command.args.push('-Dmodule_path=' + binary.module_path)
  }
}

module.exports = preinstall
