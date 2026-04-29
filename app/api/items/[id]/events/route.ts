import { NextResponse } from "next/server"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { requireMember } from "@/app/lib/household"
import { prisma } from "@/app/lib/prisma"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const url = new URL(req.url)
    const householdId = z.string().min(1).parse(url.searchParams.get("householdId"))

    await requireMember({ userId, householdId, minRole: "VIEWER" })

    const events = await prisma.itemEvent.findMany({
      where: { householdId, itemId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        fromSpaceId: true,
        toSpaceId: true,
        payloadJson: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true, role: true } },
      },
    })

    return NextResponse.json({ ok: true, events })
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN"
          ? 403
          : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

