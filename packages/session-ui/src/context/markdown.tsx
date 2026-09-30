import { createContext, useContext, type ParentProps } from "solid-js"
import type { ResolvePlace } from "../fork/places/inline-cards"

export type ReadMarkdownImage = (path: string, signal: AbortSignal) => Promise<Blob | undefined>
/** Open a local file path linked from markdown. The path is decoded and may be relative or absolute. */
export type OpenMarkdownLocalFile = (path: string) => void
/** fork: place data for `[Name](place:<id>)` links, so replies can show place cards. */
export type ResolveMarkdownPlace = ResolvePlace

const context = createContext<{
  readonly readImage?: ReadMarkdownImage
  readonly openLocalFile?: OpenMarkdownLocalFile
  readonly resolvePlace?: ResolveMarkdownPlace
}>()

export function MarkdownProvider(
  props: ParentProps<{
    readImage?: ReadMarkdownImage
    openLocalFile?: OpenMarkdownLocalFile
    resolvePlace?: ResolveMarkdownPlace
  }>,
) {
  return (
    <context.Provider
      value={{
        get readImage() {
          return props.readImage
        },
        get openLocalFile() {
          return props.openLocalFile
        },
        get resolvePlace() {
          return props.resolvePlace
        },
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useMarkdown = () => useContext(context)
