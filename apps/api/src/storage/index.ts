import { env } from '../env.js'
import { LocalStorage, makeKey, sniffImageMime } from './local.js'
import type { Storage } from './types.js'

export const storage: Storage = new LocalStorage(env.STORAGE_ROOT)
export { makeKey, sniffImageMime }
export type { Storage }
