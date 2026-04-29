import { NextResponse } from "next/server"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { requireMember } from "@/app/lib/household"
import { prisma } from "@/app/lib/prisma"

const moveSchema = z.object({
  householdId: z.string().min(1),
  toSpaceId: z.string().min(1),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const body = await req.json()
    const input = moveSchema.parse(body)

    const member = await requireMember({
      userId,
      householdId: input.householdId,
      minRole: "MEMBER",
    })

    const result = await prisma.$transaction(async (tx: any) => {
      const item = await tx.item.findFirst({
        where: { id, householdId: input.householdId },
        select: { id: true, spaceId: true },
      })

      if (!item) return { ok: false as const, status: 404 as const }

      const toSpace = await tx.space.findFirst({
        where: { id: input.toSpaceId, householdId: input.householdId },
        select: { id: true },
      })
      if (!toSpace) return { ok: false as const, status: 400 as const }

      await tx.item.update({
        where: { id: item.id },
        data: { spaceId: input.toSpaceId },
        select: { id: true },
      })

      await tx.itemEvent.create({
        data: {
          householdId: input.householdId,
          itemId: item.id,
          actorMemberId: member.id,
          type: "MOVE",
          fromSpaceId: item.spaceId,
          toSpaceId: input.toSpaceId,
        },
        select: { id: true },
      })

      return { ok: true as const }
    })

    if (!result.ok) {
      const status = "status" in result ? result.status : 404
      return NextResponse.json(
        { ok: false, error: status === 400 ? "BAD_REQUEST" : "NOT_FOUND" },
        { status: status === 400 ? 400 : 404 },
      )
    }

    return NextResponse.json({ ok: true })
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

