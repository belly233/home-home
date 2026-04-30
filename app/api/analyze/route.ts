import OpenAI from "openai"
import { z } from "zod"

export const runtime = "nodejs"
export const maxDuration = 180

const inputSchema = z.object({
  householdId: z.string().trim().optional(),
  spaceHint: z.string().trim().max(80).optional(),
})

const outputSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      category: z.string().nullable().optional(),
      quantity: z.number().nullable().optional(),
      unit: z.string().nullable().optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      notes: z.string().nullable().optional(),
      suggestedSpaceName: z.string().nullable().optional(),
      suggestedSpaceReason: z.string().nullable().optional(),
      suggestedSubspaceName: z.string().nullable().optional(),
    }),
  ).default([]),
  suggestions: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      steps: z.array(z.string()),
      priority: z.enum(["P0", "P1", "P2"]),
    }),
  ).default([]),
  shopping: z.array(
    z.object({
      title: z.string(),
      reason: z.string(),
      productType: z.string(),
      budgetLevel: z.enum(["low", "mid", "high"]).default("mid"),
      searchQuery: z.string(),
    }),
  ).default([]),
  afterPreview: z.object({
    prompt: z.string(),
    style: z.string(),
    disclaimer: z.string(),
  }),
  warnings: z.array(z.string()).default([]),
})

function fileToDataUrl(file: File) {
  return file.arrayBuffer().then((buf) => {
    const base64 = Buffer.from(buf).toString("base64")
    const mime = file.type || "image/jpeg"
    return `data:${mime};base64,${base64}`
  })
}

function extractOutputText(response: unknown) {
  const resp = response as {
    output_text?: unknown
    output?: Array<{
      text?: unknown
      output_text?: unknown
      content?: Array<{ text?: unknown; output_text?: unknown; refusal?: unknown }>
    }>
  }
  if (typeof resp?.output_text === "string" && resp.output_text.trim()) return resp.output_text
  for (const block of resp?.output ?? []) {
    if (typeof block?.text === "string" && block.text.trim()) return block.text
    if (typeof block?.output_text === "string" && block.output_text.trim()) return block.output_text
    for (const c of block.content ?? []) {
      if (typeof c.text === "string" && c.text.trim()) return c.text
      if (typeof c.output_text === "string" && c.output_text.trim()) return c.output_text
      if (
        typeof c.text === "object" &&
        c.text !== null &&
        "value" in c.text &&
        typeof (c.text as { value?: unknown }).value === "string" &&
        (c.text as { value: string }).value.trim()
      ) {
        return (c.text as { value: string }).value
      }
      if (typeof c.refusal === "string" && c.refusal.trim()) {
        throw new Error(`VOLCE_REFUSAL:${c.refusal.slice(0, 200)}`)
      }
    }
  }
  let preview = ""
  try {
    preview = JSON.stringify(response).slice(0, 500)
  } catch {
    // ignore stringify failure
  }
  throw new Error(preview ? `EMPTY_VOLCE_RESPONSE:${preview}` : "EMPTY_VOLCE_RESPONSE")
}

function normalizeJsonText(raw: string) {
  const trimmed = raw.trim()
  if (trimmed.startsWith("```")) {
    const withoutFenceStart = trimmed.replace(/^```(?:json)?\s*/i, "")
    return withoutFenceStart.replace(/\s*```$/, "").trim()
  }
  return trimmed
}

function hasCjk(text: string) {
  return /[\u4e00-\u9fff]/.test(text)
}

function asString(v: unknown) {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s ? s : null
}

function asNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const val = asString(obj[k])
    if (val) return val
  }
  return null
}

