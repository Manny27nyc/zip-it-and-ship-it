const { readFile, chmod, symlink, unlink, rename } = require('fs')
const { tmpdir } = require('os')
const { normalize, resolve } = require('path')
const { platform } = require('process')
const { promisify } = require('util')

const test = require('ava')
const cpy = require('cpy')
const del = require('del')
const execa = require('execa')
const pathExists = require('path-exists')
const { dir: getTmpDir, tmpName } = require('tmp-promise')

const { zipFunction, listFunctions, listFunctionsFiles } = require('..')
const { JS_BUNDLER_ESBUILD: ESBUILD, JS_BUNDLER_LEGACY: LEGACY } = require('../src/utils/consts')

const { getRequires, zipNode, zipFixture, unzipFiles, zipCheckFunctions, FIXTURES_DIR } = require('./helpers/main')
const { computeSha1 } = require('./helpers/sha')
const { makeTestBundlers } = require('./helpers/test_bundlers')

const pReadFile = promisify(readFile)
const pChmod = promisify(chmod)
const pSymlink = promisify(symlink)
const pUnlink = promisify(unlink)
const pRename = promisify(rename)

// Alias for the default bundler.
const DEFAULT = undefined
const EXECUTABLE_PERMISSION = 0o755

const normalizeFiles = function (fixtureDir, { name, mainFile, runtime, extension, srcFile }) {
  const mainFileA = normalize(`${fixtureDir}/${mainFile}`)
  const srcFileA = srcFile === undefined ? {} : { srcFile: normalize(`${fixtureDir}/${srcFile}`) }
  return { name, mainFile: mainFileA, runtime, extension, ...srcFileA }
}

const getZipChecksum = async function (t, bundler) {
  const {
    files: [{ path }],
  } = await zipFixture(t, 'many-dependencies', { opts: { jsBundlerVersion: bundler } })
  const sha1sum = computeSha1(path)
  return sha1sum
}

test.after.always(async () => {
  await del(`${tmpdir()}/zip-it-test-bundler-all*`, { force: true })
})

// Convenience method for running a test for each JS bundler.
const testBundlers = makeTestBundlers(test)

testBundlers('Zips Node.js function files', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const { files } = await zipNode(t, 'simple', { opts: { jsBundlerVersion: bundler } })
  t.true(files.every(({ runtime }) => runtime === 'js'))
})

testBundlers('Handles Node module with native bindings', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const jsExternalModules = bundler === ESBUILD ? ['test'] : undefined
  const { files } = await zipNode(t, 'node-module-native', {
    opts: { jsBundlerVersion: bundler, jsExternalModules },
  })
  t.true(files.every(({ runtime }) => runtime === 'js'))
})

testBundlers('Can require node modules', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'local-node-module', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Can require scoped node modules', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'node-module-scope', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Can require node modules nested files', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'node-module-path', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Can require dynamically generated node modules', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'side-module', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Ignore some excluded node modules', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'node-module-excluded', { opts: { jsBundlerVersion: bundler } })
  t.false(await pathExists(`${tmpDir}/src/node_modules/aws-sdk`))
})

testBundlers('Ignore TypeScript types', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'node-module-typescript-types', {
    opts: { jsBundlerVersion: bundler },
  })
  t.false(await pathExists(`${tmpDir}/src/node_modules/@types/node`))
})

testBundlers('Throws on runtime errors', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await t.throwsAsync(zipNode(t, 'node-module-error', { opts: { jsBundlerVersion: bundler } }))
})

testBundlers('Throws on missing dependencies', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await t.throwsAsync(zipNode(t, 'node-module-missing', { opts: { jsBundlerVersion: bundler } }))
})

testBundlers(
  'Throws on missing dependencies with no optionalDependencies',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    await t.throwsAsync(zipNode(t, 'node-module-missing-package', { opts: { jsBundlerVersion: bundler } }))
  },
)

testBundlers('Throws on missing conditional dependencies', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await t.throwsAsync(zipNode(t, 'node-module-missing-conditional', { opts: { jsBundlerVersion: bundler } }))
})

testBundlers("Throws on missing dependencies' dependencies", [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await t.throwsAsync(zipNode(t, 'node-module-missing-deep', { opts: { jsBundlerVersion: bundler } }))
})

testBundlers('Ignore missing optional dependencies', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'node-module-missing-optional', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Ignore modules conditional dependencies', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'node-module-deep-conditional', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Ignore missing optional peer dependencies', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'node-module-peer-optional', { opts: { jsBundlerVersion: bundler } })
})

