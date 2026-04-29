"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

type Household = { id: string; name: string; role: string; createdAt: string }

export function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [households, setHouseholds] = useState<Household[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [activeHouseholdId, setActiveHouseholdId] = useState<string | null>(null)

  const active = useMemo(() => {
    if (!households.length) return null
    const fromStored = activeHouseholdId
      ? households.find((h) => h.id === activeHouseholdId) ?? null
      : null
    return fromStored ?? households[0]
  }, [households, activeHouseholdId])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/households/me", { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "LOAD_FAILED")
      setHouseholds(json.households ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    } finally {
      setLoading(false)
    }
  }

  async function createHousehold() {
    setError(null)
    try {
      const res = await fetch("/api/households", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? "CREATE_FAILED")
      setNewName("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "UNKNOWN")
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem("activeHouseholdId")
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setActiveHouseholdId(stored)
    } catch {
      // ignore
    }
  }, [])

  function selectActive(id: string) {
    setActiveHouseholdId(id)
    try {
      localStorage.setItem("activeHouseholdId", id)
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4">
      <section className="hh-card">
        <div className="hh-card-inner">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-medium">My Households</div>
          <div className="flex gap-2">
            <input
              className="hh-input w-56"
              placeholder="New household name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              className="hh-btn-primary disabled:opacity-50"
              onClick={createHousehold}
              disabled={!newName.trim()}
            >
              Create
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-3 text-sm text-[color:var(--hh-muted)]">Loading...</div>
        ) : households.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {households.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate font-medium">{h.name}</div>
                  <div className="text-xs text-[color:var(--hh-muted)]">
                    role: {h.role} · id: {h.id}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    className="hh-btn-secondary px-3 py-1 text-xs"
                    onClick={() => selectActive(h.id)}
                  >
                    {active?.id === h.id ? "Current" : "Select"}
                  </button>
                  <div className="text-xs text-[color:var(--hh-muted)]">
                    {new Date(h.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 text-sm text-[color:var(--hh-muted)]">
            No household yet. Create one to get started.
          </div>
        )}

        {error ? (
          <div className="mt-3 text-sm text-red-600">Error: {error}</div>
        ) : null}
        </div>
      </section>

      <section className="hh-card">
        <div className="hh-card-inner">
        <div className="font-medium">Next Steps</div>
        <div className="mt-2 text-sm text-[color:var(--hh-muted)]">
          {active ? (
            <div className="space-y-2">
              <div>
                Selected household: {active.name} ({active.id})
              </div>
              <div className="flex gap-3">
                <Link className="hh-link" href={`/spaces?householdId=${active.id}`}>
                  Manage Spaces
                </Link>
                <Link className="hh-link" href={`/items?householdId=${active.id}`}>
                  Manage Items
                </Link>
                <Link className="hh-link" href={`/scan?householdId=${active.id}`}>
                  Analyze Photo
                </Link>
              </div>
            </div>
          ) : (
            "Create a household to start adding spaces and items."
          )}
        </div>
        </div>
      </section>
    </div>
  )
}

