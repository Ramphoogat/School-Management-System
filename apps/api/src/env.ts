import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Imported first by main.ts so every module (including the websocket gateways, which read
// their allowed origins when the class is defined) sees the values from .env.
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(p)) {
    process.loadEnvFile(p)
    break
  }
}
