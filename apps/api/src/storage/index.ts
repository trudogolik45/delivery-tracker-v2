import { env } from '../env.js'
import { LocalStorage, makeKey } from './local.js'
import type { Storage } from './types.js'

export const storage: Storage = new LocalStorage(env.STORAGE_ROOT, env.PUBLIC_BASE)
export { makeKey }
export type { Storage }
