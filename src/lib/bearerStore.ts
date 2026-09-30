import {useSyncExternalStore} from 'react'

const storageKey = 'wtop.bearer'

type Store = Record<string, string>

const listeners = new Set<() => void>
const read = (): Store => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[\x21-\x7E]+$/.test(entry[1]))) : {}
  } catch {
    return {}
  }
}
let snapshot = read()
const write = (store: Store) => {
  try {
    if (!globalThis.localStorage) {
      throw new Error
    }
    if (Object.keys(store).length === 0) {
      globalThis.localStorage?.removeItem(storageKey)
    } else {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(store))
    }
  } catch {
    throw new Error('The browser could not save the token. Check storage permissions or available space.')
  }
  snapshot = store
  for (const listener of listeners) {
    listener()
  }
}
if (typeof window !== 'undefined') {
  globalThis.addEventListener('storage', event => {
    if ('key' in event && (event.key === storageKey || event.key === null)) {
      snapshot = read()
      for (const listener of listeners) {
        listener()
      }
    }
  })
}

/**
 * Bearer tokens saved in local storage, keyed by Docker endpoint, so they never have to appear in shared URLs.
 */
export const getStoredBearer = (endpoint: string | undefined) => (endpoint ? snapshot[endpoint] : undefined)

export const saveBearer = (endpoint: string, token: string) => {
  const store = {...snapshot}
  if (token) {
    store[endpoint] = token
  } else {
    delete store[endpoint]
  }
  write(store)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useStoredBearers = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
