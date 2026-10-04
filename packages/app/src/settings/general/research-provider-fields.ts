export type ResearchProviderField = { env: string; label: string; hint: string }

export const RESEARCH_PROVIDER_FIELDS: ResearchProviderField[] = [
  { env: "OPENCODE_JOBS_API_URL", label: "Jobs", hint: "research job — bila kosong: fallback web ber-lokasi + koridor transit (research_deep), bukan listing live" },
  { env: "OPENCODE_HOTEL_API_URL", label: "Hotels", hint: "research hotel — bila kosong: OSM + scrape berattribusi (tanpa harga tanggal-spesifik live)" },
  { env: "OPENCODE_FLIGHT_API_URL", label: "Flights", hint: "research flight" },
  { env: "OPENCODE_PRODUCT_API_URL", label: "Products", hint: "research product" },
  { env: "OPENCODE_YOUTUBE_API_URL", label: "YouTube", hint: "research youtube" },
  { env: "OPENCODE_PLACE_API_URL", label: "Places", hint: "research place — bila kosong: maps_search OSM + anchor/radius + scrape-verify must[]" },
  { env: "OPENCODE_EVENT_API_URL", label: "Events", hint: "research event" },
  { env: "OPENCODE_COURSE_API_URL", label: "Courses", hint: "research course" },
  { env: "OPENCODE_SERVICE_API_URL", label: "Services", hint: "research service" },
]

export const ALL_RESEARCH_ENVS = [...RESEARCH_PROVIDER_FIELDS.map((field) => field.env), "OPENCODE_ACTION_WEBHOOK"]

export function validateResearchProviderUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" && url.protocol !== "http:") return "settings.general.row.researchProviders.invalidScheme"
    if (url.username || url.password) return "settings.general.row.researchProviders.noCredentials"
    return undefined
  } catch {
    return "settings.general.row.researchProviders.invalidUrl"
  }
}

export function researchExportBlock(drafts: Record<string, string>) {
  return ALL_RESEARCH_ENVS.map((env) => {
    const value = (drafts[env] ?? "").trim()
    return value ? `export ${env}="${value.replaceAll('"', '\\"')}"` : `# ${env} is not set`
  }).join("\n")
}
