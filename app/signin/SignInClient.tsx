"use client"

import { useEffect, useMemo, useState } from "react"

type Provider = { id: string; name: string; type: string; signinUrl?: string }
type ProvidersResponse = Record<string, Provider>

function buildSignInHref(providerId: string) {
  const callbackUrl =
    typeof window !== "undefined" ? window.location.origin : ""
  const url = new URL(`/api/auth/signin/${providerId}`, callbackUrl || "http://localhost")
  url.searchParams.set("callbackUrl", "/")
  return url.pathname + "?" + url.searchParams.toString()
}

export function SignInClient() {
  const [providers, setProviders] = useState<ProvidersResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawText, setRawText] = useState<string | null>(null)
  const [csrfToken, setCsrfToken] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/auth/providers", { cache: "no-store" })
        if (!res.ok) throw new Error("LOAD_PROVIDERS_FAILED")
        const text = await res.text()
        if (!cancelled) setRawText(text)
        const json = JSON.parse(text) as ProvidersResponse
        if (!cancelled) setProviders(json)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "LOAD_PROVIDERS_FAILED")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/auth/csrf", { cache: "no-store" })
        if (!res.ok) return
        const json = (await res.json()) as { csrfToken?: string }
        if (!cancelled) setCsrfToken(json.csrfToken ?? "")
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const providerList = useMemo(() => {
    if (!providers) return []
    return Object.values(providers).filter((p) => p.type !== "email")
  }, [providers])

  const hasCredentials = useMemo(
    () => Boolean(providers && Object.values(providers).some((p) => p.type === "credentials")),
    [providers],
  )

  if (error) {
    return <div className="text-sm text-red-600">Error: {error}</div>
  }

  if (!providers) {
    return <div className="text-sm text-[color:var(--hh-muted)]">Loading sign-in options…</div>
  }

  if (!providerList.length) {
    return (
      <div className="text-sm text-[color:var(--hh-muted)]">
        No authentication providers are enabled yet. Configure Google/Apple env vars on Vercel, then redeploy.
        {rawText ? (
          <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-black/10 bg-white/70 p-3 text-xs">
            {rawText}
          </pre>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        {providerList
          .filter((p) => p.type !== "credentials")
          .map((p) => (
            <a key={p.id} className="hh-btn-secondary" href={buildSignInHref(p.id)}>
              Continue with {p.name}
            </a>
          ))}
      </div>

      {hasCredentials ? (
        <form
          className="grid gap-2 rounded-2xl border border-black/10 bg-white/60 p-3 text-sm"
          method="POST"
          action="/api/auth/callback/credentials"
        >
          <div className="font-medium">Dev credentials</div>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="callbackUrl" value="/" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="hh-input" name="email" type="email" placeholder="Email" required />
            <input className="hh-input" name="name" type="text" placeholder="Name (optional)" />
          </div>
          <button className="hh-btn-primary w-fit" type="submit" disabled={!csrfToken}>
            Sign in
          </button>
          {!csrfToken ? (
            <div className="text-xs text-[color:var(--hh-muted)]">Loading CSRF token…</div>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

