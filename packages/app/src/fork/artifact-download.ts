import { getDirectory, getFilename } from "@opencode/util/path"
import type { OpenCodeClient } from "@opencode/client/promise"
import { artifactMime } from "@/workspaces/files/artifact"

type FileApi = Pick<OpenCodeClient, "file">

// fork: generated-file cards read the file itself. The preview cache keeps no bytes for unknown binaries
// (zip, doc, xls, ...) or media over 25 MB and re-encodes text as UTF-8, so downloads through it came out
// empty or altered.
const absolute = (path: string) => /^[a-z]:\//i.test(path) || path.startsWith("/")

// Files outside the workspace are read from their own folder, like markdown images and previews.
const request = (directory: string, path: string) =>
  absolute(path)
    ? { path: getFilename(path), location: { directory: getDirectory(path) } }
    : { path, location: { directory } }

export async function readArtifact(api: FileApi, directory: string, path: string) {
  const bytes = await api.file.read(request(directory, path))
  return new Blob([new Uint8Array(bytes)], { type: artifactMime(path) ?? "application/octet-stream" })
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The subset of `paths` that exist. Each parent folder is listed once; a folder that fails to list has none. */
export async function artifactsExist(api: FileApi, directory: string, paths: string[]) {
  const root = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  const full = (path: string) => (absolute(path) ? path : `${root}/${path}`)
  const folders = paths.reduce((result, path) => {
    const folder = getDirectory(full(path))
    result.set(folder, [...(result.get(folder) ?? []), path])
    return result
  }, new Map<string, string[]>())
  const found = await Promise.all(
    [...folders].map(async ([folder, members]) => {
      const names = await api.file
        .list({ path: ".", location: { directory: folder } })
        .then(
          (result) =>
            new Set(
              result.data.filter((entry) => entry.type === "file").map((entry) => getFilename(entry.path).toLowerCase()),
            ),
        )
        .catch(() => new Set<string>())
      return members.filter((path) => names.has(getFilename(path).toLowerCase()))
    }),
  )
  return new Set(found.flat())
}
