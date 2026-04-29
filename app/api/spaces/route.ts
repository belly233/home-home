import { NextResponse } from "next/server"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { getHouseholdIdFromUrl, requireMember } from "@/app/lib/household"
import { prisma } from "@/app/lib/prisma"

const createSchema = z.object({
  householdId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(40).optional(),
  note: z.string().trim().max(500).optional(),
})

export async function GET(req: Request) {
  try {
    const userId = await requireUserId()
    const householdId = getHouseholdIdFromUrl(req.url)
    await requireMember({ userId, householdId, minRole: "VIEWER" })

    const spaces = await prisma.space.findMany({
      where: { householdId },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
      select: {
        id: true,
        parentId: true,
        name: true,
        type: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ ok: true, spaces })
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

    await requireMember({ userId, householdId: input.householdId, minRole: "MEMBER" })

    const space = await prisma.space.create({
      data: {
        householdId: input.householdId,
        parentId: input.parentId ?? null,
        name: input.name,
        type: input.type,
        note: input.note,
      },
      select: {
        id: true,
        parentId: true,
        name: true,
        type: true,
        note: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ ok: true, space })
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

