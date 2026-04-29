import { loadEnvConfig } from "@next/env"
import OpenAI from "openai"

function redactKey(key: string) {
  if (key.length <= 10) return "***"
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

async function main() {
  loadEnvConfig(process.cwd())
  const apiKey = process.env.VOLCE_API_KEY || process.env.ARK_API_KEY
  if (!apiKey) throw new Error("VOLCE_OR_ARK_API_KEY_NOT_SET")

  const model = process.env.VOLCE_MODEL || "doubao-seed-2-0-pro-260215"
  const baseUrl = process.env.VOLCE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"
  const startedAt = Date.now()
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl.replace(/\/$/, ""),
  })
  const response = await client.responses.create({
    model,
    input: [{ role: "user", content: [{ type: "input_text", text: "reply with pong only" }] }],
    max_output_tokens: 16,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: "volcengine",
        model,
        responseId: response.id,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        apiKey: redactKey(apiKey),
      },
      null,
      2,
    ),
  )
}

main().catch((err: unknown) => {
  let message = err instanceof Error ? err.message : String(err)
  if (/fetch failed/i.test(message)) {
    message += "（请先在本机终端确认网络可达，或检查 base url / DNS）"
  }
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: message,
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
