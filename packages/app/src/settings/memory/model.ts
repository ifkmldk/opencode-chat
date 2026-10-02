// fork: Settings → Memory. Vault-backed memory (Obsidian markdown SSOT).
// Read-only status in stage 1; export/import/sync lands with the sync worker.
export const MEMORY_SCOPES = ["global", "project", "session"] as const
export type MemoryScopeID = (typeof MEMORY_SCOPES)[number]

export const MEMORY_KINDS = ["fact", "preference", "decision", "correction", "person", "project-brief"] as const
export type MemoryKindID = (typeof MEMORY_KINDS)[number]

export const DEFAULT_VAULT_DIR = "C:/Users/fadhi/Documents/Obsidian/opencode-memory"

export const normalizeVaultDir = (value: unknown): string => (typeof value === "string" ? value : "")
