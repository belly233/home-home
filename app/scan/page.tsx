import { Suspense } from "react"

import { ScanClient } from "./scanClient"

export default function ScanPage() {
  return (
    <Suspense
      fallback={<div className="hh-page text-sm text-[color:var(--hh-muted)]">Loading...</div>}
    >
      <ScanClient />
    </Suspense>
  )
}

