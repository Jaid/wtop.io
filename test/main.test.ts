import {expect, test} from 'bun:test'

const {default: wtopIo} = await import('#src/main.ts')

test('should run', () => {
  const result = wtopIo()
  expect(result).toBe('wtop.io') // TODO Test actual functionality
})
