import { z } from "zod"

import { prisma } from "./prisma"

export const householdIdSchema = z.string().min(1)

export async function requireMember(params: {
  userId: string
  householdId: string
  minRole?: "VIEWER" | "MEMBER" | "ADMIN" | "OWNER"
}) {
  const member = await prisma.member.findUnique({
    where: {
      householdId_userId: {
        householdId: params.householdId,
        userId: params.userId,
      },
    },
    select: { id: true, role: true, householdId: true, userId: true },
  })

  if (!member) throw new Error("FORBIDDEN")

  const roleRank: Record<string, number> = {
    VIEWER: 1,
    MEMBER: 2,
    ADMIN: 3,
    OWNER: 4,
  }

  const min = params.minRole ?? "VIEWER"
  if (roleRank[member.role] < roleRank[min]) throw new Error("FORBIDDEN")

  return member
}

export function getHouseholdIdFromUrl(reqUrl: string) {
  const url = new URL(reqUrl)
  const householdId = url.searchParams.get("householdId")
  const parsed = householdIdSchema.safeParse(householdId)
  if (!parsed.success) throw new Error("BAD_REQUEST")
  return parsed.data
}