testBundlers(
  'Throws on missing optional peer dependencies with no peer dependencies',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    await t.throwsAsync(zipNode(t, 'node-module-peer-optional-none', { opts: { jsBundlerVersion: bundler } }))
  },
)

testBundlers('Throws on missing non-optional peer dependencies', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await t.throwsAsync(zipNode(t, 'node-module-peer-not-optional', { opts: { jsBundlerVersion: bundler } }))
})

testBundlers(
  'Resolves dependencies from .netlify/plugins/node_modules',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    await zipNode(t, 'node-module-next-image', { opts: { jsBundlerVersion: bundler } })
  },
)

// We persist `package.json` as `package.json.txt` in git. Otherwise ESLint
// tries to load when linting sibling JavaScript files. In this test, we
// temporarily rename it to an actual `package.json`.
testBundlers('Throws on invalid package.json', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const fixtureDir = await tmpName({ prefix: `zip-it-test-bundler-${bundler}` })
  await cpy('**', `${fixtureDir}/invalid-package-json`, {
    cwd: `${FIXTURES_DIR}/invalid-package-json`,
    parents: true,
  })

  const invalidPackageJsonDir = `${fixtureDir}/invalid-package-json`
  const srcPackageJson = `${invalidPackageJsonDir}/package.json.txt`
  const distPackageJson = `${invalidPackageJsonDir}/package.json`
  const expectedErrorRegex =
    bundler === ESBUILD ? /package.json:1:1: error: Expected string but found "{"/ : /invalid JSON/

  await pRename(srcPackageJson, distPackageJson)
  try {
    await t.throwsAsync(
      zipNode(t, 'invalid-package-json', { opts: { jsBundlerVersion: bundler }, fixtureDir }),
      expectedErrorRegex,
    )
  } finally {
    await pRename(distPackageJson, srcPackageJson)
  }
})

testBundlers('Ignore invalid require()', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'invalid-require', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Can require local files', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'local-require', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Can require local files deeply', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'local-deep-require', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Can require local files in the parent directories', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'local-parent-require', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Ignore missing critters dependency for Next.js 10', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'node-module-next10-critters', { opts: { jsBundlerVersion: bundler } })
})

testBundlers(
  'Ignore missing critters dependency for Next.js exact version 10.0.5',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    await zipNode(t, 'node-module-next10-critters-exact', { opts: { jsBundlerVersion: bundler } })
  },
)

testBundlers(
  'Ignore missing critters dependency for Next.js with range ^10.0.5',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    await zipNode(t, 'node-module-next10-critters-10.0.5-range', { opts: { jsBundlerVersion: bundler } })
  },
)

testBundlers(
  "Ignore missing critters dependency for Next.js with version='latest'",
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    await zipNode(t, 'node-module-next10-critters-latest', { opts: { jsBundlerVersion: bundler } })
  },
)

// Need to create symlinks dynamically because they sometimes get lost when
// committed on Windows
if (platform !== 'win32') {
  testBundlers('Can require symlinks', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
    const fixtureDir = await tmpName({ prefix: `zip-it-test-bundler-${bundler}` })
    await cpy('**', `${fixtureDir}/symlinks`, {
      cwd: `${FIXTURES_DIR}/symlinks`,
      parents: true,
    })

    const symlinkDir = `${fixtureDir}/symlinks/function`
    const symlinkFile = `${symlinkDir}/file.js`
    const targetFile = `${symlinkDir}/target.js`

    if (!(await pathExists(symlinkFile))) {
      await pSymlink(targetFile, symlinkFile)
    }

    try {
      await zipNode(t, 'symlinks', { opts: { jsBundlerVersion: bundler }, fixtureDir })
    } finally {
      await pUnlink(symlinkFile)
    }
  })
}

testBundlers(
  'Can target a directory with a main file with the same name',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    await zipNode(t, 'directory-handler', { opts: { jsBundlerVersion: bundler } })
  },
)

testBundlers('Can target a directory with an index.js file', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const { files, tmpDir } = await zipFixture(t, 'index-handler', { opts: { jsBundlerVersion: bundler } })
  await unzipFiles(files)
  // eslint-disable-next-line import/no-dynamic-require, node/global-require
  t.true(require(`${tmpDir}/function.js`))
})

