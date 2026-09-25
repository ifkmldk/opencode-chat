import { createSignal } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useComposerState } from "@/composer/persistence"

const categories = [
  ["job", "Jobs", "briefcase"],
  ["hotel", "Hotels", "building"],
  ["flight", "Flights", "airplane"],
  ["product", "Products", "box"],
  ["youtube", "YouTube", "globe"],
  ["place", "Places", "map-pin"],
  ["event", "Events", "calendar"],
  ["course", "Courses", "book-open"],
  ["service", "Services", "wrench"],
] as const

export function SessionResearchPanel() {
  const composer = useComposerState()
  const [query, setQuery] = createSignal("")
  const [category, setCategory] = createSignal<(typeof categories)[number][0]>("job")
  const [location, setLocation] = createSignal("")

  const ask = () => {
    const value = query().trim()
    if (!value) return
    const text = [
      `Use the research tools in Laya Classifier mode to find the best ${category()} options for: ${value}.`,
      location().trim() ? `Location: ${location().trim()}.` : undefined,
      "Compare price, quality, rating, availability, and tradeoffs. Return an explainable shortlist with sources. Do not book, buy, apply, or submit anything without explicit approval.",
    ].filter(Boolean).join(" ")
    composer.set([{ type: "text", content: text, start: 0, end: text.length }])
  }

  return (
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4" data-slot="session-research-panel">
      <div class="flex items-start gap-3">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-accent"><Icon name="sparkles" class="size-4" /></div>
        <div class="min-w-0">
          <div class="text-13-medium text-text-strong">Research workspace</div>
          <div class="mt-1 text-11-regular text-text-weak">Find candidates, compare them, and shortlist the best option.</div>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <label class="text-11-medium text-text-weak" for="research-query">What should we find?</label>
        <input id="research-query" data-action="research-query" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Cheapest hotel in Bali…" class="h-9 rounded-md border border-border-weaker-base bg-background-base px-3 text-12-regular text-text-strong outline-none focus:border-border-focus" />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1 text-11-medium text-text-weak">Category<select data-action="research-category" value={category()} onChange={(event) => setCategory(event.currentTarget.value as (typeof categories)[number][0])} class="h-9 rounded-md border border-border-weaker-base bg-background-base px-2 text-12-regular text-text-strong">{categories.map(([value, label]) => <option value={value}>{label}</option>)}</select></label>
        <label class="flex flex-col gap-1 text-11-medium text-text-weak">Location<input data-action="research-location" value={location()} onInput={(event) => setLocation(event.currentTarget.value)} placeholder="Optional" class="h-9 rounded-md border border-border-weaker-base bg-background-base px-2 text-12-regular text-text-strong" /></label>
      </div>
      <Button data-action="research-ask-chat" onClick={ask} disabled={!query().trim()} class="w-full justify-center"><Icon name="sparkles" class="size-4" />Ask Chat to research</Button>
      <div class="rounded-lg border border-border-weaker-base bg-surface-raised/50 p-3 text-11-regular text-text-weak">
        <div class="mb-1 font-medium text-text-strong">How it works</div>
        Chat will use the configured provider, then call the Laya classifier or an explicit local fallback. The shortlist is safe to review; bookings, purchases, and applications still require approval.
      </div>
    </div>
  )
}
