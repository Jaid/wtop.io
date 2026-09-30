import {GlobalRegistrator} from '@happy-dom/global-registrator'

const native = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
  fetch,
  Request,
  Response,
  Headers,
}
GlobalRegistrator.register({url: 'http://localhost/'})
Object.assign(globalThis, native)
