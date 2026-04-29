import { NextResponse } from "next/server"
import { z } from "zod"

import { requireUserId } from "@/app/lib/auth"
import { prisma } from "@/app/lib/prisma"

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export async function POST(req: Request) {
  try {
    const userId = await requireUserId()
    const body = await req.json()
    const input = createSchema.parse(body)

    const created = await prisma.household.create({
      data: {
        name: input.name,
        members: {
          create: {
            userId,
            role: "OWNER",
          },
        },
      },
      select: { id: true, name: true, createdAt: true },
    })

    return NextResponse.json({ ok: true, household: created })
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN"
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "ZodError"
          ? 400
          : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

