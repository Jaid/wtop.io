export type TargetAddressSpace = 'local' | 'loopback'

const isIpv4 = (host: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
const ipv4Octets = (host: string) => host.split('.').map(Number)

/**
 * Guesses the Local Network Access address space of a host so that `fetch()` can declare it upfront via `targetAddressSpace`.
 *
 * Chromium lets pages served over HTTPS request plain HTTP resources on private networks only if the request declares the address space and the user granted the permission. Returns `undefined` for public or unknown hosts, where declaring a wrong space would make the request fail.
 */
export const guessTargetAddressSpace = (host: string): TargetAddressSpace | undefined => {
  const normalized = host.trim().toLowerCase().replaceAll(/^\[|\]$/g, '')
  if (!normalized) {
    return undefined
  }
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1') {
    return 'loopback'
  }
  if (isIpv4(normalized)) {
    const [a, b] = ipv4Octets(normalized)
    if (a === 127) {
      return 'loopback'
    }
    if (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127) {
      return 'local'
    }
    return undefined
  }
  if (normalized.includes(':')) {
    // unique local (fc00::/7) and link-local (fe80::/10) IPv6
    if (/^f[cd][\da-f]{2}:/.test(normalized) || /^fe[89ab][\da-f]:/.test(normalized)) {
      return 'local'
    }
    return undefined
  }
  if (!normalized.includes('.') || /\.(?:home|internal|intranet|lan|local|home\.arpa)$/.test(normalized)) {
    return 'local'
  }
  return undefined
}

/**
 * The declaration is only needed (and only worth the risk of a mismatch) when a secure page talks to an insecure private endpoint.
 */
export const shouldDeclareAddressSpace = (targetProtocol: string, pageProtocol = globalThis.location?.protocol) => pageProtocol === 'https:' && targetProtocol === 'http'

export const resolveTargetAddressSpace = (settings: {
  addressSpace: 'auto' | 'local' | 'loopback' | 'public'
  host?: string
  protocol: string
}) => {
  if (!shouldDeclareAddressSpace(settings.protocol) || settings.addressSpace === 'public') {
    return
  }
  return settings.addressSpace === 'auto' ? guessTargetAddressSpace(settings.host ?? '') : settings.addressSpace
}
