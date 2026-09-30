export type DemuxedStreams = {
  stderr: Uint8Array
  stdout: Uint8Array
}
const maxCompressedBytes = 16 * 1024 * 1024
const maxExpandedBytes = 64 * 1024 * 1024
const concat = (chunks: Array<Uint8Array>) => {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
export const readResponse = async (response: Response, limit = maxCompressedBytes): Promise<Uint8Array> => {
  const reader = response.body?.getReader()
  if (!reader) {
    return new Uint8Array
  }
  const chunks: Array<Uint8Array> = []
  let length = 0
  try {
    for (;;) {
      const {value, done} = await reader.read()
      if (done) {
        break
      }
      length += value.length
      if (length > limit) {
        throw new Error('The Docker response exceeded its size limit.')
      }
      chunks.push(value)
    }
    return concat(chunks)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
/** Tty is always false. Reject malformed frames rather than displaying partial data. */
export const demuxDockerStream = (bytes: Uint8Array): DemuxedStreams => {
  const stdout: Array<Uint8Array> = []
  const stderr: Array<Uint8Array> = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 8 || ![1, 2].includes(bytes[offset]) || bytes[offset + 1] || bytes[offset + 2] || bytes[offset + 3]) {
      throw new Error('The Docker exec response has an invalid frame header.')
    }
    const stream = bytes[offset]
    const length = view.getUint32(offset + 4)
    offset += 8
    if (length > bytes.length - offset) {
      throw new Error('The Docker exec response ended inside a frame.')
    }
    ;(stream === 1 ? stdout : stderr).push(bytes.subarray(offset, offset + length))
    offset += length
  }
  return {
    stdout: concat(stdout),
    stderr: concat(stderr),
  }
}
export const gunzip = async (bytes: Uint8Array) => {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))
  return readResponse(new Response(stream), maxExpandedBytes)
}
