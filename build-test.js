#!/usr/bin/env node

process.env.NODE_ENV = 'test'

const path = require('path')
let test = null

try {
  const pkg = require(path.join(process.cwd(), 'package.json'))
  if (pkg.name && process.env[pkg.name.toUpperCase().replace(/-/g, '_')]) {
    process.exit(0)
  }
  test = pkg.prebuild.test
} catch (err) {
  //  do nothing
}

if (test) require(path.join(process.cwd(), test))
else require('./')()
