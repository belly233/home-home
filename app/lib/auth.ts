import type { NextAuthOptions } from "next-auth"
import { getServerSession } from "next-auth/next"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { z } from "zod"

import { prisma } from "./prisma"

const devCredentialsEnabled =
  process.env.AUTH_DEV_CREDENTIALS?.toLowerCase() === "true"

export const authOptions: NextAuthOptions = {
  pages: { signIn: "/signin" },
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    ...(devCredentialsEnabled
      ? [
          CredentialsProvider({
            name: "Dev Credentials",
            credentials: {
              email: { label: "Email", type: "email" },
              name: { label: "Name", type: "text" },
            },
            async authorize(credentials) {
              const parsed = z
                .object({
                  email: z.string().email(),
                  name: z.string().trim().min(1).optional(),
                })
                .safeParse(credentials)

              if (!parsed.success) return null

              const user = await prisma.user.upsert({
                where: { email: parsed.data.email },
                update: { name: parsed.data.name ?? undefined },
                create: {
                  email: parsed.data.email,
                  name: parsed.data.name ?? null,
                },
                select: { id: true, email: true, name: true, image: true },
              })

              return user
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        ;(session.user as { id?: string }).id = token.sub
      }
      return session
    },
  },
}

export function requireUserId() {
  return getServerSession(authOptions).then((session) => {
    const userId = (session?.user as { id?: string } | undefined)?.id
    if (!userId) throw new Error("UNAUTHENTICATED")
    return userId
  })
}

