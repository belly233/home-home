import { NextResponse } from "next/server"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { requireMember } from "@/app/lib/household"
import { prisma } from "@/app/lib/prisma"

const patchSchema = z.object({
  householdId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().max(80).nullable().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  status: z.enum(["IN_USE", "IDLE", "CONSUMABLE", "LENT", "DISPOSED"]).optional(),
  ownerMemberId: z.string().min(1).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})

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

    const item = await prisma.item.findFirst({
      where: { id, householdId },
      select: {
        id: true,
        householdId: true,
        spaceId: true,
        name: true,
        category: true,
        quantity: true,
        unit: true,
        status: true,
        ownerMemberId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { id: true, name: true } } } },
      },
    })

    if (!item) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 })
    }

    return NextResponse.json({
      ok: true,
      item: {
        ...item,
        tagNames: item.tags.map((t: { tag: { name: string } }) => t.tag.name),
      },
    })
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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const body = await req.json()
    const input = patchSchema.parse(body)

    const member = await requireMember({
      userId,
      householdId: input.householdId,
      minRole: "MEMBER",
    })

    const updated = await prisma.$transaction(async (tx: any) => {
      const result = await tx.item.updateMany({
        where: { id, householdId: input.householdId },
        data: {
          name: input.name,
          category: input.category ?? undefined,
          quantity:
            typeof input.quantity === "number"
              ? input.quantity
              : undefined,
          unit: input.unit ?? undefined,
          status: input.status,
          ownerMemberId: input.ownerMemberId ?? undefined,
          note: input.note ?? undefined,
        },
      })

      if (result.count === 0) return { ok: false as const }

      await tx.itemEvent.create({
        data: {
          householdId: input.householdId,
          itemId: id,
          actorMemberId: member.id,
          type: "UPDATE",
          payloadJson: input,
        },
        select: { id: true },
      })

      return { ok: true as const }
    })

    if (!updated.ok) {
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

    const deleted = await prisma.item.deleteMany({ where: { id, householdId } })
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