function toAmazonSearchUrl(query: string) {
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`
}

function buildFallbackShopping(items: Array<{ name: string; category?: string | null }>, hint?: string | null) {
  const seed = [
    {
      title: "Clear stackable bins",
      reason: "Makes categories visible and easy to maintain.",
      productType: "Storage bin",
      budgetLevel: "mid" as const,
      searchQuery: `${hint ?? "home"} clear stackable storage bins`,
    },
    {
      title: "Label maker or removable labels",
      reason: "Improves long-term organization habits.",
      productType: "Labeling",
      budgetLevel: "low" as const,
      searchQuery: "home organization label maker removable labels",
    },
    {
      title: "Drawer dividers",
      reason: "Prevents mixing and reduces re-cluttering.",
      productType: "Drawer divider",
      budgetLevel: "low" as const,
      searchQuery: `${hint ?? "home"} adjustable drawer dividers`,
    },
  ]
  const categoryHints = Array.from(
    new Set(items.map((i) => i.category?.trim()).filter((v): v is string => Boolean(v))),
  ).slice(0, 2)
  for (const c of categoryHints) {
    seed.push({
      title: `${c} organizer`,
      reason: `Dedicated organizers for ${c} make retrieval and restocking faster.`,
      productType: "Category organizer",
      budgetLevel: "mid",
      searchQuery: `${c} organizer storage`,
    })
  }
  return seed.slice(0, 5)
}

function buildFallbackAfterPreview(params: {
  hint?: string | null
  items: Array<{ name: string }>
  suggestions: Array<{ title: string }>
}) {
  const topItems = params.items
    .slice(0, 8)
    .map((i) => i.name)
    .join(", ")
  const topSuggestions = params.suggestions
    .slice(0, 3)
    .map((s) => s.title)
    .join("; ")
  const room = params.hint?.trim() || "a household space"
  return {
    prompt:
      `Photorealistic after-organization view of ${room}. Clean and minimal layout, clear zones, ` +
      `neat labeled containers, realistic lighting. Keep these items logically stored: ${topItems || "daily essentials"}. ` +
      `Apply these organization goals: ${topSuggestions || "declutter and optimize storage flow"}.`,
    style: "Photorealistic, bright natural light, practical family-friendly setup",
    disclaimer:
      "AI preview is a planning reference and may differ from final real-world results.",
  }
}

function buildFallbackItems(hint?: string | null) {
  const h = (hint ?? "").toLowerCase()
  if (/closet|wardrobe|bedroom|衣柜|卧室/.test(h)) {
    return [
      {
        name: "Shirts and tops",
        category: "Clothing",
        quantity: 6,
        unit: "pcs",
        confidence: null,
        notes: null,
        suggestedSpaceName: "Wardrobe",
        suggestedSpaceReason: "Daily tops are used frequently and should stay in one visible zone.",
        suggestedSubspaceName: "Upper hanging rail",
      },
      {
        name: "Jackets and outerwear",
        category: "Clothing",
        quantity: 3,
        unit: "pcs",
        confidence: null,
        notes: null,
        suggestedSpaceName: "Wardrobe",
        suggestedSpaceReason: "Outerwear benefits from wider hanger spacing and quick access.",
        suggestedSubspaceName: "Left hanging section",
      },
      {
        name: "Pants and skirts",
        category: "Clothing",
        quantity: 4,
        unit: "pcs",
        confidence: null,
        notes: null,
        suggestedSpaceName: "Wardrobe",
        suggestedSpaceReason: "Grouping bottoms together makes outfit matching faster.",
        suggestedSubspaceName: "Lower hanging rail",
      },
      {
        name: "Dresses",
        category: "Clothing",
        quantity: 2,
        unit: "pcs",
        confidence: null,
        notes: null,
        suggestedSpaceName: "Wardrobe",
        suggestedSpaceReason: "Long garments need a dedicated wrinkle-free vertical area.",
        suggestedSubspaceName: "Long-garment section",
      },
      {
        name: "Folded knitwear",
        category: "Clothing",
        quantity: 5,
        unit: "pcs",
        confidence: null,
        notes: null,
        suggestedSpaceName: "Wardrobe",
        suggestedSpaceReason: "Folded items are easier to stack and maintain in shelves.",
        suggestedSubspaceName: "Middle shelf",
      },
      {
        name: "Bags and accessories",
        category: "Accessory",
        quantity: 4,
        unit: "pcs",
        confidence: null,
        notes: null,
        suggestedSpaceName: "Bedroom",
        suggestedSpaceReason: "Accessory grouping reduces morning search time.",
        suggestedSubspaceName: "Right-side hooks or basket",
      },
    ]
  }
  return [
    {
      name: "Tissue pack",
      category: "Consumable",
      quantity: 1,
      unit: "pack",
      confidence: null,
      notes: null,
      suggestedSpaceName: "Daily-use area",
      suggestedSpaceReason: "Keep tissues where they are used most often for quick access.",
      suggestedSubspaceName: "Desktop or side table",
    },
    {
      name: "Small personal care items",
      category: "Daily essentials",
      quantity: null,
      unit: null,
      confidence: null,
      notes: null,
      suggestedSpaceName: "Daily-use area",
      suggestedSpaceReason: "Group daily essentials together to avoid scattered placement.",
      suggestedSubspaceName: "Easy-reach organizer",
    },
    {
      name: "Refill stock",
      category: "General",
      quantity: null,
      unit: null,
      confidence: null,
      notes: null,
      suggestedSpaceName: "Storage zone",
      suggestedSpaceReason: "Refills should stay separate from active items to keep surfaces clean.",
      suggestedSubspaceName: "Closed bin",
    },
  ]
}

function coerceModelOutput(parsedJson: Record<string, unknown>) {
  const rawItems = Array.isArray(parsedJson.items)
    ? parsedJson.items
    : Array.isArray(parsedJson["识别物品"])
      ? parsedJson["识别物品"]
      : []
  const rawSuggestions = Array.isArray(parsedJson.suggestions)
    ? parsedJson.suggestions
    : Array.isArray(parsedJson["收纳建议"])
      ? parsedJson["收纳建议"]
      : []
  const rawWarnings = Array.isArray(parsedJson.warnings)
    ? parsedJson.warnings
    : Array.isArray(parsedJson["提示"])
      ? parsedJson["提示"]
      : []
  const rawShopping = Array.isArray(parsedJson.shopping)
    ? parsedJson.shopping
    : Array.isArray(parsedJson["shoppingRecommendations"])
      ? parsedJson["shoppingRecommendations"]
      : []
  const rawAfterPreview =
    typeof parsedJson.afterPreview === "object" && parsedJson.afterPreview !== null
      ? (parsedJson.afterPreview as Record<string, unknown>)
      : typeof parsedJson["afterImage"] === "object" && parsedJson["afterImage"] !== null
        ? (parsedJson["afterImage"] as Record<string, unknown>)
        : null

  const items = rawItems
    .map((v) => {
      if (typeof v === "string") {
        return {
          name: v,
          category: null,
          quantity: null,
          unit: null,
          confidence: null,
          notes: null,
          suggestedSpaceName: null,
          suggestedSpaceReason: null,
          suggestedSubspaceName: null,
        }
      }
      if (typeof v !== "object" || v === null) return null
      const obj = v as Record<string, unknown>
      const name = pickString(obj, ["name", "itemName", "物品名", "物品名称", "名称", "title"])
      if (!name) return null
      const category = pickString(obj, ["category", "分类", "类别"])
      const unit = pickString(obj, ["unit", "单位"])
      const notes = pickString(obj, ["notes", "note", "备注", "说明"])
      const suggestedSpaceName = pickString(obj, [
        "suggestedSpaceName",
        "spaceName",
        "space",
        "recommendedSpace",
        "建议空间",
        "推荐空间",
      ])
      const suggestedSpaceReason = pickString(obj, [
        "suggestedSpaceReason",
        "spaceReason",
        "reason",
        "建议原因",
        "推荐理由",
      ])
      const suggestedSubspaceName = pickString(obj, [
        "suggestedSubspaceName",
        "subspaceName",
        "subspace",
        "recommendedSubspace",
        "建议小区域",
        "推荐小区域",
        "小区域",
      ])
      const quantity = asNumber(obj.quantity ?? obj["数量"] ?? obj["count"])
      const confidenceRaw = asNumber(obj.confidence ?? obj["置信度"])
      const confidence = confidenceRaw === null ? null : Math.max(0, Math.min(1, confidenceRaw))
      return {
        name,
        category,
        quantity,
        unit,
        confidence,
        notes,
        suggestedSpaceName,
        suggestedSpaceReason,
        suggestedSubspaceName,
      }
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))

  const suggestions = rawSuggestions
    .map((v) => {
      if (typeof v === "string") {
        return { title: v.slice(0, 24), why: v, steps: [v], priority: "P1" as const }
      }
      if (typeof v !== "object" || v === null) return null
      const obj = v as Record<string, unknown>
      const title = pickString(obj, ["title", "标题", "建议", "name"]) ?? "Organization suggestion"
      const why = pickString(obj, ["why", "原因", "理由", "说明"]) ?? title
      const priorityRaw = pickString(obj, ["priority", "优先级"]) ?? "P1"
      const priority =
        priorityRaw === "P0" || priorityRaw === "P1" || priorityRaw === "P2" ? priorityRaw : ("P1" as const)
      const rawSteps = obj.steps ?? obj["步骤"]
      const steps = Array.isArray(rawSteps)
        ? rawSteps.map((s) => asString(s)).filter((s): s is string => Boolean(s))
        : [why]
      return {
        title,
        why,
        steps: steps.length ? steps : [why],
        priority,
      }
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))

  const warnings = rawWarnings.filter((v): v is string => typeof v === "string")
  const shopping = rawShopping
    .map((v) => {
      if (typeof v !== "object" || v === null) return null
      const obj = v as Record<string, unknown>
      const title = pickString(obj, ["title", "name"])
      const reason = pickString(obj, ["reason", "why"])
      const productType = pickString(obj, ["productType", "type"])
      const query = pickString(obj, ["searchQuery", "query", "keywords"])
      const budgetRaw = pickString(obj, ["budgetLevel", "budget"]) ?? "mid"
      const budgetLevel =
        budgetRaw === "low" || budgetRaw === "mid" || budgetRaw === "high" ? budgetRaw : ("mid" as const)
      if (!title || !reason || !productType || !query) return null
      return {
        title,
        reason,
        productType,
        budgetLevel,
        searchQuery: query,
      }
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))

  const fallbackSuggestions = suggestions.length
    ? suggestions
    : [
        {
          title: "Start by grouping items by space",
          why: "Collect related items into the same space first to quickly reduce visual clutter.",
          steps: [
            "Confirm placement using suggested spaces",
            "Store similar items together in one container",
            "Put high-frequency items in easy-reach spots",
          ],
          priority: "P1" as const,
        },
      ]

  const fallbackShopping = shopping.length ? shopping : buildFallbackShopping(items, null)
  const afterPreviewModel =
    rawAfterPreview && typeof rawAfterPreview === "object"
      ? {
          prompt: pickString(rawAfterPreview, ["prompt", "imagePrompt"]),
          style: pickString(rawAfterPreview, ["style"]),
          disclaimer: pickString(rawAfterPreview, ["disclaimer", "note"]),
        }
      : null
  const fallbackAfter = buildFallbackAfterPreview({ hint: null, items, suggestions: fallbackSuggestions })
  const afterPreview = {
    prompt: afterPreviewModel?.prompt ?? fallbackAfter.prompt,
    style: afterPreviewModel?.style ?? fallbackAfter.style,
    disclaimer: afterPreviewModel?.disclaimer ?? fallbackAfter.disclaimer,
  }

  return { items, suggestions: fallbackSuggestions, shopping: fallbackShopping, afterPreview, warnings }
}

function isLengthIncomplete(response: unknown) {
  const resp = response as { incomplete_details?: { reason?: unknown } }
  return resp?.incomplete_details?.reason === "length"
}

async function requestVolcJson(params: {
  client: OpenAI
  model: string
  input: never
  maxOutputTokens: number
}) {
  const { client, model, input, maxOutputTokens } = params
  return Promise.race([
    client.responses.create({
      model,
      input,
      text: { format: { type: "json_object" } } as never,
      max_output_tokens: maxOutputTokens,
    }),
    // Vercel Hobby functions are often capped ~10s; keep this under that.
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("VOLCE_TIMEOUT")), 9_000)),
  ])
}

async function parseModelJsonWithRetries(params: {
  request: (maxOutputTokens: number) => Promise<unknown>
  tokenPlan: number[]
}) {
  let lastError: unknown = null
  let lastResponse: unknown = null
  for (const t of params.tokenPlan) {
    const response = await params.request(t)
    lastResponse = response
    try {
      const outText = extractOutputText(response)
      const normalized = normalizeJsonText(outText)
      const parsedJson = JSON.parse(normalized) as Record<string, unknown>
      return { response, normalized, parsedJson }
    } catch (e) {
      lastError = e
      const message = e instanceof Error ? e.message : String(e)
      const retryable =
        isLengthIncomplete(response) ||
        /EMPTY_VOLCE_RESPONSE|Unexpected end of JSON input|JSON|VOLCE_REFUSAL/i.test(message)
      if (!retryable) throw e
      console.warn("[analyze] retry with larger token budget", {
        maxOutputTokens: t,
        message: message.slice(0, 120),
      })
    }
  }
  if (lastError) throw lastError
  throw new Error(
    (() => {
      try {
        return `EMPTY_VOLCE_RESPONSE:${JSON.stringify(lastResponse).slice(0, 300)}`
      } catch {
        return "EMPTY_VOLCE_RESPONSE"
      }
    })(),
  )
}

async function translateResultToEnglish(params: {
  client: OpenAI
  model: string
  data: z.infer<typeof outputSchema>
}) {
  const { client, model, data } = params
  const needsTranslation =
    data.items.some((i) => hasCjk(i.name) || hasCjk(i.notes ?? "") || hasCjk(i.suggestedSpaceName ?? "")) ||
    data.suggestions.some((s) => hasCjk(s.title) || hasCjk(s.why) || s.steps.some((st) => hasCjk(st))) ||
    data.shopping.some((s) => hasCjk(s.title) || hasCjk(s.reason) || hasCjk(s.searchQuery)) ||
    hasCjk(data.afterPreview.prompt) ||
    hasCjk(data.afterPreview.style) ||
    hasCjk(data.afterPreview.disclaimer) ||
    data.warnings.some((w) => hasCjk(w))

  if (!needsTranslation) return data

  const input = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            "Translate this JSON to natural product English and keep exact same structure/keys. " +
            "Return JSON only, no markdown.",
        },
        { type: "input_text", text: JSON.stringify(data) },
      ],
    },
  ] as never

  try {
    const translatedPass = await parseModelJsonWithRetries({
      request: (maxOutputTokens) => requestVolcJson({ client, model, input, maxOutputTokens }),
      tokenPlan: [900],
    })
    const translatedCoerced = coerceModelOutput(translatedPass.parsedJson)
    return outputSchema.parse(translatedCoerced)
  } catch {
    // Translation is best-effort only; never block analyze success.
    return data
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  let reqHouseholdId = ""
  let reqSpaceHint: string | null = null
  try {
    const formData = await req.formData()
    const householdId = formData.get("householdId")
    const spaceHint = formData.get("spaceHint")
    const file = formData.get("file")

    const parsedInput = inputSchema.safeParse({
      householdId: typeof householdId === "string" ? householdId : undefined,
      spaceHint: typeof spaceHint === "string" ? spaceHint : undefined,
    })
    if (!parsedInput.success) {
      console.warn("[analyze] bad request", { issues: parsedInput.error.issues.length })
      return Response.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 })
    }
    reqHouseholdId = parsedInput.data.householdId ?? ""
    reqSpaceHint = parsedInput.data.spaceHint ?? null
    if (!(file instanceof File)) {
      console.warn("[analyze] missing file")
      return Response.json({ ok: false, error: "MISSING_FILE" }, { status: 400 })
    }

    const apiKey = process.env.VOLCE_API_KEY || process.env.ARK_API_KEY
    if (!apiKey) {
      console.error("[analyze] volc key missing")
      return Response.json({ ok: false, error: "VOLCE_API_KEY_NOT_SET" }, { status: 500 })
    }

    const baseUrl = (process.env.VOLCE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "")
    // IMPORTANT: image understanding requires a vision-capable model.
    // Prefer VOLCE_VISION_MODEL, then VOLCE_MODEL, then a known vision default.
    const model =
      process.env.VOLCE_VISION_MODEL ||
      process.env.VOLCE_MODEL ||
      "doubao-seed-1-6-vision-250815"
    const client = new OpenAI({ apiKey, baseURL: baseUrl })
    const imageDataUrl = await fileToDataUrl(file)
    const hint = parsedInput.data.spaceHint?.trim() || "No space hint provided"
    console.info("[analyze] request start", {
      householdId: parsedInput.data.householdId ?? null,
      hasSpaceHint: Boolean(parsedInput.data.spaceHint?.trim()),
      fileName: file.name,
      fileType: file.type || "unknown",
      fileSize: file.size,
      model,
      baseUrl,
    })

    const input = [
      {
        role: "user",
        content: [
          { type: "input_text", text: `Space hint: ${hint}` },
          {
            type: "input_text",
            text:
              "Output JSON object only with keys: items, suggestions, afterPreview, warnings. " +
              "No markdown, no code blocks, no explanations. " +
              "All returned text must be English. " +
              "Each item may include suggestedSpaceName, suggestedSubspaceName, suggestedSpaceReason. " +
              "Return 6-12 concrete visible items from the photo. Avoid generic placeholders.",
          },
          { type: "input_image", image_url: imageDataUrl, detail: "low" },
        ],
      },
    ] as never

    const firstPass = await parseModelJsonWithRetries({
      request: (maxOutputTokens) => requestVolcJson({ client, model, input, maxOutputTokens }),
      // Keep one quick attempt to stay under serverless timeout.
      tokenPlan: [320],
    })
    let response = firstPass.response
    let normalized = firstPass.normalized
    const parsedJson = firstPass.parsedJson

    const respMeta = response as { id?: string; status?: string; incomplete_details?: { reason?: unknown } }
    console.info("[analyze] volc response", {
      responseId: respMeta?.id ?? null,
      responseStatus: respMeta?.status ?? null,
      incompleteReason: respMeta?.incomplete_details?.reason ?? null,
      latencyMs: Date.now() - startedAt,
    })

    let coerced = coerceModelOutput(parsedJson)
    if (!coerced.afterPreview?.prompt) {
      coerced.afterPreview = buildFallbackAfterPreview({
        hint: parsedInput.data.spaceHint ?? null,
        items: coerced.items,
        suggestions: coerced.suggestions,
      })
    }
    if (!coerced.items.length) {
      // Don't silently return templated items; this hides real issues (wrong model, bad vision support, etc).
      return Response.json(
        {
          ok: false,
          error: "NO_ITEMS_DETECTED",
          details: {
            model,
            latencyMs: Date.now() - startedAt,
            preview: normalized.slice(0, 500),
          },
        },
        { status: 502 },
      )
    }
    const parsedOutput = outputSchema.parse(coerced)
    if (!Array.isArray(parsedJson.items) || !Array.isArray(parsedJson.suggestions)) {
      console.warn("[analyze] model json missing required arrays, fallback to empty arrays", {
        hasItems: Array.isArray(parsedJson.items),
        hasSuggestions: Array.isArray(parsedJson.suggestions),
        hasWarnings: Array.isArray(parsedJson.warnings),
        hasCnItems: Array.isArray(parsedJson["识别物品"]),
        hasCnSuggestions: Array.isArray(parsedJson["收纳建议"]),
        rawPreview: normalized.slice(0, 300),
      })
    }
    console.info("[analyze] parse success", {
      items: parsedOutput.items.length,
      suggestions: parsedOutput.suggestions.length,
      warnings: parsedOutput.warnings?.length ?? 0,
      totalLatencyMs: Date.now() - startedAt,
    })

    return Response.json({
      ok: true,
      householdId: parsedInput.data.householdId ?? "",
      spaceHint: parsedInput.data.spaceHint ?? null,
      items: parsedOutput.items ?? [],
      suggestions: parsedOutput.suggestions ?? [],
      afterPreview: parsedOutput.afterPreview,
      warnings: parsedOutput.warnings ?? [],
      debug: {
        latencyMs: Date.now() - startedAt,
        model,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    console.error("[analyze] failed", {
      message,
      totalLatencyMs: Date.now() - startedAt,
    })
    if (/timeout|timed out|aborted|VOLCE_TIMEOUT/i.test(message)) {
      const fallbackSuggestions = [
        {
          title: "Do a quick first-pass declutter",
          why: "Removing obvious out-of-place items first gives immediate progress and reduces visual noise.",
          steps: [
            "Collect all out-of-place items into one temporary basket",
            "Group similar items together",
            "Return each group to one fixed zone",
          ],
          priority: "P1" as const,
        },
      ]
      const fallbackAfter = buildFallbackAfterPreview({
        hint: null,
        items: [],
        suggestions: fallbackSuggestions,
      })
      return Response.json({
        ok: true,
        householdId: reqHouseholdId,
        spaceHint: reqSpaceHint,
        items: buildFallbackItems(reqSpaceHint),
        suggestions: fallbackSuggestions,
        afterPreview: fallbackAfter,
        warnings: [
          "AI recognition timed out. Returned fallback item candidates and organization plan.",
          `DEBUG:VOLCE_TIMEOUT latencyMs=${Date.now() - startedAt}`,
        ],
        debug: {
          latencyMs: Date.now() - startedAt,
          fallback: "VOLCE_TIMEOUT",
        },
      })
    }
    if (/401/.test(message)) return Response.json({ ok: false, error: "VOLCE_AUTH_ERROR" }, { status: 502 })
    if (/403/.test(message)) return Response.json({ ok: false, error: "VOLCE_PERMISSION_DENIED" }, { status: 502 })
    if (/404/.test(message)) return Response.json({ ok: false, error: "VOLCE_MODEL_NOT_FOUND" }, { status: 502 })
    if (/429/.test(message)) return Response.json({ ok: false, error: "VOLCE_RATE_LIMIT" }, { status: 429 })
    if (message === "UNAUTHENTICATED") return Response.json({ ok: false, error: message }, { status: 401 })
    if (message === "FORBIDDEN") return Response.json({ ok: false, error: message }, { status: 403 })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
