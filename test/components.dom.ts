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
  test('App redirects home without a host', async () => {
    const {container} = await renderComponent('App')
    await waitFor(() => expect(globalThis.location.pathname).toBe('/home'))
    await waitFor(() => expect(container.textContent).toContain('Your Linux host, at a glance.'))
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
describe('dashboard preferences and tags', () => {
  test('panel and column checkboxes serialize an explicit empty selection', async () => {
    const {container} = await renderComponent('App', {path: '/setup?host=nas'})
    const panels = [...container.querySelectorAll<HTMLInputElement>('input[name^="panel."]')]
    expect(panels).toHaveLength(7)
    for (const input of panels) {
      fireEvent.click(input)
    }
    const columns = [...container.querySelectorAll<HTMLInputElement>('input[name^="column."]')]
    expect(columns).toHaveLength(16)
    expect(container.querySelector<HTMLInputElement>('[name="column.state"]')?.checked).toBe(false)
    expect(container.querySelector<HTMLInputElement>('[name="column.compose"]')?.checked).toBe(false)
    for (const input of columns.filter(input => input.checked)) {
      fireEvent.click(input)
    }
    const link = container.querySelector('[data-testid="dashboard-link"]')!
    expect(link.getAttribute('href')).toContain('panels=none')
    expect(link.getAttribute('href')).toContain('columns=none')
  })
  test('selected panels render independently without blank reserved areas', async () => {
    const {container} = await renderComponent('App', {path: '/demo?panels=containers'})
    await waitFor(() => expect(container.querySelector('section[aria-label="Containers"]')).not.toBeNull(), {timeout: 4000})
    expect(container.querySelector('section[aria-label="CPU"]')).toBeNull()
    expect(container.querySelector('section[aria-label="Processes"]')).toBeNull()
  })
  test('all date-format choices are available and persist in the permalink', async () => {
    const {container, getByLabelText} = await renderComponent('App', {path: '/setup?host=nas'})
    const select = getByLabelText('Date format') as HTMLSelectElement
    expect(select.options).toHaveLength(4)
    fireEvent.change(select, {target: {value: 'european'}})
    expect(container.querySelector('[data-testid="dashboard-link"]')?.getAttribute('href')).toContain('dateFormat=european')
  })
  test('square tags show all requested annotations but no sleeping state tag', async () => {
    const process = {
      isAgent: true,
      heavy: true,
      state: 'R',
      container: {
        name: 'web',
        image: 'test',
        composeProject: 'stack',
      },
    }
    const {container, rerender} = await renderComponent('ProcessTags', {props: {process}})
    expect(container.querySelectorAll('[data-tag]')).toHaveLength(4)
    const Component = (await import('#src/components/ProcessTags/index.tsx')).default
    rerender(createElement(Component, {process: {
      ...process,
      state: 'S',
    } as any}))
    expect(container.querySelector('[data-tag="state"]')).toBeNull()
  })
  test('renders historical orphan and detached ancestry tags distinctly', async () => {
    const Component = (await import('#src/components/ProcessTags/index.tsx')).default
    const {container, rerender} = render(createElement(Component, {process: {
      state: 'S',
      orphan: true,
      detached: false,
      formerParent: {
        name: 'launcher',
        pid: 42,
      },
    } as any}))
    expect(container.querySelector('[data-tag="orphan"]')?.getAttribute('aria-label')).toContain('observed parent')
    expect(container.querySelector('[data-tag="detached"]')).toBeNull()

    rerender(createElement(Component, {process: {
      state: 'S',
      orphan: false,
      detached: true,
    } as any}))
    expect(container.querySelector('[data-tag="orphan"]')).toBeNull()
    expect(container.querySelector('[data-tag="detached"]')?.getAttribute('aria-label')).toContain('no non-init parent')
  })
})
describe('visual value treatment', () => {
  test('meter peaks retain their earlier width and color beneath the live bars', async () => {
    const {container, rerender} = await renderComponent('Meter', {props: {segments: [{
      key: 'load',
      percent: 80,
      color: 'red',
    }]}})
    const Component = (await import('#src/components/Meter/index.tsx')).default
    rerender(createElement(Component, {segments: [{
      key: 'load',
      percent: 20,
      color: 'green',
    }]}))
    const peak = container.querySelector('i')!
    const live = container.querySelector('span')!
    expect(peak.dataset.peak).toBe('80')
    expect(peak.style.background).toBe('red')
    expect(peak.style.opacity).toBe('0.13')
    expect(live.style.getPropertyValue('--width')).toBe('20%')
  })
  test('command rendering creates text tokens, not injected HTML', async () => {
    const process = {
      argv: ['/nix/store/hash/bin/tool', '--name=<script>alert(1)</script>', '-pprivate'],
      isKernelThread: false,
      name: 'tool',
    }
    const {container} = await renderComponent('Command', {props: {
      process,
      mode: 'censored',
    }})
    expect(container.querySelector('[data-token="executable"]')?.textContent).toBe('tool')
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).not.toContain('private')
    expect(container.textContent).not.toContain('alert(1)')
  })
})

test('linger applies fractional peak duration and expires independently of polling', async () => {
  const {DashboardSettings} = await import('#src/lib/dashboardSettings.ts')
  const {default: PeakTrace} = await import('#component/PeakTrace')
  const view = (value: number, color: string) => createElement(DashboardSettings, {value: {interactive: true, linger: 0.03, sound: 'off'}}, createElement(PeakTrace, {value, color}))
  const {container, rerender} = render(view(80, 'red'))
  rerender(view(20, 'blue'))
  expect(container.querySelector('i')?.dataset.peak).toBe('80')
  expect(container.querySelector('i')?.style.background).toBe('red')
  await act(async () => {await Bun.sleep(60)})
  expect(container.querySelector('i')?.dataset.peak).toBe('20')
  expect(container.querySelector('i')?.style.background).toBe('blue')
})
