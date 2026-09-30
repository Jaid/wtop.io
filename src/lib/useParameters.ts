import type {ParameterKey, QueryParameters} from '#src/queryParameters.ts'

import {useState} from 'react'
import {useLocation, useSearch} from 'wouter'

import {defaults, readQueryParameters} from '#src/queryParameters.ts'

/** URL input is read-only. Only /setup explicitly serializes a draft into a link. */
export const useParameters = () => {
  const search = useSearch()
  const [path] = useLocation()
  const origin = typeof window === 'undefined' ? 'http://localhost' : globalThis.location.origin
  return {
    ...readQueryParameters(`${origin}${path}?${search}`),
    search,
  }
}

/** A dashboard starts from the link and keeps all subsequent changes in component state. */
export const useDashboardParameters = () => {
  const parsed = useParameters()
  const [initial] = useState(() => parsed)
  const [values, setValues] = useState(() => initial.values)
  const setParameter = <Key extends ParameterKey>(key: Key, value: QueryParameters[Key] | undefined) => {
    setValues(current => ({
      ...current,
      [key]: value === undefined && key in defaults ? defaults[key as keyof typeof defaults] : value,
    }))
  }
  return {
    values,
    setParameter,
    initial: initial.values,
    errors: initial.errors,
    search: initial.search,
  }
}
