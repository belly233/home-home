"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

type Space = {
  id: string
  parentId: string | null
  name: string
  type: string | null
  note: string | null
}

export function SpacesClient() {
  function normalizeText(value: string) {
    return value.toLowerCase().replace(/\s+/g, "")
  }

  function mapSpaceError(error: string) {
    if (error === "SPACE_NOT_EMPTY")
      return "This space still contains items. Move or delete items first."
    return error
  }
  const sp = useSearchParams()
  const householdId = sp.get("householdId") ?? ""
  const parentIdFilter = sp.get("parentId") ?? ""

  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [parentId, setParentId] = useState<string>("")
  const [type, setType] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editParentId, setEditParentId] = useState("")
  const [editType, setEditType] = useState("")
  const [editNote, setEditNote] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchNamesText, setBatchNamesText] = useState("")
  const [batchRenameById, setBatchRenameById] = useState<Record<string, string>>({})

  const parentOptions = useMemo(
    () => [
      { id: "", name: "(No parent)" },
      ...spaces.map((s) => ({ id: s.id, name: s.name })),
    ],
    [spaces],
  )
  const currentParent = useMemo(
    () => spaces.find((s) => s.id === parentIdFilter) ?? null,
    [spaces, parentIdFilter],
  )
  const displayedSpaces = useMemo(
    () => spaces.filter((s) => (parentIdFilter ? s.parentId === parentIdFilter : !s.parentId)),
    [spaces, parentIdFilter],
  )
  const childCountById = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of spaces) {
      if (!s.parentId) continue
      map[s.parentId] = (map[s.parentId] ?? 0) + 1
    }
    return map
  }, [spaces])
  const duplicateGroups = useMemo(() => {
    const map = new Map<string, Space[]>()
    for (const s of displayedSpaces) {
      const key = normalizeText(s.name)
      if (!key) continue
      const arr = map.get(key) ?? []
      arr.push(s)
      map.set(key, arr)
    }
    return Array.from(map.values()).filter((g) => g.length > 1)
  }, [displayedSpaces])

  async function refresh() {
    if (!householdId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/spaces?householdId=${householdId}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "LOAD_FAILED")
      setSpaces(json.spaces ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    } finally {
      setLoading(false)
    }
  }

  async function createSpace() {
    setError(null)
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId,
          name,
          parentId: parentId || null,
          type: type || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "CREATE_FAILED")
      setName("")
      setType("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((v) => v !== id)))
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? displayedSpaces.map((s) => s.id) : [])
  }

  async function createBatchSpaces() {
    const names = Array.from(
      new Set(
        batchNamesText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    )
    if (!names.length) return
    setError(null)
    try {
      for (const n of names) {
        const res = await fetch("/api/spaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ householdId, name: n }),
        })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? `CREATE_FAILED:${n}`)
      }
      setBatchNamesText("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  async function deleteSelectedSpaces() {
    if (!selectedIds.length) return
    if (!window.confirm(`Delete ${selectedIds.length} selected space(s)?`)) return
    setError(null)
    try {
      for (const id of selectedIds) {
        const res = await fetch(`/api/spaces/${id}?householdId=${householdId}`, { method: "DELETE" })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(mapSpaceError(json.error ?? `DELETE_FAILED:${id}`))
      }
      setSelectedIds([])
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  async function saveBatchRename() {
    const entries = selectedIds
      .map((id) => ({ id, name: (batchRenameById[id] ?? "").trim() }))
      .filter((v) => v.name)
    if (!entries.length) return
    setError(null)
    try {
      for (const row of entries) {
        const current = spaces.find((s) => s.id === row.id)
        const res = await fetch(`/api/spaces/${row.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            householdId,
            name: row.name,
            parentId: current?.parentId ?? null,
            type: current?.type ?? null,
            note: current?.note ?? null,
          }),
        })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? `UPDATE_FAILED:${row.id}`)
      }
      setSelectedIds([])
      setBatchRenameById({})
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  async function mergeDuplicateSpaces() {
    if (!duplicateGroups.length) return
    if (!window.confirm(`Merge ${duplicateGroups.length} duplicate group(s) in this level?`)) return
    setError(null)
    try {
      for (const group of duplicateGroups) {
        const keeper = group[0]
        const duplicates = group.slice(1)
        for (const dup of duplicates) {
          // 1) Move items in duplicate space to keeper.
          const itemsRes = await fetch(`/api/items?householdId=${householdId}&spaceId=${dup.id}`, { cache: "no-store" })
          const itemsJson = await itemsRes.json()
          if (!itemsRes.ok || !itemsJson.ok) throw new Error(itemsJson.error ?? "LOAD_ITEMS_FOR_MERGE_FAILED")
          const items = (itemsJson.items ?? []) as Array<{ id: string }>
          for (const item of items) {
            const moveRes = await fetch(`/api/items/${item.id}/move`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ householdId, toSpaceId: keeper.id }),
            })
            const moveJson = await moveRes.json()
            if (!moveRes.ok || !moveJson.ok) throw new Error(moveJson.error ?? `MOVE_FAILED:${item.id}`)
          }

          // 2) Re-parent duplicate's children to keeper.
          const children = spaces.filter((s) => s.parentId === dup.id)
          for (const child of children) {
            const patchRes = await fetch(`/api/spaces/${child.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                householdId,
                name: child.name,
                parentId: keeper.id,
                type: child.type ?? null,
                note: child.note ?? null,
              }),
            })
            const patchJson = await patchRes.json()
            if (!patchRes.ok || !patchJson.ok) throw new Error(patchJson.error ?? `REPARENT_FAILED:${child.id}`)
          }

          // 3) Delete duplicate space.
          const delRes = await fetch(`/api/spaces/${dup.id}?householdId=${householdId}`, { method: "DELETE" })
          const delJson = await delRes.json()
          if (!delRes.ok || !delJson.ok) throw new Error(mapSpaceError(delJson.error ?? `DELETE_FAILED:${dup.id}`))
        }
      }
      setSelectedIds([])
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  function startEdit(space: Space) {
    setEditingId(space.id)
    setEditName(space.name)
    setEditParentId(space.parentId ?? "")
    setEditType(space.type ?? "")
    setEditNote(space.note ?? "")
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    setError(null)
    try {
      const res = await fetch(`/api/spaces/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId,
          name: editName.trim(),
          parentId: editParentId || null,
          type: editType.trim() || null,
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

  async function deleteSpace(id: string) {
    if (!window.confirm("Delete this space? It may fail if items still exist in this space.")) return
    setError(null)
    try {
      const res = await fetch(`/api/spaces/${id}?householdId=${householdId}`, {
        method: "DELETE",
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(mapSpaceError(json.error ?? "DELETE_FAILED"))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  useEffect(() => {
    if (!householdId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId])

  return (
    <main className="hh-page">
      <div className="hh-topbar">
        <div>
          <h1 className="hh-title">Spaces</h1>
          <div className="hh-subtitle">Create space hierarchy and browse items by space</div>
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
            <div className="font-medium">Create Space</div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                className="hh-input"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                className="hh-select"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <input
                className="hh-input"
                placeholder="Type (optional)"
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
            </div>
            <button
              className="mt-3 hh-btn-primary disabled:opacity-50"
              onClick={createSpace}
              disabled={!name.trim()}
            >
              Create
            </button>
            </div>
          </section>

          <section className="mt-6 hh-card">
            <div className="hh-card-inner">
            <div className="flex items-center justify-between">
              <div className="font-medium">Space List</div>
              <div className="flex items-center gap-2">
                <button className="hh-btn-secondary px-3 py-1 text-xs" onClick={refresh}>
                  Refresh
                </button>
                <button
                  className="hh-btn-secondary px-3 py-1 text-xs disabled:opacity-50"
                  onClick={mergeDuplicateSpaces}
                  disabled={!duplicateGroups.length}
                >
                  Merge Duplicates ({duplicateGroups.length} groups)
                </button>
                <button
                  className="hh-btn-secondary px-3 py-1 text-xs disabled:opacity-50"
                  onClick={deleteSelectedSpaces}
                  disabled={!selectedIds.length}
                >
                  Delete Selected ({selectedIds.length})
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-3 rounded-xl border border-black/10 bg-white/50 p-3">
              <div className="text-xs font-medium">Batch Create Spaces (one per line)</div>
              <textarea
                className="hh-textarea min-h-24"
                placeholder={"Bedroom\nLiving Room\nKitchen"}
                value={batchNamesText}
                onChange={(e) => setBatchNamesText(e.target.value)}
              />
              <div>
                <button
                  className="hh-btn-secondary px-3 py-1 text-xs disabled:opacity-50"
                  onClick={createBatchSpaces}
                  disabled={!batchNamesText.trim()}
                >
                  Create in Batch
                </button>
              </div>
            </div>
            {selectedIds.length ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-black/10 bg-white/50 p-3">
                <div className="text-xs font-medium">Batch Rename (name only)</div>
                {selectedIds.map((id) => {
                  const space = displayedSpaces.find((s) => s.id === id) ?? spaces.find((s) => s.id === id)
                  if (!space) return null
                  return (
                    <div key={id} className="grid grid-cols-[120px_1fr] items-center gap-2">
                      <div className="truncate text-xs text-[color:var(--hh-muted)]">{space.name}</div>
                      <input
                        className="hh-input"
                        value={batchRenameById[id] ?? space.name}
                        onChange={(e) =>
                          setBatchRenameById((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                      />
                    </div>
                  )
                })}
                <div>
                  <button className="hh-btn-secondary px-3 py-1 text-xs" onClick={saveBatchRename}>
                    Save Batch Rename
                  </button>
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="mt-3 text-sm text-[color:var(--hh-muted)]">Loading...</div>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex items-center justify-between">
                  <div className="text-xs text-[color:var(--hh-muted)]">
                    {parentIdFilter
                      ? `Current level: ${currentParent?.name ?? "Subspace"}`
                      : "Current level: Top-level spaces"}
                  </div>
                  {parentIdFilter ? (
                    <Link className="hh-link text-xs" href={`/spaces?householdId=${householdId}`}>
                      Back to Top-level
                    </Link>
                  ) : null}
                </li>
                <li className="flex items-center gap-2 text-xs text-[color:var(--hh-muted)]">
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === displayedSpaces.length}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                  />
                  Select all for batch delete/rename
                </li>
                {displayedSpaces.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-4">
                    {editingId === s.id ? (
                      <div className="w-full rounded-2xl border border-black/10 bg-white/60 p-3">
                        <div className="grid gap-2">
                          <input
                            className="hh-input"
                            placeholder="Name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <select
                              className="hh-select"
                              value={editParentId}
                              onChange={(e) => setEditParentId(e.target.value)}
                            >
                              <option value="">(No parent)</option>
                              {spaces
                                .filter((space) => space.id !== s.id)
                                .map((space) => (
                                  <option key={space.id} value={space.id}>
                                    {space.name}
                                  </option>
                                ))}
                            </select>
                            <input
                              className="hh-input"
                              placeholder="Type (optional)"
                              value={editType}
                              onChange={(e) => setEditType(e.target.value)}
                            />
                          </div>
                          <input
                            className="hh-input"
                            placeholder="Note (optional)"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button
                              className="hh-btn-primary disabled:opacity-50"
                              onClick={() => saveEdit(s.id)}
                              disabled={!editName.trim()}
                            >
                              Save
                            </button>
                            <button className="hh-btn-secondary" onClick={() => setEditingId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <label className="mb-1 flex items-center gap-2 text-xs text-[color:var(--hh-muted)]">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(s.id)}
                              onChange={(e) => toggleSelect(s.id, e.target.checked)}
                            />
                            Selected
                          </label>
                          <div className="truncate font-medium">{s.name}</div>
                          <div className="text-xs text-[color:var(--hh-muted)]">
                            {s.type ? `Type: ${s.type}` : "Type not set"}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button className="hh-btn-secondary px-3 py-1 text-xs" onClick={() => startEdit(s)}>
                              Edit
                            </button>
                            <button
                              className="hh-btn-secondary px-3 py-1 text-xs"
                              onClick={() => deleteSpace(s.id)}
                            >
                              Delete
                            </button>
                            {childCountById[s.id] ? (
                              <Link
                                className="hh-btn-secondary px-3 py-1 text-xs"
                                href={`/spaces?householdId=${householdId}&parentId=${s.id}`}
                              >
                                View Subspaces ({childCountById[s.id]})
                              </Link>
                            ) : null}
                          </div>
                        </div>
                        <Link
                          className="hh-link text-xs"
                          href={`/items?householdId=${householdId}&spaceId=${s.id}`}
                        >
                          View Items
                        </Link>
                      </>
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

