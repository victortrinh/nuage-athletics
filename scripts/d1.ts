/**
 * Shared `wrangler d1 execute` runner for the Node-side scripts
 * (scripts/broadcast.ts, scripts/subscribers.ts). Both need to read D1 from
 * plain Node, outside the Worker, and wrangler's CLI is the only supported
 * way to do that without duplicating Cloudflare's D1 HTTP API auth.
 *
 * Requires being logged in (`wrangler login`) for --remote; --local reads the
 * same sqlite file `wrangler dev`/`vitest` use under .wrangler/state.
 */
import { execFileSync } from 'node:child_process'

export interface D1QueryOptions {
  /** Defaults to true (the production database) — pass false for --local. */
  remote?: boolean
}

export function queryD1<T>(sql: string, { remote = true }: D1QueryOptions = {}): T[] {
  const output = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'nuage-athletics',
      remote ? '--remote' : '--local',
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32 }
  )
  const parsed = JSON.parse(output) as { results: T[] }[]
  return parsed[0]?.results ?? []
}
