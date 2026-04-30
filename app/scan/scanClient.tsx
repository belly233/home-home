"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

type AnalyzeResult = {
  ok: true
  householdId: string
  spaceHint?: string | null
  items: Array<{
    name: string
    category?: string | null
    quantity?: number | null
    unit?: string | null
    confidence?: number | null
    notes?: string | null
    suggestedSpaceName?: string | null
    suggestedSpaceReason?: string | null
    suggestedSubspaceName?: string | null
  }>
  suggestions: Array<{
    title: string
    why: string
    steps: string[]
    priority: "P0" | "P1" | "P2"
  }>
  afterPreview: {
    prompt: string
    style: string
    disclaimer: string
  }
  warnings?: string[]
}

type HealthResponse = {
  ok: boolean
  status: "healthy" | "degraded" | "unhealthy" | "misconfigured"
  error?: string
}

type AfterPreviewResponse =
  | { ok: true; model: string; imageUrl: string | null; imageDataUrl: string | null }
  | { ok: false; error: string }

type Space = { id: string; name: string; parentId?: string | null }

type SpacesResponse = { ok: true; spaces: Space[] }
type CreateSpaceResponse = { ok: true; space: Space }

type SaveState = "idle" | "saving" | "saved"

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "")
}

function inferSpaceIdByName(spaces: Space[], predictedName?: string | null, hint?: string) {
  const target = normalizeText((predictedName || hint || "").trim())
  if (!target) return ""
  const exact = spaces.find((s) => normalizeText(s.name) === target)
  if (exact) return exact.id
  const include = spaces.find((s) => {
    const name = normalizeText(s.name)
    return name.includes(target) || target.includes(name)
  })
  return include?.id ?? ""
}

function looksLikeSubspaceName(name?: string | null) {
  const text = (name ?? "").trim()
  if (!text) return false
  const keywords = [
    "cabinet",
    "desk",
    "table",
    "corner",
    "shelf",
    "drawer",
    "behind door",
    "window side",
    "wall side",
    "bedside",
    "rack",
  ]
  return keywords.some((k) => text.includes(k))
}

function inferAreaForItem(params: {
  spaces: Space[]
  suggestedSpaceName?: string | null
  suggestedSubspaceName?: string | null
  hint?: string | null
}) {
  const { spaces, suggestedSpaceName, suggestedSubspaceName, hint } = params
  const rootSpaces = spaces.filter((s) => !s.parentId)
  const hintedRootId = inferSpaceIdByName(rootSpaces, hint ?? undefined)
  const directRootId = inferSpaceIdByName(rootSpaces, suggestedSpaceName ?? undefined)

  if (directRootId) {
    return {
      rootSpaceId: directRootId,
      subspaceName: (suggestedSubspaceName ?? "").trim(),
    }
  }

  const suggested = (suggestedSpaceName ?? "").trim()
  const child = spaces.find((s) => s.parentId && normalizeText(s.name) === normalizeText(suggested))
  if (child) {
    return { rootSpaceId: child.parentId ?? "", subspaceName: child.name }
  }

  if (looksLikeSubspaceName(suggested)) {
    return { rootSpaceId: hintedRootId, subspaceName: suggested }
  }

  return {
    rootSpaceId: hintedRootId,
    subspaceName: (suggestedSubspaceName ?? "").trim(),
  }
}

function dedupeSpacesByName(spaces: Space[]) {
  const map = new Map<string, Space>()
  for (const s of spaces) {
    const key = normalizeText(s.name)
    if (!key) continue
    if (!map.has(key)) map.set(key, s)
  }
  return Array.from(map.values())
}

