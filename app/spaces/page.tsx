import { Suspense } from "react"

import { SpacesClient } from "./SpacesClient"

export default function SpacesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-600">Loading...</div>}>
      <SpacesClient />
    </Suspense>
  )
}