testBundlers('Keeps non-required files inside the target directory', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'keep-dir-files', { opts: { jsBundlerVersion: bundler } })
  t.true(await pathExists(`${tmpDir}/function.js`))
})

testBundlers(
  'Ignores non-required node_modules inside the target directory',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    const { tmpDir } = await zipNode(t, 'ignore-dir-node-modules', { opts: { jsBundlerVersion: bundler } })
    t.false(await pathExists(`${tmpDir}/src/node_modules`))
  },
)

testBundlers(
  'Ignores deep non-required node_modules inside the target directory',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    const { tmpDir } = await zipNode(t, 'ignore-deep-dir-node-modules', {
      opts: { jsBundlerVersion: bundler },
    })
    t.false(await pathExists(`${tmpDir}/src/deep/node_modules`))
  },
)

testBundlers('Works with many dependencies', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'many-dependencies', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Works with many function files', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'many-functions', {
    opts: { jsBundlerVersion: bundler },
    length: TEST_FUNCTIONS_LENGTH,
  })
})

const TEST_FUNCTIONS_LENGTH = 6

testBundlers('Produces deterministic checksums', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const [checksumOne, checksumTwo] = await Promise.all([getZipChecksum(t, bundler), getZipChecksum(t, bundler)])
  t.is(checksumOne, checksumTwo)
})

testBundlers('Throws when the source folder does not exist', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await t.throwsAsync(
    zipNode(t, 'does-not-exist', { opts: { jsBundlerVersion: bundler } }),
    /Functions folder does not exist/,
  )
})

testBundlers('Works even if destination folder does not exist', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'simple', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Do not consider node_modules as a function file', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'ignore-node-modules', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Ignore directories without a main file', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'ignore-directories', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Remove useless files', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'useless', { opts: { jsBundlerVersion: bundler } })
  t.false(await pathExists(`${tmpDir}/src/Desktop.ini`))
})

testBundlers('Works on empty directories', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'empty', { opts: { jsBundlerVersion: bundler }, length: 0 })
})

testBundlers('Works when no package.json is present', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const fixtureDir = await tmpName({ prefix: `zip-it-test-bundler-${bundler}` })
  await cpy('**', `${fixtureDir}/no-package-json`, { cwd: `${FIXTURES_DIR}/no-package-json`, parents: true })
  await zipNode(t, 'no-package-json', { opts: { jsBundlerVersion: bundler }, length: 1, fixtureDir })
})

testBundlers('Copies already zipped files', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const tmpDir = await tmpName({ prefix: `zip-it-test-bundler-${bundler}` })
  const { files } = await zipCheckFunctions(t, 'keep-zip', { tmpDir })

  t.true(files.every(({ runtime }) => runtime === 'js'))
  t.true(
    (await Promise.all(files.map(async ({ path }) => (await pReadFile(path, 'utf8')).trim() === 'test'))).every(
      Boolean,
    ),
  )
})

testBundlers('Ignore unsupported programming languages', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipFixture(t, 'unsupported', { length: 0, opts: { jsBundlerVersion: bundler } })
})

testBundlers('Can reduce parallelism', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  await zipNode(t, 'simple', { length: 1, opts: { jsBundlerVersion: bundler, parallelLimit: 1 } })
})

testBundlers('Can use zipFunction()', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const { path: tmpDir } = await getTmpDir({ prefix: 'zip-it-test' })
  const { runtime } = await zipFunction(`${FIXTURES_DIR}/simple/function.js`, tmpDir, { jsBundlerVersion: bundler })
  t.is(runtime, 'js')
})

testBundlers('Can list function main files with listFunctions()', [ESBUILD, LEGACY, DEFAULT], async (bundler, t) => {
  const fixtureDir = `${FIXTURES_DIR}/list`
  const functions = await listFunctions(fixtureDir)
  t.deepEqual(
    functions,
    [
      { name: 'four', mainFile: 'four.js/four.js.js', runtime: 'js', extension: '.js' },
      { name: 'one', mainFile: 'one/index.js', runtime: 'js', extension: '.js' },
      { name: 'test', mainFile: 'test', runtime: 'go', extension: '' },
      { name: 'test', mainFile: 'test.js', runtime: 'js', extension: '.js' },
      { name: 'test', mainFile: 'test.zip', runtime: 'js', extension: '.zip' },
      { name: 'two', mainFile: 'two/two.js', runtime: 'js', extension: '.js' },
    ].map(normalizeFiles.bind(null, fixtureDir)),
  )
})

