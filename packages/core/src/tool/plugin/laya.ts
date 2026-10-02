// fork: deprecated alias. New code lives in classifier/engine.ts.
// Kept for one release so old sessions, prompts, and tests keep working.
export * from "../../classifier/engine.js"
import { ClassifierTool } from "../../classifier/engine.js"
export const LayaTool = ClassifierTool
