import OpenAI from "openai"
import { z } from "zod"

export const runtime = "nodejs"
export const maxDuration = 120

const inputSchema = z.object({
  householdId: z.string().trim().optional(),
  prompt: z.string().trim().min(12).max(4000),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024", "2K"]).optional(),
})

function extractImageFromResponse(resp: unknown) {
  const anyResp = resp as {
    data?: Array<{ url?: unknown; b64_json?: unknown; image_base64?: unknown }>
  }
  const first = anyResp?.data?.[0]
  if (!first) return null
  if (typeof first.url === "string" && first.url.trim()) return { imageUrl: first.url, imageDataUrl: null }
  if (typeof first.b64_json === "string" && first.b64_json.trim()) {
    return { imageUrl: null, imageDataUrl: `data:image/png;base64,${first.b64_json}` }
  }
  if (typeof first.image_base64 === "string" && first.image_base64.trim()) {
    return { imageUrl: null, imageDataUrl: `data:image/png;base64,${first.image_base64}` }
  }
  return null
}

function getImageModelCandidates() {
  const fromList = (process.env.VOLCE_IMAGE_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const fromSingle = process.env.VOLCE_IMAGE_MODEL?.trim()
  const defaults = [
    "doubao-seedream-5-0-260128",
    "doubao-seedream-3-0-t2i-250415",
    "doubao-seedream-2-0-t2i-250321",
    "doubao-seedream-2-0-t2i",
  ]
  return Array.from(new Set([...(fromSingle ? [fromSingle] : []), ...fromList, ...defaults]))
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const input = inputSchema.parse(body)

    const apiKey = process.env.VOLCE_API_KEY || process.env.ARK_API_KEY
    if (!apiKey) {
      return Response.json({ ok: false, error: "VOLCE_API_KEY_NOT_SET" }, { status: 500 })
    }

    const baseUrl = (process.env.VOLCE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "")
    const modelCandidates = getImageModelCandidates()
    const client = new OpenAI({ apiKey, baseURL: baseUrl })
    let lastError = "VOLCE_IMAGE_MODEL_NOT_FOUND"
    for (const model of modelCandidates) {
      try {
        const generated = await client.images.generate({
          model,
          prompt: input.prompt,
          size: input.size ?? "2K",
          output_format: "png",
          watermark: false,
        } as never)
        const parsed = extractImageFromResponse(generated)
        if (!parsed) {
          lastError = "IMAGE_GENERATION_EMPTY"
          continue
        }
        return Response.json({
          ok: true,
          model,
          ...parsed,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        lastError = message
        if (/401/.test(message))
          return Response.json({ ok: false, error: "VOLCE_AUTH_ERROR" }, { status: 502 })
        if (/403/.test(message))
          return Response.json({ ok: false, error: "VOLCE_PERMISSION_DENIED" }, { status: 502 })
        if (/429/.test(message))
          return Response.json({ ok: false, error: "VOLCE_RATE_LIMIT" }, { status: 429 })
        if (/404|model|not.?found/i.test(message)) {
          continue
        }
      }
    }
    return Response.json(
      {
        ok: false,
        error: "VOLCE_IMAGE_MODEL_NOT_FOUND",
        details: {
          triedModels: modelCandidates,
          lastError,
        },
      },
      { status: 502 },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    if (/401/.test(message)) return Response.json({ ok: false, error: "VOLCE_AUTH_ERROR" }, { status: 502 })
    if (/403/.test(message)) return Response.json({ ok: false, error: "VOLCE_PERMISSION_DENIED" }, { status: 502 })
    if (/404/.test(message)) return Response.json({ ok: false, error: "VOLCE_IMAGE_MODEL_NOT_FOUND" }, { status: 502 })
    if (/429/.test(message)) return Response.json({ ok: false, error: "VOLCE_RATE_LIMIT" }, { status: 429 })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