testBundlers(
  'Can list all function files with listFunctionsFiles()',
  [ESBUILD, LEGACY, DEFAULT],
  async (bundler, t) => {
    const fixtureDir = `${FIXTURES_DIR}/list`
    const functions = await listFunctionsFiles(fixtureDir, { jsBundlerVersion: bundler })
    t.deepEqual(
      functions,
      [
        {
          name: 'four',
          mainFile: 'four.js/four.js.js',
          runtime: 'js',
          extension: '.js',
          srcFile: 'four.js/four.js.js',
        },
        { name: 'one', mainFile: 'one/index.js', runtime: 'js', extension: '.js', srcFile: 'one/index.js' },
        { name: 'test', mainFile: 'test', runtime: 'go', extension: '', srcFile: 'test' },
        { name: 'test', mainFile: 'test.js', runtime: 'js', extension: '.js', srcFile: 'test.js' },
        { name: 'test', mainFile: 'test.zip', runtime: 'js', extension: '.zip', srcFile: 'test.zip' },

        // The JSON file should only be present when using the legacy bundler,
        // since esbuild will inline it within the main file.
        bundler === LEGACY && {
          name: 'two',
          mainFile: 'two/two.js',
          runtime: 'js',
          extension: '.json',
          srcFile: 'two/three.json',
        },

        { name: 'two', mainFile: 'two/two.js', runtime: 'js', extension: '.js', srcFile: 'two/two.js' },
      ]
        .filter(Boolean)
        .map(normalizeFiles.bind(null, fixtureDir)),
    )
  },
)

testBundlers('Zips node modules', [LEGACY], async (bundler, t) => {
  await zipNode(t, 'node-module', { opts: { jsBundlerVersion: bundler } })
})

testBundlers('Include most files from node modules', [LEGACY], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'node-module-included', { opts: { jsBundlerVersion: bundler } })
  const [mapExists, htmlExists] = await Promise.all([
    pathExists(`${tmpDir}/src/node_modules/test/test.map`),
    pathExists(`${tmpDir}/src/node_modules/test/test.html`),
  ])
  t.false(mapExists)
  t.true(htmlExists)
})

testBundlers('Throws on missing critters dependency for Next.js 9', [LEGACY], async (bundler, t) => {
  await t.throwsAsync(zipNode(t, 'node-module-next9-critters', { opts: { jsBundlerVersion: bundler } }))
})

testBundlers('Includes specific Next.js dependencies when using next-on-netlify', [LEGACY], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'node-module-next-on-netlify', { opts: { jsBundlerVersion: bundler } })
  const [constantsExists, semverExists, otherExists, indexExists] = await Promise.all([
    pathExists(`${tmpDir}/src/node_modules/next/dist/next-server/lib/constants.js`),
    pathExists(`${tmpDir}/src/node_modules/next/dist/compiled/semver.js`),
    pathExists(`${tmpDir}/src/node_modules/next/dist/other.js`),
    pathExists(`${tmpDir}/src/node_modules/next/index.js`),
  ])
  t.true(constantsExists)
  t.true(semverExists)
  t.false(otherExists)
  t.false(indexExists)
})

testBundlers('Includes all Next.js dependencies when not using next-on-netlify', [LEGACY], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'node-module-next', { opts: { jsBundlerVersion: bundler } })
  const [constantsExists, semverExists, otherExists, indexExists] = await Promise.all([
    pathExists(`${tmpDir}/src/node_modules/next/dist/next-server/lib/constants.js`),
    pathExists(`${tmpDir}/src/node_modules/next/dist/compiled/semver.js`),
    pathExists(`${tmpDir}/src/node_modules/next/dist/other.js`),
    pathExists(`${tmpDir}/src/node_modules/next/index.js`),
  ])
  t.true(constantsExists)
  t.true(semverExists)
  t.true(otherExists)
  t.true(indexExists)
})

testBundlers('Inlines node modules in the bundle', [ESBUILD, DEFAULT], async (bundler, t) => {
  const { tmpDir } = await zipNode(t, 'node-module-included-try-catch', { opts: { jsBundlerVersion: bundler } })
  const requires = await getRequires({ filePath: resolve(tmpDir, 'function.js') })

  t.false(requires.includes('test'))
  t.false(await pathExists(`${tmpDir}/src/node_modules/test`))
})

