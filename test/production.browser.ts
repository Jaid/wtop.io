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
  await page.goto(new URL(path, site.url).href, {waitUntil: 'networkidle2'})
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
  test('root redirects to setup and direct routes reload correctly', async () => {
    await go('/')
    expect(new URL(page.url()).pathname).toBe('/setup')
    expect(await page.$('input[name="host"]')).not.toBeNull()
    await go('/demo')
    await ready()
    await page.reload({waitUntil: 'networkidle2'})
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
    await page.reload({waitUntil: 'networkidle2'})
    await ready()
    expect(await page.$('section[aria-label="CPU"]')).toBeNull()
    expect(await page.$('section[aria-label="Containers"]')).not.toBeNull()
    const headers = await page.$$eval('[role="columnheader"]', nodes => nodes.map(node => node.textContent))
    expect(headers).toContain('Compose')
    expect(headers).toContain('Container')
    expect(headers).not.toContain('User')
    expect(new URL(page.url()).searchParams.get('dateFormat')).toBe('european')
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
describe.each(['/setup', '/demo'])('%s screenshots', route => {
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
