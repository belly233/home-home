import NextAuth from "next-auth/next"

import { authOptions } from "@/app/lib/auth"

export const runtime = "nodejs"

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }

