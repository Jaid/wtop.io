import {afterEach, describe, expect, test} from 'bun:test'

import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react'
import {createElement} from 'react'

import testSassModulesPlugin from './lib/sassModulesPlugin.ts'

Bun.plugin(testSassModulesPlugin)
type RenderOptions = {
  path?: string
  props?: Record<string, unknown>
}
async function renderComponent(componentSegment: string, options: RenderOptions = {}) {
  globalThis.history.replaceState(null, '', options.path ?? '/')
  const Component = (await import(`#src/components/${componentSegment}/index.tsx`)).default
  return render(createElement(Component, options.props))
}
afterEach(() => {
  cleanup()
  globalThis.history.replaceState(null, '', '/')
  localStorage.clear()
  globalThis.dispatchEvent(new StorageEvent('storage', {key: null}))
})
describe('components', () => {
  test('App redirects to the setup without a host', async () => {
    const {container} = await renderComponent('App')
    await waitFor(() => expect(globalThis.location.pathname).toBe('/setup'))
    await waitFor(() => expect(container.textContent).toContain('Docker endpoint'))
  })
  test('Setup builds a live link and keeps the Bearer token out of it', async () => {
    const {container, getByPlaceholderText, getByText} = await renderComponent('App', {path: '/setup'})
    const host = getByPlaceholderText('192.168.1.20') as HTMLInputElement
    act(() => {
      fireEvent.change(host, {target: {value: 'nas.lan'}})
    })
    await waitFor(() => expect(container.textContent).toContain('?host=nas.lan'))
    const token = getByPlaceholderText('paste a token') as HTMLInputElement
    act(() => {
      fireEvent.change(token, {target: {value: 'supersecret'}})
    })
    act(() => {
      fireEvent.click(getByText('Save'))
    })
    expect(JSON.parse(localStorage.getItem('wtop.bearer') ?? '{}')).toEqual({'http://nas.lan:2375': 'supersecret'})
    expect(container.textContent).not.toContain('supersecret')
    expect(container.textContent).toContain('…cret')
  })
  test('Setup validates fields', async () => {
    const {container, getByPlaceholderText} = await renderComponent('App', {path: '/setup'})
    act(() => {
      fireEvent.change(getByPlaceholderText('2375'), {target: {value: '70000'}})
    })
    await waitFor(() => expect(container.textContent).toContain('Expected a value between 1 and 65535'))
  })
  test('Demo dashboard renders panels and processes', async () => {
    const {container} = await renderComponent('App', {path: '/demo'})
    await waitFor(() => expect(container.textContent).toContain('Processes'), {timeout: 4000})
    expect(container.textContent).toContain('atlas')
    expect(container.textContent).toContain('Memory')
    expect(container.textContent).toContain('postgres')
  })
  test('Meter clamps segments', async () => {
    const {container} = await renderComponent('Meter', {props: {segments: [{
      key: 'a',
      percent: 80,
      color: 'red',
    }, {
      key: 'b',
      percent: 50,
      color: 'blue',
    }]}})
    const segments = container.querySelectorAll('span')
    expect(segments).toHaveLength(2)
    expect(segments[1].style.getPropertyValue('--width')).toBe('20%')
  })
  test('Sparkline waits for enough data', async () => {
    const {container} = await renderComponent('Sparkline', {props: {
      color: 'red',
      values: [1],
    }})
    expect(container.textContent).toContain('collecting')
  })
})
describe('migration regressions', () => {
  test('incoming URL tokens do not enter the shared dashboard link', async () => {
    const {getByTestId} = await renderComponent('App', {path: '/setup?host=nas&bearer=private-from-url'})
    const link = getByTestId('dashboard-link') as HTMLAnchorElement
    expect(link.href).not.toContain('bearer')
    expect(link.href).not.toContain('private-from-url')
  })
  test('failed storage writes leave the credential unsaved and report the failure', async () => {
    const {getByLabelText, getByText, container} = await renderComponent('App', {path: '/setup?host=storage-test'})
    fireEvent.change(getByLabelText('Bearer token'), {target: {value: 'not-persisted-secret'}})
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    const originalStorage = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
      getItem: originalStorage.getItem.bind(originalStorage),
      setItem: () => {
        throw new DOMException('Quota', 'QuotaExceededError')
      },
    }})
    try {
      fireEvent.click(getByText('Save'))
      expect(container.textContent).toContain('could not save the token')
      expect(container.textContent).not.toContain('is saved for this endpoint')
      expect((getByLabelText('Bearer token') as HTMLInputElement).value).toBe('not-persisted-secret')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })
  test('switching endpoints clears the unsaved credential draft', async () => {
    const {getByLabelText} = await renderComponent('App', {path: '/setup?host=one'})
    fireEvent.change(getByLabelText('Bearer token'), {target: {value: 'endpoint-one-secret'}})
    fireEvent.change(getByLabelText('host'), {target: {value: 'two'}})
    await waitFor(() => expect((getByLabelText('Bearer token') as HTMLInputElement).value).toBe(''))
  })
  test('sparklines keep missing samples as separate finite paths', async () => {
    const {container} = await renderComponent('Sparkline', {props: {
      color: 'red',
      values: [1, 2, Number.NaN, 3, 4],
    }})
    const strokes = container.querySelectorAll('path[fill="none"]')
    expect(strokes).toHaveLength(2)
    expect(container.innerHTML).not.toContain('NaN')
  })
})
