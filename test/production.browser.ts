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
