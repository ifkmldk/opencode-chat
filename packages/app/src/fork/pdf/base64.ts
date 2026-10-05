// fork: bytes <-> base64 for the Office preview round trip. Chunked so large files do not overflow the call stack.
const CHUNK = 0x8000

export function toBase64(bytes: Uint8Array) {
  const parts: string[] = []
  for (let index = 0; index < bytes.length; index += CHUNK)
    parts.push(String.fromCharCode(...bytes.subarray(index, index + CHUNK)))
  return btoa(parts.join(""))
}

export function fromBase64(text: string) {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
