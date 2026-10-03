import type {Browser, BrowserContext, Page} from 'puppeteer-core'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'bun:test'

import {mkdir} from 'fs-extra'

import {createStaticServer, launchBrowser} from './lib/browser.ts'
import {FakeDocker} from './lib/FakeDocker.ts'

let browser: Browser
let context: BrowserContext
let page: Page
let site: ReturnType<typeof createStaticServer>
let endpoint: ReturnType<typeof Bun.serve>
let daemon: FakeDocker
let errors: Array<string>
const clickText = async (text: string) => {
  const found = await page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === text)
    button?.click()
    return Boolean(button)
  }, text)
  expect(found).toBe(true)
}
const go = async (path: string) => {
  // This is a polling dashboard; network quiet is not a readiness contract.
  // Complete navigation before the per-test deadline so failures do not kill the shared browser.
  await page.goto(new URL(path, site.url).href, {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  })
  await page.waitForSelector('main, form, [data-interactive]', {timeout: 10_000})
  await page.evaluate(() => document.fonts.ready)
}
const ready = () => page.waitForSelector('[aria-label="Filter processes"]', {timeout: 15_000})
beforeAll(async () => {
  site = createStaticServer()
  endpoint = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const origin = request.headers.get('origin')
    if (origin && origin !== site.url.origin) {
      return new Response(null, {status: 403})
    }
    const cors = {
      'access-control-allow-origin': site.url.origin,
      'access-control-allow-headers': 'Authorization, Content-Type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors,
      })
    }
    const response = await daemon.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' ? undefined : await request.text(),
    })
    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value)
    }
    return response
  }})
  browser = await launchBrowser()
  await mkdir('out/test/screenshots', {recursive: true})
}, 30_000)
afterAll(async () => {
  await browser?.close(); site?.stop(true); endpoint?.stop(true)
})
beforeEach(async () => {
  daemon = new FakeDocker
  errors = []
  context = await browser.createBrowserContext()
  page = await context.newPage()
  page.on('pageerror', error => errors.push(String(error)))
})
afterEach(async () => {
  await context?.close()
  expect(errors).toEqual([])
})
describe('production user flows', () => {
  test('root redirects home and direct routes reload correctly', async () => {
    await go('/')
    expect(new URL(page.url()).pathname).toBe('/home')
    expect(await page.$('a[href="/setup"]')).not.toBeNull()
    await go('/demo')
    await ready()
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    })
    await ready()
    expect(new URL(page.url()).pathname).toBe('/demo')
  }, 30_000)
  test('incoming and saved bearer values never enter generated share links', async () => {
    await go(`/setup?host=127.0.0.1&port=${endpoint.port}&bearer=old-secret`)
    expect(await page.$eval('[data-testid="dashboard-link"]', element => element.getAttribute('href'))).not.toContain('old-secret')
    await page.type('input[name="bearer"]', 'new-synthetic-token')
    await clickText('Save')
    await page.waitForFunction(() => !location.search.includes('bearer='))
    expect(await page.$eval('[data-testid="dashboard-link"]', element => element.textContent)).not.toContain('new-synthetic-token')
    await clickText('Open dashboard')
    await ready()
    expect(daemon.requests.filter(request => request.headers.get('authorization') === 'Bearer new-synthetic-token').length).toBeGreaterThan(0)
    expect(new URL(page.url()).searchParams.has('bearer')).toBe(false)
  }, 30_000)
  test('live dashboard reaches Docker through real browser fetch and CORS', async () => {
    await go(`/?host=127.0.0.1&port=${endpoint.port}&argv=hidden`)
    await ready()
    expect(await page.evaluate(() => document.body.textContent)).toContain('fixture-host')
    expect(daemon.created).toBe(1)
    expect([...daemon.executions.values()].some(exec => exec.request.argv === 'hidden')).toBe(true)
    expect(await page.$eval('[role="table"]', element => element.textContent)).not.toContain('Command')
  }, 30_000)
  test('demo is independent of the Docker endpoint and supports filtering and pause', async () => {
    await go(`/demo?host=127.0.0.1&port=${endpoint.port}`)
    await ready()
    await page.type('[aria-label="Filter processes"]', 'name:nginx')
    await page.waitForFunction(() => [...document.querySelectorAll('[role="row"][aria-selected]')].every(element => element.textContent?.includes('nginx')))
    expect(await page.$$('[role="row"][aria-selected]')).not.toHaveLength(0)
    await page.$eval('[aria-label="Filter processes"]', element => (element as HTMLInputElement).blur())
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.body.textContent?.includes('paused'))
    expect(daemon.requests).toHaveLength(0)
  }, 30_000)
  test('process controls require explicit enablement and two clicks', async () => {
    await go('/demo?destructive=true&filter=name:nginx')
    await ready()
    await page.click('[role="row"][aria-selected]')
    await page.waitForSelector('aside[aria-label^="Details of process"]')
    await clickText('Terminate')
    expect(await page.evaluate(() => document.body.textContent)).toContain('Confirm terminate')
    await clickText('Confirm terminate')
    await page.waitForFunction(() => document.body.textContent?.includes('Sent SIGTERM'))
    expect(daemon.requests).toHaveLength(0)
  }, 30_000)
  test('read-only details do not expose destructive buttons', async () => {
    await go('/demo?filter=name:nginx')
    await ready()
    await page.click('[role="row"][aria-selected]')
    expect(await page.evaluate(() => [...document.querySelectorAll('aside button')].some(element => element.textContent?.trim() === 'Terminate'))).toBe(false)
  }, 30_000)
})
describe('overhaul interactions', () => {
  test('F focuses the filter and the help lists the same shortcut', async () => {
    await go('/demo?interval=250')
    await ready()
    await page.keyboard.press('f')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Filter processes')
    await page.keyboard.type('nginx')
    expect(await page.$eval('[aria-label="Filter processes"]', element => (element as HTMLInputElement).value)).toBe('nginx')
    await page.$eval('[aria-label="Filter processes"]', element => (element as HTMLElement).blur())
    await page.click('[aria-label="Keyboard shortcuts"]')
    expect(await page.$eval('dialog', element => [...element.querySelectorAll('kbd')].map(key => key.textContent))).toContain('F')
  }, 30_000)
  test('panel and column settings survive navigation and reload', async () => {
    await go('/setup?panels=cpu,containers,processes&columns=pid,tags,name,cpu,compose')
    await page.click('[name="panel.cpu"]')
    await page.click('[name="column.container"]')
    await page.select('[name="dateFormat"]', 'european')
    await page.evaluate(() => [...document.querySelectorAll('a')].find(link => link.textContent?.includes('Try the demo'))?.click())
    await ready()
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    })
    await ready()
    expect(await page.$('section[aria-label="CPU"]')).toBeNull()
    expect(await page.$('section[aria-label="Containers"]')).not.toBeNull()
    const headers = await page.$$eval('[role="columnheader"]', nodes => nodes.map(node => node.textContent))
    expect(headers).toContain('Compose')
    expect(headers).toContain('Container')
    expect(headers).not.toContain('User')
    expect(new URL(page.url()).searchParams.get('dateFormat')).toBe('european')
  }, 30_000)
  test('multiline command arguments stay inside one fixed-height process row', async () => {
    await go('/demo?panels=processes&columns=pid,age,command')
    await ready()
    const geometry = await page.$eval('[data-process-key]', row => {
      const command = row.querySelector('[data-token]')
      if (!command) {
        throw new Error('Expected a command token')
      }
      command.textContent = 'line one\nline two\nline three'
      const commandBox = command.parentElement!.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      const next = row.nextElementSibling?.getBoundingClientRect()
      return {
        commandHeight: commandBox.height,
        rowHeight: rowBox.height,
        rowBottom: rowBox.bottom,
        nextTop: next?.top,
        whiteSpace: getComputedStyle(command.parentElement!).whiteSpace,
      }
    })
    expect(geometry.whiteSpace).toBe('nowrap')
    expect(geometry.commandHeight).toBeLessThanOrEqual(geometry.rowHeight)
    if (geometry.nextTop !== undefined) {
      expect(geometry.nextTop).toBeGreaterThanOrEqual(geometry.rowBottom)
    }
  }, 30_000)
  test('hovered table keeps exact row slots while CPU values continue changing', async () => {
    await go('/demo?interval=250&columns=pid,tags,name,cpu,memory&panels=processes')
    await ready()
    await page.hover('[data-process-key]')
    await page.waitForSelector('[data-order-held="true"]')
    const before = await page.$$eval('[data-process-key]', nodes => nodes.map(node => ({
      key: node.getAttribute('data-process-key'),
      cpu: node.getAttribute('data-cpu'),
    })))
    await Bun.sleep(1200)
    const after = await page.$$eval('[data-process-key]', nodes => nodes.map(node => ({
      key: node.getAttribute('data-process-key'),
      cpu: node.getAttribute('data-cpu'),
    })))
    expect(after.map(row => row.key)).toEqual(before.map(row => row.key))
    expect(after.some((row, index) => row.cpu !== before[index].cpu)).toBe(true)
    await page.mouse.move(0, 0)
    await page.waitForFunction(() => !document.querySelector('[data-order-held="true"]'))
  }, 30_000)
  test('hovered graphs hold pixels and timestamps while samples keep arriving', async () => {
    await go('/demo?interval=250')
    await ready()
    await page.hover('canvas')
    await page.waitForSelector('canvas[data-frozen="true"]')
    const before = await page.$eval('canvas', canvas => ({
      time: canvas.dataset.plotTime,
      image: canvas.toDataURL(),
    }))
    const valuesBefore = await page.$$eval('[data-process-key]', nodes => nodes.map(node => node.getAttribute('data-cpu')))
    await Bun.sleep(1200)
    const after = await page.$eval('canvas', canvas => ({
      time: canvas.dataset.plotTime,
      image: canvas.toDataURL(),
    }))
    expect(after).toEqual(before)
    const valuesAfter = await page.$$eval('[data-process-key]', nodes => nodes.map(node => node.getAttribute('data-cpu')))
    expect(valuesAfter).not.toEqual(valuesBefore)
    await page.mouse.move(0, 0)
    await page.waitForFunction(time => document.querySelector('canvas')?.dataset.plotTime !== time, {}, before.time)
  }, 30_000)
  test('hovered sparklines hold their path and resume on pointer leave', async () => {
    await go('/demo?panels=containers,processes&interval=250')
    await ready()
    const selector = '[aria-label="Container list"] svg[viewBox="0 0 200 40"]'
    await page.waitForSelector(selector, {timeout: 15_000})
    await page.hover(selector)
    await page.waitForSelector(`${selector}[data-frozen="true"]`)
    const before = await page.$eval(selector, node => [...node.querySelectorAll('path')].map(path => path.getAttribute('d')))
    await Bun.sleep(1000)
    expect(await page.$eval(selector, node => [...node.querySelectorAll('path')].map(path => path.getAttribute('d')))).toEqual(before)
    await page.mouse.move(0, 0)
    await page.waitForFunction(selector => !document.querySelector(selector)?.hasAttribute('data-frozen'), {}, selector)
    expect(await page.$eval(selector, node => [...node.querySelectorAll('path')].map(path => path.getAttribute('d')))).not.toEqual(before)
  }, 30_000)
  test('container panel scrolls internally and selected columns scroll inside a narrow table', async () => {
    await page.setViewport({
      width: 360,
      height: 800,
    })
    await go('/demo?panels=containers,processes&columns=pid,tags,name,user,cpu,memory,io,threads,state,age,command,container,compose')
    await ready()
    const geometry = await page.$eval('[aria-label="Container list"]', element => ({
      scroll: element.scrollHeight,
      height: element.clientHeight,
      overflow: getComputedStyle(element).overflowY,
    }))
    expect(geometry.scroll).toBeGreaterThan(geometry.height)
    expect(geometry.overflow).toBe('auto')
    const columns = await page.$$eval('[role="columnheader"]', nodes => nodes.length)
    expect(columns).toBe(13)
    const table = await page.$eval('[aria-label="Process list"]', element => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    expect(table.scroll).toBeGreaterThan(table.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(361)
    await page.$eval('[aria-label="Process list"]', element => {
      element.scrollLeft = 400
    })
    await page.waitForFunction(() => (document.querySelector('[role="columnheader"]')?.parentElement?.style.transform ?? '').includes('-400'))
  }, 30_000)
  test('an explicit empty panel selection renders a setup recovery link', async () => {
    await go('/demo?panels=none')
    await page.waitForFunction(() => document.body.textContent?.includes('No panels selected'))
    expect(await page.$$('main section')).toHaveLength(0)
    expect(await page.evaluate(() => [...document.querySelectorAll('a')].some(link => link.textContent?.includes('Choose panels in setup')))).toBe(true)
  }, 30_000)
})
describe('view-only and session controls', () => {
  test('home offers setup and demo without contacting Docker', async () => {
    await go('/?port=70000')
    expect(new URL(page.url()).pathname).toBe('/home')
    expect(await page.$('nav[aria-label="Get started"] a[href^="/setup"]')).not.toBeNull()
    expect(await page.$('nav[aria-label="Get started"] a[href^="/demo"]')).not.toBeNull()
    expect(daemon.requests).toHaveLength(0)
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    })
    expect(new URL(page.url()).pathname).toBe('/home')
  }, 30_000)
  test('dashboard changes never rewrite its URL and refresh restores initial input', async () => {
    const query = '/demo?interval=250&panels=processes&columns=name,cpu,memory,weight,read,write&sort=cpu&filter_button=Heavy:tag:heavy&filter_button=Orphan:tag:orphan'
    await go(query)
    await ready()
    const href = page.url()
    await page.evaluate(() => {
      const count = {writes: 0}
      Object.assign(globalThis, {historyWrites: count})
      for (const key of ['pushState', 'replaceState'] as const) {
        const original = history[key].bind(history)
        history[key] = (...args) => {
          count.writes++; return original(...args)
        }
      }
    })
    await clickText('Memory')
    await clickText('Heavy')
    await page.type('[aria-label="Filter processes"]', ' name:')
    await page.$eval('[aria-label="Filter processes"]', element => (element as HTMLElement).blur())
    await page.keyboard.press('t')
    await page.click('[aria-label="Pause"]')
    await page.click('[aria-label="Sounds: off"]')
    expect(page.url()).toBe(href)
    expect(await page.evaluate(() => (globalThis as any).historyWrites.writes)).toBe(0)
    expect(await page.$eval('[aria-label="Setup"]', element => element.getAttribute('href'))).not.toContain('sort=memory')
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    })
    await ready()
    expect(await page.$eval('[aria-label="Filter processes"]', element => (element as HTMLInputElement).value)).toBe('')
    expect(await page.$('button[aria-label="Sounds: off"]')).not.toBeNull()
    expect(await page.$('button[aria-label="Pause"]')).not.toBeNull()
    expect(await page.$eval('[aria-sort="descending"]', element => element.textContent)).toContain('CPU')
  }, 30_000)
  test('view-only retains information, keeps sampling and attaches no pointer or keyboard actions', async () => {
    await go('/demo?interactive=false&destructive=true&sound=all&interval=250&columns=name,cpu,memory&filter_button=Heavy:tag:heavy')
    await page.waitForSelector('[data-process-key]')
    expect(await page.$$('button, a[href], input, select, textarea')).toHaveLength(0)
    const before = await page.$$eval('[data-process-key]', nodes => nodes.map(node => node.getAttribute('data-cpu')))
    await page.hover('canvas')
    for (const key of ['f', 'Space', 't', 'k', '?', 'ArrowDown'] as const) {
      await page.keyboard.press(key)
    }
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-process-key]')?.click())
    await Bun.sleep(700)
    expect(await page.$$('aside[aria-label^="Details"], [data-frozen="true"], [data-order-held="true"], [role="tooltip"]')).toHaveLength(0)
    expect(await page.$$eval('[data-process-key]', nodes => nodes.map(node => node.getAttribute('data-cpu')))).not.toEqual(before)
    const activeHandlers = await page.evaluate(() => [...document.querySelectorAll('[data-interactive] *')].flatMap(element => {
      const key = Object.keys(element).find(key => key.startsWith('__reactProps'))
      const props = key ? (element as any)[key] : {}
      return Object.entries(props).filter(([name, value]) => /^on(?:Click|Key|Mouse|Pointer|Touch|Wheel)/.test(name) && typeof value === 'function').map(([name]) => name)
    }))
    expect(activeHandlers).toEqual([])
  }, 30_000)
  test('all graphs freeze together with one shared timestamp and individual tooltips', async () => {
    await go('/demo?interval=250')
    await ready()
    await page.hover('canvas')
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.frozen === 'true'))
    const before = await page.$$eval('canvas', nodes => nodes.map(canvas => ({
      time: canvas.dataset.plotTime,
      hover: canvas.dataset.hoverTime,
      pixels: canvas.toDataURL(),
    })))
    expect(new Set(before.map(graph => graph.hover)).size).toBe(1)
    expect(await page.$$('[data-graph-tooltip]')).toHaveLength(await page.$$eval('canvas, svg[data-frozen="true"]', nodes => nodes.length))
    await Bun.sleep(700)
    const after = await page.$$eval('canvas', nodes => nodes.map(canvas => ({
      time: canvas.dataset.plotTime,
      hover: canvas.dataset.hoverTime,
      pixels: canvas.toDataURL(),
    })))
    expect(after).toEqual(before)
    const rect = await page.$eval('canvas', canvas => {
      const r = canvas.getBoundingClientRect();return {
        x: r.x + 10,
        y: r.y + 10,
      }
    })
    await page.mouse.move(rect.x, rect.y)
    await page.waitForFunction(previous => document.querySelector('canvas')?.dataset.hoverTime !== previous, {}, before[0].hover)
    const times = await page.$$eval('[data-graph-tooltip]', nodes => nodes.map(node => node.getAttribute('data-hover-time')))
    expect(new Set(times).size).toBe(1)
    await page.mouse.move(0, 0)
    await page.waitForFunction(() => document.querySelectorAll('[data-graph-tooltip]').length === 0)
  }, 30_000)
  test('live container sparklines leave collecting state after subsequent samples', async () => {
    await go(`/?host=127.0.0.1&port=${endpoint.port}&interval=250&panels=containers,processes`)
    await ready()
    await page.waitForFunction(() => {
      const list = document.querySelector('[aria-label="Container list"]')
      return list && !list.textContent?.includes('collecting') && list.querySelectorAll('svg[viewBox="0 0 200 40"]').length > 0
    }, {timeout: 10_000})
    const before = await page.$eval('[aria-label="Container list"] svg[viewBox="0 0 200 40"]', node => node.querySelector('path')?.getAttribute('d'))
    await page.waitForFunction(before => document.querySelector('[aria-label="Container list"] svg[viewBox="0 0 200 40"] path')?.getAttribute('d') !== before, {}, before)
  }, 30_000)
  test('repeated custom buttons replace defaults and explicit tag queries show hidden classes', async () => {
    await go('/demo?interval=250&panels=processes&filter_button=Heavy:tag:heavy&filter_button=Orphan:tag:orphan')
    await ready()
    expect(await page.$$eval('button', nodes => nodes.some(node => node.textContent?.trim() === 'Kernel'))).toBe(false)
    await clickText('Heavy')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-process-key]')].every(row => row.getAttribute('data-tags')?.includes('heavy')))
    expect(await page.$$('[data-process-key]')).not.toHaveLength(0)
    await clickText('Heavy')
    await page.type('[aria-label="Filter processes"]', 'tag:kernel')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-process-key]')].every(row => row.getAttribute('data-tags')?.includes('kernel')))
    expect(await page.$$('[data-process-key]')).not.toHaveLength(0)
  }, 30_000)
  test('new setup settings and repeated filter buttons serialize into generated links', async () => {
    await go('/setup?host=example.com')
    await page.$eval('[name="linger"]', element => {
      const input = element as HTMLInputElement;input.select()
    })
    await page.type('[name="linger"]', '0.25')
    await page.select('[name="sound"]', 'alerts')
    await page.click('[name="interactive"]')
    await page.$eval('[name="filter_button"]', element => (element as HTMLTextAreaElement).select())
    await page.type('[name="filter_button"]', 'Heavy:tag:heavy\nOrphan:tag:orphan')
    const href = await page.$eval('[data-testid="dashboard-link"]', element => element.getAttribute('href'))
    const query = new URL(href!).searchParams
    expect(query.get('linger')).toBe('0.25')
    expect(query.get('sound')).toBe('alerts')
    expect(query.get('interactive')).toBe('false')
    expect(query.getAll('filter_button')).toEqual(['Heavy:tag:heavy', 'Orphan:tag:orphan'])
  }, 30_000)
  test('zero linger disables every peak trace without removing live bars', async () => {
    await go('/demo?linger=0&interval=250')
    await ready()
    await page.waitForFunction(() => {
      const traces = document.querySelectorAll('[data-linger]')
      return traces.length > 10 && [...traces].every(node => node.getAttribute('data-linger') === '0' && getComputedStyle(node).opacity === '0')
    }, {timeout: 5000})
    const traces = await page.$$eval('[data-linger]', nodes => nodes.map(node => ({
      linger: node.getAttribute('data-linger'),
      opacity: getComputedStyle(node).opacity,
    })))
    expect(traces.length).toBeGreaterThan(10)
    expect(traces.every(trace => trace.linger === '0' && trace.opacity === '0')).toBe(true)
  }, 30_000)
})
describe.each(['/home', '/setup', '/demo'])('%s screenshots', route => {
  describe.each([{
    name: 'desktop',
    width: 1920,
    height: 960,
  }, {
    name: 'tile',
    width: 432,
    height: 600,
  }, {
    name: 'mobile',
    width: 360,
    height: 800,
  }])('$name', layout => {
    test.each(['dark', 'light'] as const)('%s', async theme => {
      await page.setViewport({
        width: layout.width,
        height: layout.height,
        deviceScaleFactor: 1,
      })
      await page.emulateMediaFeatures([{
        name: 'prefers-color-scheme',
        value: theme,
      }, {
        name: 'prefers-reduced-motion',
        value: 'reduce',
      }])
      await go(route)
      if (route === '/demo') {
        await ready()
      }
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        background: getComputedStyle(document.documentElement).backgroundColor,
      }))
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1)
      expect(geometry.background).toBe(theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)')
      if (route === '/demo') {
        const painted = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(canvas => {
          const bytes = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
          return bytes?.some((value, index) => index % 4 === 3 && value > 0)
        }).length)
        expect(painted).toBeGreaterThan(0)
      }
      await page.screenshot({
        path: `out/test/screenshots/${route.slice(1)}-${layout.name}-${theme}.png`,
        fullPage: true,
      })
    }, 30_000)
  })
})
