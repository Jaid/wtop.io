import type {ParameterKey, QueryParameters} from '#src/queryParameters.ts'

import {useLocation, useSearch} from 'wouter'

import {defaults, readQueryParameters} from '#src/queryParameters.ts'

/**
 * Reactive view on the URL parameters plus a setter that rewrites the current history entry.
 */
export const useParameters = () => {
  const search = useSearch()
  const [location, navigate] = useLocation()
  const href = typeof window === 'undefined' ? `http://localhost/?${search}` : `${globalThis.location.origin}${location}?${search}${globalThis.location.hash}`
  const {values, errors} = readQueryParameters(href)
  const setParameter = <Key extends ParameterKey>(key: Key, value: QueryParameters[Key] | undefined) => {
    const params = new URLSearchParams(globalThis.location.search)
    const isDefault = key in defaults && defaults[key as keyof typeof defaults] === value
    if (value === undefined || value === '' || isDefault) {
      params.delete(key)
    } else {
      params.set(key, String(value))
    }
    const text = params.toString()
    navigate(`${location}${text ? `?${text}` : ''}${globalThis.location.hash}`, {replace: true})
  }
  return {
    values,
    errors,
    setParameter,
    search,
  }
}