function mapAiError(code: string) {
  if (code === "VOLCE_TIMEOUT") {
    return "Recognition timed out. Try a clearer/closer photo, or reduce clutter and retry."
  }
  if (code === "VOLCE_UPSTREAM_ERROR") {
    return "Recognition failed: upstream VolcEngine service is temporarily unavailable."
  }
  if (code === "VOLCE_AUTH_ERROR") {
    return "Recognition failed: VolcEngine API key is invalid, expired, or revoked."
  }
  if (code === "VOLCE_RATE_LIMIT") {
    return "Recognition failed: rate limited or quota exhausted. Please try again later."
  }
  if (code === "VOLCE_API_KEY_NOT_SET") {
    return "Server missing VOLCE_API_KEY. Set it in .env and restart dev."
  }
  if (code === "VOLCE_MODEL_NOT_FOUND") {
    return "Recognition failed: configured model not found. Check VOLCE_MODEL."
  }
  if (code === "VOLCE_PERMISSION_DENIED") {
    return "Recognition failed: current API key has no permission for this model."
  }
  if (code === "NO_ITEMS_DETECTED") {
    return (
      "No items detected from the image. This usually means the model does not support vision input or " +
      "the configured model is incorrect. Set VOLCE_VISION_MODEL to a vision-capable model (e.g. " +
      "doubao-seed-1-6-vision-250815) and retry."
    )
  }
  return null
}

async function getAiHealthHint() {
  try {
    const res = await fetch("/api/health/volc", { method: "GET" })
    const json = (await res.json()) as HealthResponse
    if (json.ok) return null
    return mapAiError(json.error ?? "") ?? null
  } catch {
    return null
  }
}

async function compressImage(file: File) {
  // Keep it simple: downscale longest side to 768px, JPEG quality 0.76.
  // If anything fails, fall back to original file.
  try {
    if (!file.type.startsWith("image/")) return file

    const srcUrl = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.decoding = "async"
      img.src = srcUrl
      await img.decode()

      const maxSide = 768
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      if (!w || !h) return file

      const scale = Math.min(1, maxSide / Math.max(w, h))
      if (scale >= 1 && file.size <= 2_000_000) return file

      const cw = Math.max(1, Math.round(w * scale))
      const ch = Math.max(1, Math.round(h * scale))
      const canvas = document.createElement("canvas")
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext("2d")
      if (!ctx) return file
      ctx.drawImage(img, 0, 0, cw, ch)

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.76),
      )
      if (!blob) return file

      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
      })
    } finally {
      URL.revokeObjectURL(srcUrl)
    }
  } catch {
    return file
  }
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error ?? new Error("READ_FILE_FAILED"))
    reader.readAsDataURL(file)
  })
}

