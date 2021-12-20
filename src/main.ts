import { extname } from 'path'

import { Config } from './config'
import { FeatureFlags, getFlags } from './feature_flags'
import { FunctionSource } from './function'
import { getFunctionsFromPaths } from './runtimes'
import { GetSrcFilesFunction, RuntimeName } from './runtimes/runtime'
import { listFunctionsDirectories, resolveFunctionsDirectories } from './utils/fs'

interface ListedFunction {
  name: string
  mainFile: string
  runtime: RuntimeName
  extension: string
  schedule?: string
}

type ListedFunctionFile = ListedFunction & {
  srcFile: string
}

interface ListFunctionsOptions {
  basePath?: string
  config?: Config
  featureFlags?: FeatureFlags
}

// List all Netlify Functions main entry files for a specific directory
const listFunctions = async function (
  relativeSrcFolders: string | string[],
  { featureFlags: inputFeatureFlags, config }: { featureFlags?: FeatureFlags; config?: Config } = {},
) {
  const featureFlags = getFlags(inputFeatureFlags)
  const srcFolders = resolveFunctionsDirectories(relativeSrcFolders)
  const paths = await listFunctionsDirectories(srcFolders)
  const functions = await getFunctionsFromPaths(paths, { featureFlags, config })
  const listedFunctions = [...functions.values()].map(getListedFunction)
  return listedFunctions
}

// List all Netlify Functions files for a specific directory
const listFunctionsFiles = async function (
  relativeSrcFolders: string | string[],
  { basePath, config, featureFlags: inputFeatureFlags }: ListFunctionsOptions = {},
) {
  const featureFlags = getFlags(inputFeatureFlags)
  const srcFolders = resolveFunctionsDirectories(relativeSrcFolders)
  const paths = await listFunctionsDirectories(srcFolders)
  const functions = await getFunctionsFromPaths(paths, { config, featureFlags })
  const listedFunctionsFiles = await Promise.all(
    [...functions.values()].map((func) => getListedFunctionFiles(func, { basePath, featureFlags })),
  )

  return listedFunctionsFiles.flat()
}

const getListedFunction = function ({ runtime, name, mainFile, extension, config }: FunctionSource): ListedFunction {
  return { name, mainFile, runtime: runtime.name, extension, schedule: config.schedule }
}

const getListedFunctionFiles = async function (
  func: FunctionSource,
  options: { basePath?: string; featureFlags: FeatureFlags },
): Promise<ListedFunctionFile[]> {
  const srcFiles = await getSrcFiles({ ...func, ...options })
  const { name, mainFile, runtime } = func

  return srcFiles.map((srcFile) => ({ srcFile, name, mainFile, runtime: runtime.name, extension: extname(srcFile) }))
}

const getSrcFiles: GetSrcFilesFunction = async function ({ extension, runtime, srcPath, ...args }) {
  const { getSrcFiles: getRuntimeSrcFiles } = runtime

  if (extension === '.zip' || typeof getRuntimeSrcFiles !== 'function') {
    return [srcPath]
  }

  return await getRuntimeSrcFiles({
    extension,
    runtime,
    srcPath,
    ...args,
  })
}

export { listFunctions, listFunctionsFiles }

export { zipFunction, zipFunctions } from './zip'
