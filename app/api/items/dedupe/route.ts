import { NextResponse } from "next/server"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { requireMember } from "@/app/lib/household"
import { prisma } from "@/app/lib/prisma"

const bodySchema = z.object({
  householdId: z.string().min(1),
  dryRun: z.boolean().optional(),
})

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "")
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId()
    const body = bodySchema.parse(await req.json())
    const dryRun = body.dryRun !== false

    const member = await requireMember({
      userId,
      householdId: body.householdId,
      minRole: "MEMBER",
    })

    const items = await prisma.item.findMany({
      where: { householdId: body.householdId },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        householdId: true,
        spaceId: true,
        name: true,
        quantity: true,
        note: true,
        category: true,
        unit: true,
        imageDataUrl: true,
        createdAt: true,
        tags: { select: { tagId: true } },
      },
    })

    const groupsMap = new Map<string, typeof items>()
    for (const item of items) {
      const key = `${item.spaceId}::${normalizeName(item.name)}`
      const arr = groupsMap.get(key) ?? []
      arr.push(item)
      groupsMap.set(key, arr)
    }

    const duplicateGroups = Array.from(groupsMap.values())
      .filter((g) => g.length > 1)
      .map((g: Array<(typeof items)[number]>) => ({
        spaceId: g[0].spaceId,
        normalizedName: normalizeName(g[0].name),
        itemIds: g.map((i: (typeof items)[number]) => i.id),
        itemNames: g.map((i: (typeof items)[number]) => i.name),
      }))

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        groups: duplicateGroups,
        duplicateItems: duplicateGroups.reduce((sum, g) => sum + g.itemIds.length, 0),
      })
    }

    let mergedGroups = 0
    let removedItems = 0
    for (const group of Array.from(groupsMap.values()).filter((g) => g.length > 1)) {
      const keeper = group[0]
      const duplicates = group.slice(1)
      const duplicateIds = duplicates.map((d) => d.id)

      const mergedQuantity = group
        .map((i) =>
          typeof (i.quantity as any)?.toNumber === "function"
            ? (i.quantity as any).toNumber()
            : Number(i.quantity),
        )
        .reduce((acc, v) => acc + v, 0)

      const mergedNote = Array.from(
        new Set(
          group
            .map((i) => i.note?.trim() ?? "")
            .filter(Boolean),
        ),
      ).join("；")

      const mergedCategory =
        keeper.category ?? duplicates.map((d) => d.category).find((v): v is string => Boolean(v)) ?? null
      const mergedUnit = keeper.unit ?? duplicates.map((d) => d.unit).find((v): v is string => Boolean(v)) ?? null
      const mergedImage =
        keeper.imageDataUrl ??
        duplicates.map((d) => d.imageDataUrl).find((v): v is string => Boolean(v)) ??
        null

      const tagIdSet = new Set(group.flatMap((i) => i.tags.map((t) => t.tagId)))
      const existingTagIdSet = new Set(keeper.tags.map((t) => t.tagId))
      const missingTagIds = Array.from(tagIdSet).filter((id) => !existingTagIdSet.has(id))

      await prisma.$transaction(async (tx: any) => {
        await tx.item.update({
          where: { id: keeper.id },
          data: {
            quantity: mergedQuantity,
            note: mergedNote || null,
            category: mergedCategory,
            unit: mergedUnit,
            imageDataUrl: mergedImage,
          },
          select: { id: true },
        })

        if (missingTagIds.length) {
          await tx.itemTag.createMany({
            data: missingTagIds.map((tagId) => ({ itemId: keeper.id, tagId })),
            skipDuplicates: true,
          })
        }

        await tx.itemEvent.create({
          data: {
            householdId: body.householdId,
            itemId: keeper.id,
            actorMemberId: member.id,
            type: "UPDATE",
            toSpaceId: keeper.spaceId,
            payloadJson: {
              action: "DEDUPE_MERGE",
              mergedFromItemIds: duplicateIds,
            },
          },
          select: { id: true },
        })

        await tx.item.deleteMany({
          where: {
            householdId: body.householdId,
            id: { in: duplicateIds },
          },
        })
      })

      mergedGroups += 1
      removedItems += duplicateIds.length
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      mergedGroups,
      removedItems,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
