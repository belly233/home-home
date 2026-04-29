import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { getHouseholdIdFromUrl, requireMember } from "@/app/lib/household"
import { prisma } from "@/app/lib/prisma"

const createSchema = z.object({
  householdId: z.string().min(1),
  spaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  imageDataUrl: z.string().trim().max(3_000_000).optional(),
  category: z.string().trim().max(80).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().trim().max(20).optional(),
  status: z
    .enum(["IN_USE", "IDLE", "CONSUMABLE", "LENT", "DISPOSED"])
    .optional(),
  ownerMemberId: z.string().min(1).optional(),
  note: z.string().trim().max(1000).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).optional(),
})

export async function GET(req: Request) {
  try {
    const userId = await requireUserId()
    const url = new URL(req.url)
    const householdId = getHouseholdIdFromUrl(req.url)
    await requireMember({ userId, householdId, minRole: "VIEWER" })

    const q = url.searchParams.get("q")?.trim() ?? ""
    const spaceId = url.searchParams.get("spaceId")?.trim() || undefined
    const category = url.searchParams.get("category")?.trim() || undefined

    const items = await prisma.item.findMany({
      where: {
        householdId,
        ...(spaceId ? { spaceId } : {}),
        ...(category ? { category } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { note: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        spaceId: true,
        name: true,
        imageDataUrl: true,
        category: true,
        quantity: true,
        unit: true,
        status: true,
        ownerMemberId: true,
        note: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { tag: { select: { name: true, id: true } } } },
      },
      take: 200,
    })

    return NextResponse.json({
      ok: true,
      items: items.map((i) => ({
        ...i,
        tagNames: i.tags.map((t: { tag: { name: string } }) => t.tag.name),
      })),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN"
          ? 403
          : message === "BAD_REQUEST"
            ? 400
            : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId()
    const body = await req.json()
    const input = createSchema.parse(body)

    const member = await requireMember({
      userId,
      householdId: input.householdId,
      minRole: "MEMBER",
    })

    const tagNames = Array.from(new Set(input.tagNames ?? [])).slice(0, 20)

    const item = await prisma.$transaction(async (tx: any) => {
      const space = await tx.space.findFirst({
        where: { id: input.spaceId, householdId: input.householdId },
        select: { id: true },
      })
      if (!space) throw new Error("BAD_REQUEST")

      const tags = await Promise.all(
        tagNames.map((name) =>
          tx.tag.upsert({
            where: { householdId_name: { householdId: input.householdId, name } },
            update: {},
            create: { householdId: input.householdId, name },
            select: { id: true },
          }),
        ),
      )

      const existing = await tx.item.findFirst({
        where: {
          householdId: input.householdId,
          spaceId: input.spaceId,
          name: { equals: input.name, mode: "insensitive" },
        },
        select: {
          id: true,
          name: true,
          quantity: true,
          category: true,
          unit: true,
          note: true,
          imageDataUrl: true,
          tags: { select: { tagId: true } },
        },
      })

      if (existing) {
        const addQty = new Prisma.Decimal(input.quantity ?? 1)
        const mergedQty = existing.quantity.plus(addQty)
        const mergedNote = [existing.note, input.note]
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join("；")

        const existingTagIdSet = new Set(existing.tags.map((t: { tagId: string }) => t.tagId))
        const missingTagIds = tags
          .map((t: { id: string }) => t.id)
          .filter((id: string) => !existingTagIdSet.has(id))

        await tx.item.update({
          where: { id: existing.id },
          data: {
            quantity: mergedQty,
            category: existing.category ?? input.category,
            unit: existing.unit ?? input.unit,
            note: mergedNote || null,
            imageDataUrl: existing.imageDataUrl ?? input.imageDataUrl,
            tags: missingTagIds.length
              ? { create: missingTagIds.map((tagId) => ({ tagId })) }
              : undefined,
          },
          select: { id: true },
        })

        await tx.itemEvent.create({
          data: {
            householdId: input.householdId,
            itemId: existing.id,
            actorMemberId: member.id,
            type: "UPDATE",
            toSpaceId: input.spaceId,
            payloadJson: {
              action: "MERGE_DUPLICATE_ITEM",
              mergedByName: input.name,
              addQuantity: input.quantity ?? 1,
            },
          },
          select: { id: true },
        })

        return { id: existing.id, merged: true as const }
      }

      const created = await tx.item.create({
        data: {
          householdId: input.householdId,
          spaceId: input.spaceId,
          name: input.name,
          imageDataUrl: input.imageDataUrl,
          category: input.category,
          quantity: new Prisma.Decimal(input.quantity ?? 1),
          unit: input.unit,
          status: input.status ?? "IN_USE",
          ownerMemberId: input.ownerMemberId,
          note: input.note,
          tags: tags.length
            ? { create: tags.map((t: { id: string }) => ({ tagId: t.id })) }
            : undefined,
          events: {
            create: {
              householdId: input.householdId,
              actorMemberId: member.id,
              type: "CREATE",
              toSpaceId: input.spaceId,
              payloadJson: { name: input.name },
            },
          },
        },
        select: { id: true },
      })

      return { ...created, merged: false as const }
    })

    return NextResponse.json({ ok: true, item })
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN"
          ? 403
          : message === "BAD_REQUEST"
            ? 400
            : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

