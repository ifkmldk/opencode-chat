import { placeDirectionsUrl, requestMapShow } from "./map-events"

// fork: Gemini-style place cards inside a reply. Classic DOM calls (appendChild, insertBefore) on purpose: the
// enterprise build loads Cloudflare Worker types, whose Element.append/after take HTMLRewriter content.
// The first `[Name](place:<id>)` of each place gets a card after its
// paragraph or list item: photo (or a category tile), name, stars, category and whether it is open now. The card
// has a fixed height, is plain DOM (the markdown pass owns this subtree), and a click focuses the place on the
// side panel's Map tab.

export type InlinePlace = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  address?: string
  category?: string
  rating?: number
  ratingCount?: number
  stars?: number
  priceLevel?: string
  openNow?: boolean
  hoursToday?: string
  photoUrl?: string
  photoCredit?: string
  googleMapsUrl?: string
}

export type ResolvePlace = (id: string) => InlinePlace | undefined

const ICONS: [RegExp, string][] = [
  [/hotel|hostel|guest|resort|motel|apartment/i, "🏨"],
  [/mall|shop|supermarket|market|store|department/i, "🛍️"],
  [/restaurant|food|fast|diner|eatery/i, "🍽️"],
  [/cafe|coffee/i, "☕"],
  [/cinema|theatre|theater/i, "🎬"],
  [/hospital|clinic|doctor|pharmacy/i, "🏥"],
  [/station|halt|bus|train|transport|terminal|airport/i, "🚉"],
  [/park|garden|water|zoo|attraction|museum|tourism/i, "🌳"],
  [/school|university|college/i, "🎓"],
  [/convention|exhibition|office|building/i, "🏢"],
  [/mosque|church|temple|worship/i, "🕌"],
]

export function placeIcon(category: string | undefined) {
  return ICONS.find(([pattern]) => category && pattern.test(category))?.[1] ?? "📍"
}

export function decoratePlaces(container: HTMLElement, resolve: ResolvePlace | undefined, labels: CardLabels) {
  const present = new Set<string>()
  if (resolve)
    for (const link of container.querySelectorAll<HTMLElement>("a[data-place-ref]")) {
      const id = link.dataset.placeRef
      if (!id || present.has(id)) continue
      const place = resolve(id)
      if (!place) continue
      present.add(id)
      // Inside a list item (a <div> between <li>s is invalid); after a paragraph or heading otherwise.
      const item = link.closest("li")
      const anchor = item ?? link.closest("p, h1, h2, h3, h4, blockquote") ?? link
      const existing = item ? item.lastElementChild : anchor.nextElementSibling
      if (existing instanceof HTMLElement && existing.dataset.placeCard === id) {
        if (existing.dataset.version !== version(place)) existing.parentNode?.replaceChild(card(place, labels), existing)
        continue
      }
      container.querySelector(`[data-place-card="${CSS.escape(id)}"]`)?.remove()
      if (item) item.appendChild(card(place, labels))
      else anchor.parentNode?.insertBefore(card(place, labels), anchor.nextSibling)
    }
  for (const stale of container.querySelectorAll<HTMLElement>("[data-place-card]"))
    if (!present.has(stale.dataset.placeCard ?? "")) stale.remove()
}

export type CardLabels = { open: string; closed: string; directions: string; stars: (count: number) => string }

function version(place: InlinePlace) {
  return [place.photoUrl, place.rating, place.openNow, place.hoursToday, place.category, place.stars].join("|")
}

function card(place: InlinePlace, labels: CardLabels) {
  const root = document.createElement("div")
  root.dataset.component = "place-inline-card"
  root.dataset.placeCard = place.id
  root.dataset.version = version(place)
  root.setAttribute("role", "button")
  root.tabIndex = 0
  root.contentEditable = "false"
  const focus = () =>
    requestMapShow({ placeId: place.id, name: place.name, latitude: place.latitude, longitude: place.longitude })
  root.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) return
    focus()
  })
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    focus()
  })

  const media = document.createElement("div")
  media.dataset.slot = "place-inline-media"
  if (place.photoUrl) {
    const image = document.createElement("img")
    image.src = place.photoUrl
    image.alt = ""
    image.loading = "lazy"
    image.referrerPolicy = "no-referrer"
    image.addEventListener("error", () => {
      image.remove()
      media.textContent = placeIcon(place.category)
    })
    media.appendChild(image)
    if (place.photoCredit) media.title = place.photoCredit
  } else media.textContent = placeIcon(place.category)

  const body = document.createElement("div")
  body.dataset.slot = "place-inline-body"
  const line = (slot: string, text: string | undefined) => {
    if (!text) return
    const element = document.createElement("span")
    element.dataset.slot = slot
    element.textContent = text
    body.appendChild(element)
    return element
  }
  line("place-inline-name", place.name)
  const score =
    place.rating !== undefined
      ? `${place.rating.toFixed(1)} ★${place.ratingCount ? ` (${place.ratingCount.toLocaleString()})` : ""}`
      : place.stars
        ? labels.stars(place.stars)
        : undefined
  line("place-inline-rating", [score, place.priceLevel].filter(Boolean).join(" · "))
  line("place-inline-category", place.category ? `${placeIcon(place.category)} ${place.category}` : undefined)
  const hours =
    place.openNow === undefined
      ? place.hoursToday
      : [place.openNow ? labels.open : labels.closed, place.hoursToday].filter(Boolean).join(" · ")
  const status = line("place-inline-hours", hours ?? place.address)
  if (status && place.openNow !== undefined && hours) status.dataset.open = String(place.openNow)

  const directions = document.createElement("a")
  directions.dataset.slot = "place-inline-directions"
  directions.href = placeDirectionsUrl(place)
  directions.target = "_blank"
  directions.rel = "noopener noreferrer"
  directions.textContent = labels.directions
  body.appendChild(directions)

  root.appendChild(media)
  root.appendChild(body)
  return root
}
