import { Suspense } from "react"

import { ItemsClient } from "./ItemsClient"

export default function ItemsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-600">Loading...</div>}>
      <ItemsClient />
    </Suspense>
  )
}

