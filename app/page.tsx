import Link from "next/link"
import { getServerSession } from "next-auth/next"

import { authOptions } from "@/app/lib/auth"
import { Dashboard } from "@/app/ui/Dashboard"

export default async function Page() {
  const session = await getServerSession(authOptions)
  const featureCards = [
    {
      title: "Snap & Understand",
      body: "Take one photo, and AI identifies zones, clutter patterns, and likely root causes.",
    },
    {
      title: "Actionable Plan",
      body: "Get a personalized step-by-step organization plan based on your room and routine.",
    },
    {
      title: "Shop the Setup",
      body: "Discover storage products matched to your budget, style, and space constraints.",
    },
    {
      title: "See the After",
      body: "Preview an AI-generated after image so you can organize with a clear target.",
    },
  ]
  const pricingTiers = [
    {
      name: "Free",
      points: ["1 room analysis / month", "Basic plan", "Watermarked after preview"],
      cta: "Try Free",
      href: "/scan",
    },
    {
      name: "Plus",
      points: [
        "Unlimited room analyses",
        "Full actionable plans",
        "Shoppable product links",
        "HD after previews",
      ],
      cta: "Start Plus",
      href: "/signin",
    },
    {
      name: "Family",
      points: [
        "Multi-room projects",
        "Household collaboration",
        "Shared checklists and progress tracking",
      ],
      cta: "Contact Sales",
      href: "/signin",
    },
  ]
  const faqs = [
    {
      q: "Is this interior design software?",
      a: "Not exactly. It focuses on practical organization: decluttering, storage setup, and maintainable systems.",
    },
    {
      q: "Do I need to buy everything you recommend?",
      a: "No. Recommendations are optional and prioritized by impact, budget, and what you already own.",
    },
    {
      q: "Can renters use it?",
      a: "Yes. You can set renter-friendly constraints like no drilling and no permanent fixtures.",
    },
    {
      q: "Does it work for small apartments?",
      a: "Yes. Small-space optimization is one of the strongest use cases for the current workflow.",
    },
  ]
  const comparisons = [
    {
      title: "Generic tips",
      points: [
        "One-size-fits-all advice",
        "No budget or room constraints",
        "No shopping path",
      ],
    },
    {
      title: "AI Home Organization Coach",
      points: [
        "Room-specific action plan",
        "Budget-aware, renter-friendly setup",
        "Shoppable recommendations plus after preview",
      ],
    },
  ]

  return (
    <main className="hh-page">
      <div className="hh-topbar">
        <div>
          <h1 className="hh-title">AI Home Organization Coach</h1>
          <div className="hh-subtitle">
            Turn messy corners into peaceful, functional spaces.
          </div>
        </div>
        <div>
          {session?.user ? (
            <Link className="hh-link" href="/api/auth/signout">
              Sign out
            </Link>
          ) : (
            <nav className="flex items-center gap-4">
              <a className="hh-link" href="#features">
                Features
              </a>
              <a className="hh-link" href="#pricing">
                Pricing
              </a>
              <a className="hh-link" href="#faq">
                FAQ
              </a>
              <Link className="hh-link" href="/signin">
                Sign in
              </Link>
            </nav>
          )}
        </div>
      </div>

      {session?.user ? (
        <div className="mt-6">
          <Dashboard />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <section className="hh-card">
            <div className="hh-card-inner sm:p-8">
              <p className="hh-chip">AI Home Organization Coach with Shoppable Recommendations</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Turn Messy Corners into Peaceful Spaces.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--hh-muted)] sm:text-base">
                Upload a photo of any room, and our AI analyzes clutter, creates a practical
                step-by-step plan, recommends products you can buy, and generates a realistic
                after preview before you start.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link className="hh-btn-primary" href="/scan">
                  Start with a Photo
                </Link>
                <Link className="hh-btn-secondary" href="/signin">
                  See Demo
                </Link>
              </div>
              <p className="mt-4 text-xs text-[color:var(--hh-muted)]">
                No design skills needed. Works for apartments, family homes, and small spaces.
              </p>
            </div>
          </section>

          <section className="hh-card">
            <div className="hh-card-inner py-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--hh-muted)] sm:text-sm">
                <span className="hh-chip">No credit card required</span>
                <span className="hh-chip">First plan in about 2 minutes</span>
                <span className="hh-chip">Exportable checklist and shopping list</span>
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2" id="features">
            {featureCards.map((card) => (
              <div className="hh-card" key={card.title}>
                <div className="hh-card-inner">
                  <h3 className="text-base font-semibold">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--hh-muted)]">{card.body}</p>
                </div>
              </div>
            ))}
          </section>

          <section className="hh-card">
            <div className="hh-card-inner">
              <h3 className="text-lg font-semibold">How it works</h3>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-[color:var(--hh-muted)]">
                <li>1. Upload your space photo (kitchen, closet, bedroom, or entryway).</li>
                <li>2. Set constraints: budget, timeline, style, renter-friendly requirements.</li>
                <li>3. Follow your guided plan, shop recommendations, and track progress.</li>
              </ol>
            </div>
          </section>

          <section className="hh-card">
            <div className="hh-card-inner">
              <h3 className="text-lg font-semibold">Expected outcomes</h3>
              <div className="mt-3 grid gap-2 text-sm text-[color:var(--hh-muted)] sm:grid-cols-2">
                <p>Estimated space saved: 22%</p>
                <p>Estimated completion time: 3.5 hours</p>
                <p>Recommended budget range: $80-$180</p>
                <p>Priority order: Entryway → Kitchen Counter → Kids Shelf</p>
              </div>
            </div>
          </section>

          <section className="hh-card">
            <div className="hh-card-inner">
              <h3 className="text-lg font-semibold">Why choose us</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {comparisons.map((item) => (
                  <div className="rounded-2xl border border-black/10 bg-white/70 p-4" key={item.title}>
                    <p className="text-base font-semibold">{item.title}</p>
                    <ul className="mt-2 space-y-1 text-sm text-[color:var(--hh-muted)]">
                      {item.points.map((point) => (
                        <li key={point}>- {point}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="hh-card">
            <div className="hh-card-inner" id="pricing">
              <h3 className="text-lg font-semibold">Pricing</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {pricingTiers.map((tier) => (
                  <div className="rounded-2xl border border-black/10 bg-white/70 p-4" key={tier.name}>
                    <p className="text-base font-semibold">{tier.name}</p>
                    <ul className="mt-2 space-y-1 text-sm text-[color:var(--hh-muted)]">
                      {tier.points.map((point) => (
                        <li key={point}>- {point}</li>
                      ))}
                    </ul>
                    <div className="mt-4">
                      <Link className="hh-btn-secondary" href={tier.href}>
                        {tier.cta}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="hh-card">
            <div className="hh-card-inner" id="faq">
              <h3 className="text-lg font-semibold">FAQ</h3>
              <div className="mt-3 space-y-3">
                {faqs.map((item) => (
                  <div key={item.q}>
                    <p className="text-sm font-medium">{item.q}</p>
                    <p className="mt-1 text-sm text-[color:var(--hh-muted)]">{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="hh-card">
            <div className="hh-card-inner">
              <h3 className="text-xl font-semibold">Your calm, organized home starts with one photo.</h3>
              <p className="mt-2 text-sm text-[color:var(--hh-muted)]">
                Start free in minutes and get your first personalized organization plan today.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="hh-btn-primary" href="/scan">
                  Start Free Analysis
                </Link>
                <Link className="hh-btn-secondary" href="/signin">
                  Create My Account
                </Link>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}