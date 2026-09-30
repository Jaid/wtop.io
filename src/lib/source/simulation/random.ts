/**
 * Small seeded PRNG (mulberry32) so the demo is reproducible in tests while still looking organic.
 */
export class Random {
  state: number
  constructor(seed = 0x5E_ED) {
    this.state = seed >>> 0
  }
  chance(probability: number) {
    return this.next() < probability
  }
  /** standard normal distribution via Box–Muller */
  gauss() {
    const u = Math.max(this.next(), Number.EPSILON)
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  hex(length: number) {
    let result = ''
    for (let index = 0; index < length; index++) {
      result += Math.floor(this.next() * 16).toString(16)
    }
    return result
  }
  int(min: number, max: number) {
    return Math.floor(this.range(min, max + 1))
  }
  next() {
    this.state = this.state + 0x6D_2B_79_F5 >>> 0
    let t = this.state
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
  }
  pick<T>(items: ReadonlyArray<T>): T {
    return items[Math.floor(this.next() * items.length)]
  }
  range(min: number, max: number) {
    return min + (max - min) * this.next()
  }
}
