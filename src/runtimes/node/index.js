const { join } = require('path')

const cpFile = require('cp-file')

const { JS_BUNDLER_ESBUILD, JS_BUNDLER_ESBUILD_ZISI, JS_BUNDLER_ZISI, RUNTIME_JS } = require('../../utils/consts')

const { detectEsModule } = require('./detect_es_module')
const { findFunctionsInPaths } = require('./finder')
const { getSrcFiles } = require('./src_files')
const { zipEsbuild } = require('./zip_esbuild')
const { zipZisi } = require('./zip_zisi')

// We use ZISI as the default bundler until the next major release, with the
// exception of TypeScript files, for which the only option is esbuild.
const getDefaultBundler = async ({ extension, mainFile }) => {
  if (extension === '.ts') {
    return JS_BUNDLER_ESBUILD
  }

  const isEsModule = await detectEsModule({ mainFile })

  if (isEsModule) {
    return JS_BUNDLER_ESBUILD
  }

  return JS_BUNDLER_ZISI
}

// A proxy for the `getSrcFiles` function which adds a default `bundler` using
// the `getDefaultBundler` function.
const getSrcFilesWithBundler = async (parameters) => {
  const bundler = parameters.config.nodeBundler || (await getDefaultBundler({ extension: parameters.extension }))

  return getSrcFiles({ ...parameters, bundler })
}

const zipFunction = async function ({
  archiveFormat,
  basePath,
  config = {},
  destFolder,
  extension,
  filename,
  mainFile,
  name,
  pluginsModulesPath,
  srcDir,
  srcPath,
  stat,
}) {
  // how do you construct the srcFile?
  const bundler = config.nodeBundler || (await getDefaultBundler({ extension, mainFile }))

  // If the file is a zip, we assume the function is bundled and ready to go.
  // We simply copy it to the destination path with no further processing.
  if (extension === '.zip') {
    const destPath = join(destFolder, filename)
    await cpFile(srcPath, destPath)
    return { config, path: destPath }
  }

  if (bundler === JS_BUNDLER_ZISI) {
    return zipZisi({
      archiveFormat,
      basePath,
      config,
      destFolder,
      extension,
      filename,
      mainFile,
      pluginsModulesPath,
      srcDir,
      srcPath,
      stat,
    })
  }

  return zipEsbuild({
    archiveFormat,
    basePath,
    config,
    destFolder,
    extension,
    filename,
    mainFile,
    name,
    pluginsModulesPath,
    srcDir,
    srcPath,
    stat,
  })
}

const zipWithFunctionWithFallback = async ({ config = {}, ...parameters }) => {
  // If a specific JS bundler version is specified, we'll use it.
  if (config.nodeBundler !== JS_BUNDLER_ESBUILD_ZISI) {
    return zipFunction({ ...parameters, config })
  }

  // Otherwise, we'll try to bundle with esbuild and, if that fails, fallback
  // to zisi.
  try {
    return await zipFunction({ ...parameters, config: { ...config, nodeBundler: JS_BUNDLER_ESBUILD } })
  } catch (esbuildError) {
    try {
      const data = await zipFunction({ ...parameters, config: { ...config, nodeBundler: JS_BUNDLER_ZISI } })

      return { ...data, bundlerErrors: esbuildError.errors }
    } catch (zisiError) {
      throw esbuildError
    }
  }
}

module.exports = {
  findFunctionsInPaths,
  getSrcFiles: getSrcFilesWithBundler,
  name: RUNTIME_JS,
  zipFunction: zipWithFunctionWithFallback,
}