testBundlers(
  'Does not inline node modules and includes them in a `node_modules` directory if they are defined in `externalModules`',
  [ESBUILD, DEFAULT],
  async (bundler, t) => {
    const { tmpDir } = await zipNode(t, 'node-module-included-try-catch', {
      opts: { jsBundlerVersion: bundler, jsExternalModules: ['test'] },
    })
    const requires = await getRequires({ filePath: resolve(tmpDir, 'function.js') })

    t.true(requires.includes('test'))
    t.true(await pathExists(`${tmpDir}/src/node_modules/test`))
  },
)

testBundlers(
  'Does not inline node modules and excludes them from the bundle if they are defined in `ignoredModules`',
  [ESBUILD, DEFAULT],
  async (bundler, t) => {
    const { tmpDir } = await zipNode(t, 'node-module-included-try-catch', {
      opts: { jsBundlerVersion: bundler, jsIgnoredModules: ['test'] },
    })
    const requires = await getRequires({ filePath: resolve(tmpDir, 'function.js') })

    t.true(requires.includes('test'))
    t.false(await pathExists(`${tmpDir}/src/node_modules/test`))
  },
)

testBundlers(
  'Include most files from node modules present in `externalModules`',
  [ESBUILD, DEFAULT],
  async (bundler, t) => {
    const { tmpDir } = await zipNode(t, 'node-module-included', {
      opts: { jsBundlerVersion: bundler, jsExternalModules: ['test'] },
    })
    const [mapExists, htmlExists] = await Promise.all([
      pathExists(`${tmpDir}/src/node_modules/test/test.map`),
      pathExists(`${tmpDir}/src/node_modules/test/test.html`),
    ])
    t.false(mapExists)
    t.true(htmlExists)
  },
)

testBundlers(
  'Does not throw if one of the modules defined in `externalModules` does not exist',
  [ESBUILD, DEFAULT],
  async (bundler, t) => {
    const { tmpDir } = await zipNode(t, 'node-module-included-try-catch', {
      opts: { jsBundlerVersion: bundler, jsExternalModules: ['i-do-not-exist'] },
    })

    t.false(await pathExists(`${tmpDir}/src/node_modules/i-do-not-exist`))
  },
)

test('Zips Rust function files', async (t) => {
  const { files, tmpDir } = await zipFixture(t, 'rust-simple', { length: 1 })

  t.true(files.every(({ runtime }) => runtime === 'rs'))

  await unzipFiles(files)

  const unzippedFile = `${tmpDir}/bootstrap`
  t.true(await pathExists(unzippedFile))

  // The library we use for unzipping does not keep executable permissions.
  // https://github.com/cthackers/adm-zip/issues/86
  // However `chmod()` is not cross-platform
  if (platform === 'linux') {
    await pChmod(unzippedFile, EXECUTABLE_PERMISSION)

    const { stdout } = await execa(unzippedFile)
    t.is(stdout, 'Hello, world!')
  }

  const tcFile = `${tmpDir}/netlify-toolchain`
  t.true(await pathExists(tcFile))
  const tc = (await pReadFile(tcFile, 'utf8')).trim()
  t.is(tc, '{"runtime":"rs"}')
})

test('Zips Go function files', async (t) => {
  const { files, tmpDir } = await zipFixture(t, 'go-simple', { length: 1, opts: { zipGo: true } })

  t.true(files.every(({ runtime }) => runtime === 'go'))

  await unzipFiles(files)

  const unzippedFile = `${tmpDir}/test`
  t.true(await pathExists(unzippedFile))

  // The library we use for unzipping does not keep executable permissions.
  // https://github.com/cthackers/adm-zip/issues/86
  // However `chmod()` is not cross-platform
  if (platform === 'linux') {
    await pChmod(unzippedFile, EXECUTABLE_PERMISSION)

    const { stdout } = await execa(unzippedFile)
    t.is(stdout, 'test')
  }

  const tcFile = `${tmpDir}/netlify-toolchain`
  t.true(await pathExists(tcFile))
  const tc = (await pReadFile(tcFile, 'utf8')).trim()
  t.is(tc, '{"runtime":"go"}')
})

test('Can skip zipping Go function files', async (t) => {
  const { files } = await zipFixture(t, 'go-simple', { length: 1 })

  t.true(files.every(({ runtime }) => runtime === 'go'))
  t.true(
    (await Promise.all(files.map(async ({ path }) => !path.endsWith('.zip') && (await pathExists(path))))).every(
      Boolean,
    ),
  )
})
