import type { Metadata } from "next"

import "./globals.css"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://your-project.vercel.app"
const ogImage = "/og-cover.png"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AI Home Organization Coach",
  description:
    "Turn messy corners into peaceful spaces with AI-guided home organization plans, shoppable storage recommendations, and realistic after previews.",
  openGraph: {
    title: "AI Home Organization Coach",
    description:
      "Upload a room photo, get a practical organization plan, discover shoppable storage recommendations, and preview the after result with AI.",
    type: "website",
    locale: "en_US",
    url: "/",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: "AI Home Organization Coach",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Home Organization Coach",
    description:
      "From clutter to calm: AI-powered home organization plans, shoppable product suggestions, and after previews.",
    images: [ogImage],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
