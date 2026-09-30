import {existsSync, statSync} from 'node:fs'
import {resolve, sep} from 'node:path'

import puppeteer from 'puppeteer-core'

export const createStaticServer = (folder = 'dist') => {
  const root = resolve(folder)
  if (!existsSync(resolve(root, 'index.html'))) {
    throw new Error('Build the app before running browser tests.')
  }
  return Bun.serve({hostname: '127.0.0.1', port: 0, fetch(request) {
    let path: string
    try {
      path = resolve(root, `.${decodeURIComponent(new URL(request.url).pathname)}`)
    } catch {
      return new Response(null, {status: 400})
    }
    if (path !== root && !path.startsWith(root + sep)) {
      return new Response(null, {status: 403})
    }
    const asset = existsSync(path) && statSync(path).isFile() ? path : resolve(root, 'index.html')
    return new Response(Bun.file(asset), {headers: {
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    }})
  }})
}
export const launchBrowser = () => {
  const candidates = [Bun.env.BROWSER_PATH, Bun.which('chrome'), Bun.which('chromium'), Bun.which('chromium-browser'), Bun.which('brave'), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', '/usr/bin/google-chrome']
  const executablePath = candidates.find((path): path is string => Boolean(path && existsSync(path)))
  if (!executablePath) {
    throw new Error('Set BROWSER_PATH to a Chromium-compatible browser executable.')
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: {
      width: 1920,
      height: 960,
    },
  })
}