export function ScanClient() {
  const sp = useSearchParams()
  const router = useRouter()
  const [householdId, setHouseholdId] = useState<string>(sp.get("householdId") ?? "")

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [spaceHint, setSpaceHint] = useState("")
  const [loading, setLoading] = useState(false)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [healthMessage, setHealthMessage] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [itemSpaceByKey, setItemSpaceByKey] = useState<Record<string, string>>({})
  const [itemSubspaceByKey, setItemSubspaceByKey] = useState<Record<string, string>>({})
  const [itemSelectedByKey, setItemSelectedByKey] = useState<Record<string, boolean>>({})
  const [saveStateByKey, setSaveStateByKey] = useState<Record<string, SaveState>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [autoCreateMissingSpaces, setAutoCreateMissingSpaces] = useState(true)
  const [capturedImageDataUrl, setCapturedImageDataUrl] = useState<string | null>(null)
  const [afterImageUrl, setAfterImageUrl] = useState<string | null>(null)
  const [afterModel, setAfterModel] = useState<string | null>(null)
  const [generatingAfter, setGeneratingAfter] = useState(false)
  const [afterError, setAfterError] = useState<string | null>(null)

  const canSubmit = useMemo(() => !!file && !loading, [file, loading])
  const selectedItemsCount = useMemo(
    () => Object.values(itemSelectedByKey).filter(Boolean).length,
    [itemSelectedByKey],
  )
  const mergedSpaces = useMemo(() => dedupeSpacesByName(spaces.filter((s) => !s.parentId)), [spaces])

  async function loadSpaces() {
    if (!householdId) return
    const res = await fetch(`/api/spaces?householdId=${householdId}`, { cache: "no-store" })
    const json = (await res.json()) as SpacesResponse | { ok: false; error: string }
    if (!res.ok || !json.ok) throw new Error(("error" in json ? json.error : null) ?? "LOAD_SPACES_FAILED")
    setSpaces(json.spaces ?? [])
  }

  async function analyze() {
    if (!file) return
    setLoading(true)
    setError(null)
    setSaveError(null)
    setResult(null)
    try {
      const prepared = await compressImage(file)
      const preparedDataUrl = await fileToDataUrl(prepared)
      setCapturedImageDataUrl(preparedDataUrl)
      const fd = new FormData()
      if (householdId) fd.set("householdId", householdId)
      if (spaceHint.trim()) fd.set("spaceHint", spaceHint.trim())
      fd.set("file", prepared)

      const res = await fetch("/api/analyze", { method: "POST", body: fd })
      const json = (await res.json()) as AnalyzeResult | { ok: false; error: string }
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        const err = "error" in json ? json.error : "ANALYZE_FAILED"
        const mapped = mapAiError(err)
        if (mapped) {
          throw new Error(mapped)
        }
        const healthHint = await getAiHealthHint()
        if (healthHint) throw new Error(healthHint)
        throw new Error(err)
      }
      const nextSpaceByKey: Record<string, string> = {}
      const nextSelectedByKey: Record<string, boolean> = {}
      const nextSaveStateByKey: Record<string, SaveState> = {}
      const nextSubspaceByKey: Record<string, string> = {}
      for (let i = 0; i < json.items.length; i++) {
        const it = json.items[i]
        const key = `${it.name}-${i}`
        if (spaces.length) {
          const inferred = inferAreaForItem({
            spaces,
            suggestedSpaceName: it.suggestedSpaceName,
            suggestedSubspaceName: it.suggestedSubspaceName,
            hint: json.spaceHint ?? undefined,
          })
          nextSpaceByKey[key] = inferred.rootSpaceId
          nextSubspaceByKey[key] = inferred.subspaceName
        } else {
          nextSpaceByKey[key] = ""
          nextSubspaceByKey[key] = (it.suggestedSubspaceName ?? "").trim()
        }
        nextSelectedByKey[key] = true
        nextSaveStateByKey[key] = "idle"
      }
      setItemSpaceByKey(nextSpaceByKey)
      setItemSubspaceByKey(nextSubspaceByKey)
      setItemSelectedByKey(nextSelectedByKey)
      setSaveStateByKey(nextSaveStateByKey)
      setResult(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    } finally {
      setLoading(false)
    }
  }

  async function checkAiHealth() {
    setCheckingHealth(true)
    setHealthMessage(null)
    try {
      const res = await fetch("/api/health/volc", { method: "GET" })
      const json = (await res.json()) as HealthResponse
      if (json.ok) {
        setHealthMessage("VolcEngine connection is healthy. Ready to analyze.")
        return
      }
      const mapped = mapAiError(json.error ?? "")
      setHealthMessage(mapped ?? `Health check failed: ${json.error ?? "UNKNOWN"}`)
    } catch {
      setHealthMessage("Health check failed: cannot reach backend health endpoint.")
    } finally {
      setCheckingHealth(false)
    }
  }

  function onPick(f: File | null) {
    setFile(f)
    setResult(null)
    setError(null)
    setCapturedImageDataUrl(null)
    setAfterImageUrl(null)
    setAfterModel(null)
    setAfterError(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(f ? URL.createObjectURL(f) : null)
  }

  async function generateAfterImage() {
    if (!result) return
    setGeneratingAfter(true)
    setAfterError(null)
    try {
      const res = await fetch("/api/after-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId: householdId || "",
          prompt: result.afterPreview.prompt,
        }),
      })
      const json = (await res.json()) as AfterPreviewResponse
      if (!res.ok || !json.ok) throw new Error("error" in json ? json.error : "AFTER_PREVIEW_FAILED")
      setAfterImageUrl(json.imageDataUrl ?? json.imageUrl ?? null)
      setAfterModel(json.model)
    } catch (e) {
      setAfterError(e instanceof Error ? e.message : "AFTER_PREVIEW_FAILED")
    } finally {
      setGeneratingAfter(false)
    }
  }

  function setItemSelected(key: string, selected: boolean) {
    setItemSelectedByKey((prev) => ({ ...prev, [key]: selected }))
  }

  async function ensureHousehold() {
    if (householdId) return householdId
    const preferredName =
      (result?.spaceHint ?? spaceHint).trim() ? `Home — ${(result?.spaceHint ?? spaceHint).trim()}` : "My Home"
    const res = await fetch("/api/households", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: preferredName }),
    })
    if (res.status === 401) {
      throw new Error("PLEASE_SIGN_IN")
    }
    const json = (await res.json()) as { ok?: boolean; error?: string; household?: { id: string } }
    if (!res.ok || !json.ok || !json.household?.id) {
      throw new Error(json.error ?? "CREATE_HOUSEHOLD_FAILED")
    }
    const createdId = json.household.id
    setHouseholdId(createdId)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set("householdId", createdId)
      router.replace(url.pathname + "?" + url.searchParams.toString())
    } catch {
      // ignore
    }

    const defaultSpaceName = (result?.spaceHint ?? spaceHint).trim() || "Default Space"
    const spaceRes = await fetch("/api/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ householdId: createdId, name: defaultSpaceName, parentId: null }),
    })
    const spaceJson = (await spaceRes.json()) as { ok?: boolean; error?: string }
    if (!spaceRes.ok || !spaceJson.ok) {
      console.warn("[scan] default space create failed", spaceJson)
    }
    await loadSpaces()
    return createdId
  }

  async function saveOneItem(
    key: string,
    item: AnalyzeResult["items"][number],
    overrideSpaceId?: string,
  ) {
    const resolvedHouseholdId = await ensureHousehold()
    const spaceId = (overrideSpaceId ?? itemSpaceByKey[key] ?? "").trim()
    if (!spaceId) {
      throw new Error(`Please select a space for ${item.name} first`)
    }
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        householdId: resolvedHouseholdId,
        spaceId,
        name: item.name,
        imageDataUrl: capturedImageDataUrl ?? undefined,
        category: item.category ?? undefined,
        quantity: typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : undefined,
        unit: item.unit ?? undefined,
        note: item.notes ?? undefined,
      }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? `Save failed: ${item.name}`)
    }
  }

  async function createSpaceByName(name: string, parentId?: string | null) {
    const resolvedHouseholdId = await ensureHousehold()
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Space name is empty, cannot auto-create")
    const existing = spaces.find(
      (s) => normalizeText(s.name) === normalizeText(trimmed) && (s.parentId ?? null) === (parentId ?? null),
    )
    if (existing) return existing.id
    const res = await fetch("/api/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        householdId: resolvedHouseholdId,
        name: trimmed,
        parentId: parentId ?? null,
      }),
    })
    const json = (await res.json()) as CreateSpaceResponse | { ok: false; error: string }
    if (!res.ok || !json.ok) {
      throw new Error(("error" in json ? json.error : null) ?? `Failed to create space: ${trimmed}`)
    }
    setSpaces((prev) => [...prev, { id: json.space.id, name: json.space.name, parentId: parentId ?? null }])
    return json.space.id
  }

  async function resolveSpaceIdForItem(key: string, item: AnalyzeResult["items"][number]) {
    const selectedId = (itemSpaceByKey[key] ?? "").trim()
    if (selectedId) return selectedId
    if (!autoCreateMissingSpaces) return ""
    const candidateName = (item.suggestedSpaceName ?? result?.spaceHint ?? "").trim()
    if (!candidateName) return ""
    const createdId = await createSpaceByName(candidateName)
    setItemSpaceByKey((prev) => ({ ...prev, [key]: createdId }))
    return createdId
  }

  async function resolveFinalSpaceIdForItem(key: string, item: AnalyzeResult["items"][number]) {
    const parentSpaceId = await resolveSpaceIdForItem(key, item)
    if (!parentSpaceId) return ""
    const subspaceName = (itemSubspaceByKey[key] ?? item.suggestedSubspaceName ?? "").trim()
    if (!subspaceName) return parentSpaceId
    const matchedChild = spaces.find(
      (s) => s.parentId === parentSpaceId && normalizeText(s.name) === normalizeText(subspaceName),
    )
    if (matchedChild) return matchedChild.id
    if (!autoCreateMissingSpaces) return parentSpaceId
    return createSpaceByName(subspaceName, parentSpaceId)
  }

  async function saveSelectedItems() {
    if (!result?.items.length) return
    setSavingAll(true)
    setSaveError(null)
    try {
      const resolvedIdByName = new Map<string, string>()
      for (const s of spaces) {
        const key = normalizeText(s.name)
        if (key && !resolvedIdByName.has(key)) resolvedIdByName.set(key, s.id)
      }
      for (let i = 0; i < result.items.length; i++) {
        const item = result.items[i]
        const key = `${item.name}-${i}`
        if (!itemSelectedByKey[key]) continue
        setSaveStateByKey((prev) => ({ ...prev, [key]: "saving" }))
        let resolvedSpaceId = (itemSpaceByKey[key] ?? "").trim()
        if (!resolvedSpaceId) {
          const candidateName = (item.suggestedSpaceName ?? result?.spaceHint ?? "").trim()
          const nameKey = normalizeText(candidateName)
          if (nameKey && resolvedIdByName.has(nameKey)) {
            resolvedSpaceId = resolvedIdByName.get(nameKey) ?? ""
            setItemSpaceByKey((prev) => ({ ...prev, [key]: resolvedSpaceId }))
          } else {
            resolvedSpaceId = await resolveSpaceIdForItem(key, item)
            if (nameKey && resolvedSpaceId) resolvedIdByName.set(nameKey, resolvedSpaceId)
          }
        }
        resolvedSpaceId = await resolveFinalSpaceIdForItem(key, item)
        await saveOneItem(key, item, resolvedSpaceId)
        setSaveStateByKey((prev) => ({ ...prev, [key]: "saved" }))
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "UNKNOWN"
      if (message === "PLEASE_SIGN_IN") {
        setSaveError("Please sign in first to create a household and save items.")
      } else {
        setSaveError(message)
      }
    } finally {
      setSavingAll(false)
    }
  }

  useEffect(() => {
    if (!result?.items.length) return
    if (!spaces.length) return
    const next: Record<string, string> = { ...itemSpaceByKey }
    let changed = false
    for (let i = 0; i < result.items.length; i++) {
      const it = result.items[i]
      const key = `${it.name}-${i}`
      if (next[key]) continue
      const inferred = inferSpaceIdByName(spaces, it.suggestedSpaceName, result.spaceHint ?? undefined)
      if (inferred) {
        next[key] = inferred
        changed = true
      }
    }
    if (changed) setItemSpaceByKey(next)
  }, [itemSpaceByKey, result, spaces])

  useEffect(() => {
    setHouseholdId(sp.get("householdId") ?? "")
  }, [sp])

  useEffect(() => {
    if (!householdId) return
    loadSpaces().catch((e) => {
      setError(e instanceof Error ? e.message : "LOAD_SPACES_FAILED")
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId])

  return (
    <main className="hh-page">
      <div className="hh-topbar">
        <div>
          <h1 className="hh-title">Photo Analysis & Organization Plan</h1>
          <div className="hh-subtitle">
            Upload one room photo to detect items and get actionable organization suggestions.
          </div>
        </div>
        <Link className="hh-link" href="/">
          Back to Home
        </Link>
      </div>

      {!householdId ? (
        <div className="mt-4 rounded-2xl border border-black/10 bg-white/60 px-4 py-3 text-sm text-[color:var(--hh-muted)]">
          You can analyze photos without selecting a household. To save results to inventory, sign in and we’ll
          create a household after analysis.{" "}
          <Link className="hh-link" href="/signin">
            Sign in
          </Link>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <section className="hh-card">
            <div className="hh-card-inner">
              <div className="font-medium">Upload Photo</div>
              <div className="mt-2 text-sm text-[color:var(--hh-muted)]">
                Use one wide photo with as many visible items as possible (for example: fridge,
                cabinets, wardrobe, desk, storage room).
              </div>

              <div className="mt-4 grid gap-3">
                <input
                  className="hh-input"
                  placeholder="Space hint (optional), e.g. kitchen counter / wardrobe / storage room"
                  value={spaceHint}
                  onChange={(e) => setSpaceHint(e.target.value)}
                />

                <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-white/60 px-3 py-2 text-sm">
                  <label className="hh-btn-secondary cursor-pointer px-3 py-1 text-xs">
                    Choose File
                    <input
                      className="hidden"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <span className="truncate text-[color:var(--hh-muted)]">
                    {file?.name ?? "No file selected"}
                  </span>
                </div>

                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="preview"
                    className="w-full rounded-[16px] border border-black/10 bg-white/40 object-cover"
                  />
                ) : (
                  <div className="rounded-[16px] border border-dashed border-black/15 bg-white/40 p-8 text-sm text-[color:var(--hh-muted)]">
                    Select an image to start
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button className="hh-btn-primary disabled:opacity-50" onClick={analyze} disabled={!canSubmit}>
                    {loading ? "Analyzing..." : "Start Analysis"}
                  </button>
                  <button
                    className="hh-btn-secondary"
                    onClick={checkAiHealth}
                    disabled={loading || checkingHealth}
                  >
                    {checkingHealth ? "Checking..." : "Check VolcEngine Connection"}
                  </button>
                  <button className="hh-btn-secondary" onClick={() => onPick(null)} disabled={loading}>
                    Clear
                  </button>
                </div>

                {error ? <div className="text-sm text-red-600">Error: {error}</div> : null}
                {healthMessage ? <div className="text-sm text-[color:var(--hh-muted)]">{healthMessage}</div> : null}
              </div>
            </div>
          </section>

          <section className="hh-card">
            <div className="hh-card-inner">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Analysis Results</div>
                {result?.warnings?.length ? (
                  <div className="text-xs text-[color:var(--hh-muted)]">
                    {result.warnings.length} warning(s)
                  </div>
                ) : null}
              </div>

              {!result ? (
                <div className="mt-3 text-sm text-[color:var(--hh-muted)]">
                  Results appear here: detected items + prioritized organization suggestions.
                </div>
              ) : (
                <div className="mt-4 grid gap-4">
                  <div>
                    <div className="text-sm font-medium">Detected Items ({result.items.length})</div>
                    <div className="mt-2 rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-xs text-[color:var(--hh-muted)]">
                      Select items to save first, then confirm spaces. This list is scrollable.
                    </div>
                    <ul className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1 text-sm">
                      {result.items.map((it, idx) => (
                        <li key={`${it.name}-${idx}`} className="rounded-2xl border border-black/10 bg-white/55 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium">{it.name}</div>
                            <div className="flex flex-wrap gap-2">
                              {it.category ? <span className="hh-chip">{it.category}</span> : null}
                              {typeof it.quantity === "number" ? (
                                <span className="hh-chip">
                                  {it.quantity}
                                  {it.unit ?? ""}
                                </span>
                              ) : null}
                              {typeof it.confidence === "number" ? (
                                <span className="hh-chip">Confidence {Math.round(it.confidence * 100)}%</span>
                              ) : null}
                            </div>
                          </div>
                          {it.notes ? (
                            <div className="mt-1 text-xs text-[color:var(--hh-muted)]">{it.notes}</div>
                          ) : null}
                          {(() => {
                            const key = `${it.name}-${idx}`
                            const saveState = saveStateByKey[key] ?? "idle"
                            return (
                              <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={itemSelectedByKey[key] ?? true}
                                    onChange={(e) => setItemSelected(key, e.target.checked)}
                                  />
                                  Add to household inventory
                                </label>
                                <select
                                  className="hh-select"
                                  value={itemSpaceByKey[key] ?? ""}
                                  onChange={(e) =>
                                    setItemSpaceByKey((prev) => ({ ...prev, [key]: e.target.value }))
                                  }
                                  disabled={saveState === "saved"}
                                >
                                  <option value="">Select a space</option>
                                  {mergedSpaces.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="text-xs text-[color:var(--hh-muted)]">
                                  {saveState === "saved"
                                    ? "Saved"
                                    : it.suggestedSpaceName
                                      ? `AI suggests: ${it.suggestedSpaceName}`
                                      : "No suggested space"}
                                </div>
                              </div>
                            )
                          })()}
                          {it.suggestedSubspaceName ? (
                            <div className="mt-1 text-xs text-[color:var(--hh-muted)]">
                              AI subspace suggestion: {it.suggestedSubspaceName}
                            </div>
                          ) : null}
                          <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr] sm:items-center">
                            <div className="text-xs text-[color:var(--hh-muted)]">Subspace (optional)</div>
                            <input
                              className="hh-input"
                              placeholder="e.g. wardrobe top shelf / left desk side / corner basket"
                              value={itemSubspaceByKey[`${it.name}-${idx}`] ?? ""}
                              onChange={(e) =>
                                setItemSubspaceByKey((prev) => ({
                                  ...prev,
                                  [`${it.name}-${idx}`]: e.target.value,
                                }))
                              }
                              disabled={saveStateByKey[`${it.name}-${idx}`] === "saved"}
                            />
                          </div>
                          {it.suggestedSpaceReason ? (
                            <div className="mt-1 text-xs text-[color:var(--hh-muted)]">
                              Suggested reason: {it.suggestedSpaceReason}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <div className="sticky bottom-0 z-10 mt-3 flex items-center gap-2 rounded-xl border border-black/10 bg-[color:var(--hh-surface-solid)]/95 p-2 backdrop-blur">
                      <button
                        className="hh-btn-primary disabled:opacity-50"
                        onClick={saveSelectedItems}
                        disabled={!selectedItemsCount || savingAll}
                      >
                        {savingAll
                          ? "Saving..."
                          : `Confirm and save selected items (${selectedItemsCount})`}
                      </button>
                      {householdId ? (
                        <Link className="hh-link" href={`/items?householdId=${householdId}`}>
                          Go to Items
                        </Link>
                      ) : (
                        <Link className="hh-link text-xs" href="/signin">
                          Sign in to save
                        </Link>
                      )}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-[color:var(--hh-muted)]">
                      <input
                        type="checkbox"
                        checked={autoCreateMissingSpaces}
                        onChange={(e) => setAutoCreateMissingSpaces(e.target.checked)}
                      />
                      Auto-create AI suggested spaces when no match exists
                    </label>
                    {saveError ? <div className="mt-2 text-sm text-red-600">Error: {saveError}</div> : null}
                  </div>

                  <div>
                    <div className="text-sm font-medium">Organization Suggestions</div>
                    <ul className="mt-2 space-y-2 text-sm">
                      {result.suggestions.map((s, idx) => (
                        <li key={`${s.title}-${idx}`} className="rounded-2xl border border-black/10 bg-white/55 p-3">
                          <div className="grid grid-cols-[1fr_auto] items-start gap-x-3">
                            <div className="font-medium">{s.title}</div>
                            <span className="hh-chip justify-self-end">{s.priority}</span>
                          </div>
                          <div className="mt-1 text-xs text-[color:var(--hh-muted)]">{s.why}</div>
                          <ol className="mt-2 list-decimal pl-5 text-sm">
                            {s.steps.map((step, i) => (
                              <li key={i} className="py-0.5">
                                {step}
                              </li>
                            ))}
                          </ol>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-black/10 bg-white/55 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">After Preview Prompt</div>
                      <div className="flex items-center gap-2">
                        <button
                          className="hh-btn-secondary px-3 py-1 text-xs"
                          onClick={() => navigator.clipboard.writeText(result.afterPreview.prompt)}
                        >
                          Copy Prompt
                        </button>
                        <button
                          className="hh-btn-primary px-3 py-1 text-xs disabled:opacity-50"
                          onClick={generateAfterImage}
                          disabled={generatingAfter}
                        >
                          {generatingAfter ? "Generating..." : "Generate After Image"}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-[color:var(--hh-muted)]">
                      {result.afterPreview.style}
                    </div>
                    <textarea
                      className="hh-textarea mt-2 min-h-28"
                      readOnly
                      value={result.afterPreview.prompt}
                    />
                    <div className="mt-2 text-xs text-[color:var(--hh-muted)]">
                      {result.afterPreview.disclaimer}
                    </div>
                    {afterModel ? (
                      <div className="mt-2 text-xs text-[color:var(--hh-muted)]">Generated by: {afterModel}</div>
                    ) : null}
                    {afterError ? <div className="mt-2 text-xs text-red-600">Error: {afterError}</div> : null}
                    {afterImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={afterImageUrl}
                        alt="After preview"
                        className="mt-3 w-full rounded-[14px] border border-black/10 bg-white/70 object-cover"
                      />
                    ) : null}
                  </div>

                  {result.warnings?.length ? (
                    <div className="rounded-2xl border border-black/10 bg-white/55 p-3 text-xs text-[color:var(--hh-muted)]">
                      <div className="font-medium text-[color:var(--hh-text)]">Warnings</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {result.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>
      </div>
    </main>
  )
}

