"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

type Item = {
  id: string
  spaceId: string
  name: string
  imageDataUrl?: string | null
  category: string | null
  quantity: string
  unit: string | null
  status: string
  note: string | null
  tagNames?: string[]
}

type Space = { id: string; name: string }

type SpacesResponse = { ok: true; spaces: Array<{ id: string; name: string }> }
type DedupeDryRunResponse = {
  ok: true
  dryRun: true
  groups: Array<{ spaceId: string; normalizedName: string; itemIds: string[]; itemNames: string[] }>
  duplicateItems: number
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "")
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

export function ItemsClient() {
  const sp = useSearchParams()
  const householdId = sp.get("householdId") ?? ""
  const spaceIdFilter = sp.get("spaceId") ?? ""

  const [q, setQ] = useState("")
  const [items, setItems] = useState<Item[]>([])
  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [spaceId, setSpaceId] = useState(spaceIdFilter)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [editStatus, setEditStatus] = useState("IN_USE")
  const [editNote, setEditNote] = useState("")
  const [moveSpaceIdByItem, setMoveSpaceIdByItem] = useState<Record<string, string>>({})
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [batchCreateNamesText, setBatchCreateNamesText] = useState("")
  const [batchRenameById, setBatchRenameById] = useState<Record<string, string>>({})
  const [dedupeReport, setDedupeReport] = useState<DedupeDryRunResponse | null>(null)
  const [dedupeLoading, setDedupeLoading] = useState(false)

  const spaceOptions = useMemo(
    () => [{ id: "", name: "Select a space" }, ...dedupeSpacesByName(spaces)],
    [spaces],
  )
  const mergedSpaces = useMemo(() => dedupeSpacesByName(spaces), [spaces])

  async function loadSpaces() {
    const res = await fetch(`/api/spaces?householdId=${householdId}`, {
      cache: "no-store",
    })
    const json = (await res.json()) as SpacesResponse | { ok: false; error: string }
    if (!res.ok || !json.ok)
      throw new Error(("error" in json ? json.error : null) ?? "LOAD_SPACES_FAILED")
    setSpaces((json.spaces ?? []).map((s) => ({ id: s.id, name: s.name })))
  }

  async function refresh() {
    if (!householdId) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ householdId })
      if (q.trim()) params.set("q", q.trim())
      if (spaceIdFilter) params.set("spaceId", spaceIdFilter)

      const res = await fetch(`/api/items?${params.toString()}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "LOAD_FAILED")
      setItems(json.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    } finally {
      setLoading(false)
    }
  }

  async function createItem() {
    setError(null)
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId,
          spaceId,
          name,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "CREATE_FAILED")
      setName("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  function toggleSelectItem(id: string, checked: boolean) {
    setSelectedItemIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((v) => v !== id)))
  }

  function toggleSelectAllItems(checked: boolean) {
    setSelectedItemIds(checked ? items.map((i) => i.id) : [])
  }

  async function createBatchItems() {
    const names = Array.from(
      new Set(
        batchCreateNamesText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    )
    if (!names.length || !spaceId) return
    setError(null)
    try {
      for (const n of names) {
        const res = await fetch("/api/items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ householdId, spaceId, name: n }),
        })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? `CREATE_FAILED:${n}`)
      }
      setBatchCreateNamesText("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  async function deleteSelectedItems() {
    if (!selectedItemIds.length) return
    if (!window.confirm(`Delete ${selectedItemIds.length} selected item(s)?`)) return
    setError(null)
    try {
      for (const id of selectedItemIds) {
        const res = await fetch(`/api/items/${id}?householdId=${householdId}`, { method: "DELETE" })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? `DELETE_FAILED:${id}`)
      }
      setSelectedItemIds([])
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  async function saveBatchRenameItems() {
    const rows = selectedItemIds
      .map((id) => ({ id, name: (batchRenameById[id] ?? "").trim() }))
      .filter((v) => v.name)
    if (!rows.length) return
    setError(null)
    try {
      for (const row of rows) {
        const current = items.find((i) => i.id === row.id)
        if (!current) continue
        const res = await fetch(`/api/items/${row.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            householdId,
            name: row.name,
            category: current.category,
            status: current.status,
            note: current.note,
          }),
        })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? `UPDATE_FAILED:${row.id}`)
      }
      setSelectedItemIds([])
      setBatchRenameById({})
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  async function checkDuplicateItems() {
    setDedupeLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/items/dedupe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ householdId, dryRun: true }),
      })
      const json = (await res.json()) as DedupeDryRunResponse | { ok: false; error: string }
      if (!res.ok || !json.ok) throw new Error("error" in json ? json.error : "DEDUPE_CHECK_FAILED")
      setDedupeReport(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    } finally {
      setDedupeLoading(false)
    }
  }

  async function mergeDuplicateItems() {
    if (!dedupeReport?.groups.length) return
    if (!window.confirm(`Merge ${dedupeReport.groups.length} duplicate group(s)?`)) return
    setDedupeLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/items/dedupe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ householdId, dryRun: false }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? "DEDUPE_MERGE_FAILED")
      await refresh()
      await checkDuplicateItems()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    } finally {
      setDedupeLoading(false)
    }
  }

  async function deleteItem(id: string) {
    if (!window.confirm("Delete this item?")) return
    setError(null)
    try {
      const res = await fetch(`/api/items/${id}?householdId=${householdId}`, {
        method: "DELETE",
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "DELETE_FAILED")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  function startEdit(item: Item) {
    setEditingId(item.id)
    setEditName(item.name)
    setEditCategory(item.category ?? "")
    setEditStatus(item.status)
    setEditNote(item.note ?? "")
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    setError(null)
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId,
          name: editName.trim(),
          category: editCategory.trim() || null,
          status: editStatus,
          note: editNote.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "UPDATE_FAILED")
      setEditingId(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  async function moveItem(id: string) {
    const toSpaceId = moveSpaceIdByItem[id]
    if (!toSpaceId) return
    setError(null)
    try {
      const res = await fetch(`/api/items/${id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ householdId, toSpaceId }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "MOVE_FAILED")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  const spaceNameById = useMemo(
    () =>
      spaces.reduce<Record<string, string>>((acc, s) => {
        acc[s.id] = s.name
        return acc
      }, {}),
    [spaces],
  )

  useEffect(() => {
    if (!householdId) return
    ;(async () => {
      try {
        await loadSpaces()
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "UNKNOWN")
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, spaceIdFilter])

  return (
    <main className="hh-page">
      <div className="hh-topbar">
        <div>
          <h1 className="hh-title">Items</h1>
          <div className="hh-subtitle">Create, search, and manage your items</div>
        </div>
        <Link className="hh-link" href="/">
          Back to Home
        </Link>
      </div>

      {!householdId ? (
        <div className="mt-6 hh-card">
          <div className="hh-card-inner text-sm">
          Missing `householdId`. Select a household from Home first.
          </div>
        </div>
      ) : (
        <>
          <section className="mt-6 hh-card">
            <div className="hh-card-inner">
            <div className="font-medium">Create Item</div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                className="hh-input sm:col-span-2"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                className="hh-select"
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
              >
                {spaceOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="mt-3 hh-btn-primary disabled:opacity-50"
              onClick={createItem}
              disabled={!name.trim() || !spaceId}
            >
              Create
            </button>
            <div className="mt-3 grid gap-2 rounded-xl border border-black/10 bg-white/50 p-3">
              <div className="text-xs font-medium">Batch Create Items (one per line)</div>
              <textarea
                className="hh-textarea min-h-24"
                placeholder={"T-shirts\nJeans\nSocks"}
                value={batchCreateNamesText}
                onChange={(e) => setBatchCreateNamesText(e.target.value)}
              />
              <div className="text-xs text-[color:var(--hh-muted)]">
                Batch creation uses the selected target space above.
              </div>
              <div>
                <button
                  className="hh-btn-secondary px-3 py-1 text-xs disabled:opacity-50"
                  onClick={createBatchItems}
                  disabled={!batchCreateNamesText.trim() || !spaceId}
                >
                  Create in Batch
                </button>
              </div>
            </div>
            </div>
          </section>

          <section className="mt-6 hh-card">
            <div className="hh-card-inner">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-medium">Item List</div>
              <div className="flex gap-2">
                <input
                  className="hh-input w-56"
                  placeholder="Search (name/note)"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <button className="hh-btn-secondary" onClick={refresh}>
                  Search
                </button>
                <Link
                  className="hh-btn-secondary"
                  href={`/spaces?householdId=${householdId}`}
                >
                  Spaces
                </Link>
                <button className="hh-btn-secondary disabled:opacity-50" onClick={checkDuplicateItems} disabled={dedupeLoading}>
                  {dedupeLoading ? "Checking..." : "Check Duplicates"}
                </button>
                <button
                  className="hh-btn-secondary disabled:opacity-50"
                  onClick={mergeDuplicateItems}
                  disabled={dedupeLoading || !dedupeReport?.groups.length}
                >
                  Merge Duplicates ({dedupeReport?.groups.length ?? 0} groups)
                </button>
                <button
                  className="hh-btn-secondary disabled:opacity-50"
                  onClick={deleteSelectedItems}
                  disabled={!selectedItemIds.length}
                >
                  Delete Selected ({selectedItemIds.length})
                </button>
              </div>
            </div>
            {dedupeReport ? (
              <div className="mt-3 rounded-xl border border-black/10 bg-white/50 p-3 text-xs">
                <div className="font-medium">
                  Duplicate check: {dedupeReport.groups.length} groups, {dedupeReport.duplicateItems} items involved
                </div>
                {dedupeReport.groups.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[color:var(--hh-muted)]">
                    {dedupeReport.groups.slice(0, 8).map((g, idx) => (
                      <li key={`${g.spaceId}-${g.normalizedName}-${idx}`}>
                        {g.itemNames.join(" / ")}
                      </li>
                    ))}
                    {dedupeReport.groups.length > 8 ? (
                      <li>... and {dedupeReport.groups.length - 8} more groups</li>
                    ) : null}
                  </ul>
                ) : (
                  <div className="mt-1 text-[color:var(--hh-muted)]">No duplicates found.</div>
                )}
              </div>
            ) : null}
            {selectedItemIds.length ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-black/10 bg-white/50 p-3">
                <div className="text-xs font-medium">Batch Rename (name only)</div>
                {selectedItemIds.map((id) => {
                  const item = items.find((v) => v.id === id)
                  if (!item) return null
                  return (
                    <div key={id} className="grid grid-cols-[120px_1fr] items-center gap-2">
                      <div className="truncate text-xs text-[color:var(--hh-muted)]">{item.name}</div>
                      <input
                        className="hh-input"
                        value={batchRenameById[id] ?? item.name}
                        onChange={(e) =>
                          setBatchRenameById((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                      />
                    </div>
                  )
                })}
                <div>
                  <button className="hh-btn-secondary px-3 py-1 text-xs" onClick={saveBatchRenameItems}>
                    Save Batch Rename
                  </button>
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="mt-3 text-sm text-[color:var(--hh-muted)]">Loading...</div>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex items-center gap-2 text-xs text-[color:var(--hh-muted)]">
                  <input
                    type="checkbox"
                    checked={selectedItemIds.length > 0 && selectedItemIds.length === items.length}
                    onChange={(e) => toggleSelectAllItems(e.target.checked)}
                  />
                  Select all for batch delete/rename
                </li>
                {items.map((i) => (
                  <li key={i.id} className="rounded-2xl border border-black/10 bg-white/55 p-3">
                    {editingId === i.id ? (
                      <div className="grid gap-2">
                        <input
                          className="hh-input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                        />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            className="hh-input"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            placeholder="Category (optional)"
                          />
                          <select
                            className="hh-select"
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                          >
                            <option value="IN_USE">IN_USE</option>
                            <option value="IDLE">IDLE</option>
                            <option value="CONSUMABLE">CONSUMABLE</option>
                            <option value="LENT">LENT</option>
                            <option value="DISPOSED">DISPOSED</option>
                          </select>
                        </div>
                        <input
                          className="hh-input"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder="Note (optional)"
                        />
                        <div className="flex gap-2">
                          <button
                            className="hh-btn-primary disabled:opacity-50"
                            onClick={() => saveEdit(i.id)}
                            disabled={!editName.trim()}
                          >
                            Save
                          </button>
                          <button className="hh-btn-secondary" onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        <label className="flex items-center gap-2 text-xs text-[color:var(--hh-muted)]">
                          <input
                            type="checkbox"
                            checked={selectedItemIds.includes(i.id)}
                            onChange={(e) => toggleSelectItem(i.id, e.target.checked)}
                          />
                          Selected
                        </label>
                        <div className="grid grid-cols-[64px_1fr_auto] items-start gap-3">
                          <div className="h-16 w-16 overflow-hidden rounded-xl border border-black/10 bg-white/70">
                            {i.imageDataUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={i.imageDataUrl} alt={i.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-[color:var(--hh-muted)]">
                                No image
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{i.name}</div>
                            <div className="mt-1 text-xs text-[color:var(--hh-muted)]">
                              Space: {spaceNameById[i.spaceId] ?? i.spaceId} · status: {i.status}
                            </div>
                            {i.tagNames?.length ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {i.tagNames.map((t) => (
                                  <span key={t} className="hh-chip">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <Link
                            className="hh-link text-xs"
                            href={`/api/items/${i.id}/events?householdId=${householdId}`}
                          >
                            events(JSON)
                          </Link>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button className="hh-btn-secondary px-3 py-1 text-xs" onClick={() => startEdit(i)}>
                            Edit
                          </button>
                          <button
                            className="hh-btn-secondary px-3 py-1 text-xs"
                            onClick={() => deleteItem(i.id)}
                          >
                            Delete
                          </button>
                          <select
                            className="hh-select w-44"
                            value={moveSpaceIdByItem[i.id] ?? ""}
                            onChange={(e) =>
                              setMoveSpaceIdByItem((prev) => ({ ...prev, [i.id]: e.target.value }))
                            }
                          >
                            <option value="">Move to space</option>
                            {mergedSpaces
                              .filter((s) => s.id !== i.spaceId)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                          </select>
                          <button
                            className="hh-btn-secondary px-3 py-1 text-xs disabled:opacity-50"
                            onClick={() => moveItem(i.id)}
                            disabled={!moveSpaceIdByItem[i.id]}
                          >
                            Move
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {error ? (
              <div className="mt-3 text-sm text-red-600">Error: {error}</div>
            ) : null}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

