import { NextResponse } from "next/server"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { requireMember } from "@/app/lib/household"
import { prisma } from "@/app/lib/prisma"

const patchSchema = z.object({
  householdId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  type: z.string().trim().min(1).max(40).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const body = await req.json()
    const input = patchSchema.parse(body)

    await requireMember({ userId, householdId: input.householdId, minRole: "MEMBER" })

    const updated = await prisma.space.updateMany({
      where: { id, householdId: input.householdId },
      data: {
        parentId: input.parentId ?? undefined,
        name: input.name,
        type: input.type ?? undefined,
        note: input.note ?? undefined,
      },
    })

    if (updated.count === 0) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 })
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

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const url = new URL(req.url)
    const householdId = z.string().min(1).parse(url.searchParams.get("householdId"))

    await requireMember({ userId, householdId, minRole: "MEMBER" })

    const [exists, itemCount] = await prisma.$transaction([
      prisma.space.findFirst({
        where: { id, householdId },
        select: { id: true },
      }),
      prisma.item.count({
        where: { householdId, spaceId: id },
      }),
    ])
    if (!exists) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 })
    }
    if (itemCount > 0) {
      return NextResponse.json(
        { ok: false, error: "SPACE_NOT_EMPTY", itemCount },
        { status: 400 },
      )
    }

    const deleted = await prisma.space.deleteMany({ where: { id, householdId } })
    if (deleted.count === 0) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 })
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

