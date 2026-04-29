import { NextResponse } from "next/server"
import OpenAI from "openai"

import { requireUserId } from "@/app/lib/auth"

export const runtime = "nodejs"
export const maxDuration = 30

function isTimeoutLikeError(err: unknown) {
  if (!(err instanceof Error)) return false
  return /timed out|timeout|aborted/i.test(err.message)
}

function getErrorCodeByStatus(status: number) {
  if (status === 401) return "VOLCE_AUTH_ERROR"
  if (status === 403) return "VOLCE_PERMISSION_DENIED"
  if (status === 404) return "VOLCE_MODEL_NOT_FOUND"
  if (status === 408) return "VOLCE_TIMEOUT"
  if (status === 429) return "VOLCE_RATE_LIMIT"
  if (status >= 500) return "VOLCE_UPSTREAM_ERROR"
  return `VOLCE_${status}`
}

export async function GET() {
  try {
    await requireUserId()

    const apiKey = process.env.VOLCE_API_KEY || process.env.ARK_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, status: "misconfigured", error: "VOLCE_API_KEY_NOT_SET" },
        { status: 500 },
      )
    }

    const model = process.env.VOLCE_MODEL || "doubao-seed-2-0-pro-260215"
    const baseUrl = process.env.VOLCE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"
    const startedAt = Date.now()
    const client = new OpenAI({
      apiKey,
      baseURL: baseUrl.replace(/\/$/, ""),
    })
    try {
      await Promise.race([
        client.responses.create({
          model,
          input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
          max_output_tokens: 16,
        }),
        new Promise<never>((_, reject) => {
          const id = setTimeout(() => {
            reject(new Error("VOLCE_TIMEOUT"))
          }, 20_000)
          id.unref?.()
        }),
      ])
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
          ? err.status
          : null
      const detail =
        typeof err === "object" && err !== null && "message" in err && typeof err.message === "string"
          ? err.message
          : null
      if (status !== null) {
        const code = getErrorCodeByStatus(status)
        return NextResponse.json(
          { ok: false, status: "unhealthy", error: code, detail },
          { status: code === "VOLCE_RATE_LIMIT" ? 429 : 502 },
        )
      }
      throw err
    }

    return NextResponse.json({
      ok: true,
      status: "healthy",
      provider: "volcengine",
      model,
      latencyMs: Date.now() - startedAt,
    })
  } catch (e) {
    if (isTimeoutLikeError(e)) {
      return NextResponse.json({ ok: false, status: "degraded", error: "VOLCE_TIMEOUT" }, { status: 504 })
    }
    const message = e instanceof Error ? e.message : "UNKNOWN"
    const status = message === "UNAUTHENTICATED" ? 401 : 500
    return NextResponse.json({ ok: false, status: "unhealthy", error: message }, { status })
  }
}
