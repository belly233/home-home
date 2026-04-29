import { NextResponse } from "next/server"

import { requireUserId } from "@/app/lib/auth"
import { prisma } from "@/app/lib/prisma"

export async function GET() {
  try {
    const userId = await requireUserId()

    const households = await prisma.member.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        household: { select: { id: true, name: true, createdAt: true } },
      },
    })

    return NextResponse.json({
      ok: true,
      households: households.map(
        (m: { role: string; household: { id: string; name: string; createdAt: Date } }) => ({
        ...m.household,
        role: m.role,
        }),
      ),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    const status = message === "UNAUTHENTICATED" ? 401 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

