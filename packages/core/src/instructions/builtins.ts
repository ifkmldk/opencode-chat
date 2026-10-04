export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import type { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { Instructions } from "./index.js"
import { RESPONSE_CONTRACT, RESPONSE_KEY } from "../response/contract.js"

export interface Interface {
  readonly load: (sessionID: Session.ID) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionBuiltIns") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const location = yield* Location.Service
    return Service.of({
      load: (sessionID) =>
        Effect.succeed(
          Instructions.combine([
            Instructions.make({
              key: Instructions.Key.make("core/environment"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() =>
                [
                  "<env>",
                  `  Current conversation session ID: ${sessionID}`,
                  `  Working directory: ${location.directory}`,
                  `  Workspace root folder: ${location.project.directory}`,
                  `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
                  `  Platform: ${process.platform}`,
                  `  Prefer ${global.tmp} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
                  "</env>",
                ].join("\n"),
              ),
              render: {
                initial: (environment) =>
                  ["Here is some useful information about the environment you are running in:", environment].join("\n"),
                changed: (_previous, environment) =>
                  ["The environment you are running in is now:", environment].join("\n"),
              },
            }),
            // fork: the web UI turns linked output files into downloadable file cards.
            Instructions.make({
              key: Instructions.Key.make("core/output-files"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() => outputFiles(global.tmp.replaceAll("\\", "/"))),
              render: {
                initial: (text) => text,
                changed: (_previous, text) => text,
              },
            }),
            // fork: short structured-answer contract (headers, sources, verify/next).
            Instructions.make({
              key: Instructions.Key.make(RESPONSE_KEY),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.succeed(RESPONSE_CONTRACT),
              render: {
                initial: (text) => text,
                changed: (_previous, text) => text,
              },
            }),
            // fork: place cards, the map panel and accurate spatial answers depend on the maps tools.
            Instructions.make({
              key: Instructions.Key.make("core/geo"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.succeed(geo),
              render: {
                initial: (text) => text,
                changed: (_previous, text) => text,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/date"),
              codec: Schema.toCodecJson(Schema.String),
              read: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
              render: {
                initial: (date) => `Today's date: ${date}`,
                changed: (_previous, date) => `Today's date is now: ${date}`,
              },
            }),
          ]),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node] })

const geo = [
  "For questions about real places, routes or locations, use the maps tools instead of memory (OSM-only: OpenStreetMap, keyless, never billed):",
  "maps_search for places (OpenStreetMap addresses, coordinates, opening hours, hotel stars; ratings/reviews/prices only when scraped with attribution, else unknown), maps_ask for public-transport directions (KRL, TransJakarta, MRT) and local questions,",
  "maps_route and maps_matrix for travel time over roads, maps_poi for what is around a place, and geo_compute for exact distances, areas, buffers, clusters and weighted rankings.",
  "Never state a rating, price, opening time or address the tools did not return, and say where the data came from (OpenStreetMap, web-search, or scraped with attribution).",
  'Decide "nearest" or "best" by travel time, not straight-line distance, and state the travel mode and assumptions.',
  "Hard rules for research answers: (1) location/anchor is never dropped — resolve it via maps_search geocoding; (2) every candidate shows distance to the anchor/corridor station and its data source with the check date; (3) must-have attributes (e.g. carport) are hard filters — candidates without scraped proof are removed, never presented; (4) anything unverified is labelled unknown, never invented; (5) present a comparison table (Name | Distance/Time | Price | Verification | Source) with the top 3 first.",
  "For spatial analysis, report the method, the data sources, the coordinate reference system (WGS84; UTM for areas and buffers) and the accuracy limits.",
  "Pick the analysis that answers the question: geo_compute classify for thematic classes (it compares Jenks, quantile, equal interval, standard deviation and head/tail breaks and recommends one by goodness of variance fit; report the GVF),",
  "morans_i to test whether values cluster, hotspots (Getis-Ord Gi*) to locate hot and cold spots, nearest_neighbor_index for point patterns, centrography for the centre and spread, and rank for multi-criteria choices.",
  "To choose between places, gather them with maps_search, measure travel time with maps_matrix, count what is nearby with maps_poi, score them with geo_compute rank using explicit weights,",
  "then, when classifier_classify is used for the decision, pass that ranking in its state and the candidate names as criteria; show the scoring table so the choice can be checked.",
  "Link every place you recommend as [Name](place:<id>) using the id from maps_search, include the Google Maps link for the chosen route,",
  "and finish an answer about places or routes by calling map_show with the shortlist, the route and any areas (place labels are optional; keep them to 1-3 characters).",
].join(" ")

function outputFiles(tmp: string) {
  return [
    "When you create or export files the user asked for (documents, spreadsheets, slides, images, audio, video, web pages, archives, or a requested script),",
    `end your reply with a Markdown link to each file using its absolute path with forward slashes, for example [report.pdf](${tmp}/report.pdf).`,
    `Wrap a path that contains spaces in angle brackets, for example [My report.pdf](<${tmp}/My report.pdf>).`,
    "Do not link source files you only edited while working.",
  ].join(" ")
}
