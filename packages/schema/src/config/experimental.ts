export * as ConfigExperimental from "./experimental.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"
import { ConfigPolicy } from "./policy.js"

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the experimental portable shell permission scanner. Defaults to false.",
  }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  laya: Schema.Struct({
    enabled: Schema.Boolean.pipe(optional),
    modelDir: Schema.String.pipe(optional),
    subfolder: Schema.String.pipe(optional),
    timeoutMs: NonNegativeInt.pipe(optional),
  }).pipe(optional).annotate({
    description: "Deprecated alias of classifier. Prefer classifier.",
  }),
  classifier: Schema.Struct({
    enabled: Schema.Boolean.pipe(optional),
    modelDir: Schema.String.pipe(optional),
    subfolder: Schema.String.pipe(optional),
    timeoutMs: NonNegativeInt.pipe(optional),
  }).pipe(optional).annotate({
    description: "Optional local classifier runtime configuration.",
  }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Ordered policies controlling access to configured resources",
  }),
}) {}
