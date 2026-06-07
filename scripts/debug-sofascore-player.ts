#!/usr/bin/env npx tsx
import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(process.cwd(), ".env.local") })

async function main() {
  const res = await fetch("https://api.sofascore.com/api/v1/player/341832", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Referer": "https://www.sofascore.com/",
    },
  })

  console.log("Status:", res.status)
  const data = await res.json()
  console.log(JSON.stringify(data, null, 2))
}

main().catch(console.error)
