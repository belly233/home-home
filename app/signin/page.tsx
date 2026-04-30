import Link from "next/link"

import { SignInClient } from "./SignInClient"

const devCredentialsEnabled =
  process.env.AUTH_DEV_CREDENTIALS?.toLowerCase() === "true"

export default function SignInPage() {
  return (
    <main className="hh-page">
      <div className="hh-topbar">
        <div>
          <h1 className="hh-title">Sign in</h1>
          <div className="hh-subtitle">You can start scanning without signing in.</div>
        </div>
        <Link className="hh-link" href="/">
          Back to Home
        </Link>
      </div>

      <div className="mt-6 grid gap-4">
        <section className="hh-card">
          <div className="hh-card-inner space-y-3 text-sm">
            <div className="font-medium">Get started</div>
            <div className="text-[color:var(--hh-muted)]">
              You can analyze a photo right away. If you want to save results to inventory, sign in first.
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className="hh-btn-primary" href="/scan">
                Start scanning
              </Link>
            </div>
            <div className="pt-1">
              <SignInClient />
            </div>
          </div>
        </section>

        {!devCredentialsEnabled ? (
          <section className="hh-card">
            <div className="hh-card-inner space-y-2 text-sm">
              <div className="font-medium">Why the sign-in page can look empty</div>
              <div className="text-[color:var(--hh-muted)]">
                If you haven’t configured Google/Apple yet, you won’t see any provider buttons. For a quick
                dev-only login, enable the built-in credentials provider by setting{" "}
                <code className="rounded bg-black/5 px-1 py-0.5">AUTH_DEV_CREDENTIALS=true</code> in your
                environment variables.
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

