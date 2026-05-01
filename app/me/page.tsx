import Link from "next/link"
import { getServerSession } from "next-auth"

import { authOptions } from "@/app/lib/auth"

export const dynamic = "force-dynamic"

export default async function MePage() {
  const session = await getServerSession(authOptions)

  return (
    <main className="hh-page">
      <div className="hh-topbar">
        <div>
          <h1 className="hh-title">My account</h1>
          <div className="hh-subtitle">Session + profile details.</div>
        </div>
        <nav className="flex items-center gap-4">
          <Link className="hh-link" href="/">
            Home
          </Link>
          {session?.user ? (
            <Link className="hh-link" href="/api/auth/signout">
              Sign out
            </Link>
          ) : (
            <Link className="hh-link" href="/signin">
              Sign in
            </Link>
          )}
        </nav>
      </div>

      <section className="hh-card mt-6">
        <div className="hh-card-inner space-y-3 text-sm">
          <div className="font-medium">Status</div>
          {session?.user ? (
            <div className="text-[color:var(--hh-muted)]">Signed in</div>
          ) : (
            <div className="text-[color:var(--hh-muted)]">Signed out</div>
          )}

          <div className="font-medium pt-2">User</div>
          <pre className="max-h-80 overflow-auto rounded-xl border border-black/10 bg-white/70 p-3 text-xs">
            {JSON.stringify(session?.user ?? null, null, 2)}
          </pre>
        </div>
      </section>
    </main>
  )
}

