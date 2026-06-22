# Product

## Register

product

## Users

Two audiences sharing one system, in pt-BR:

- **Customers (CUSTOMER role)** — small-business owners/operators who hire an AI marketing (and, soon, operational) team. Context: busy, non-technical, on a laptop. Primary jobs: onboard (debrief → confirm a team), chat with the Correspondent to delegate work, and find what the team produced (assets). They are trusting a system to act on their behalf, so they need to always understand what's happening and what's pending.
- **Operators (OWNER/STAFF role)** — Qolmeia platform staff who are the human quality gate. Context: working a queue, deciding fast, switching between many companies. Primary job: review gated agent actions and **approve / reject / request changes** with minimal friction. Speed and confidence of decision is the operator's whole loop.

## Product Purpose

Qolmeia is an AI agency-as-a-product: per-tenant AI agents (Correspondent, Planner, Workers) do real work, and a human operator approves anything outward or hard-to-reverse before it ships. Marketing is the first vertical; the platform is generalizing to others (e.g. Cobrança, per ADR 0009). Success = customers get useful work done with confidence, and operators clear the approval queue quickly and correctly. The approval gate is not overhead — it is the trust mechanism that makes autonomous agents safe, so the decision surfaces are load-bearing product, not admin chrome.

## Brand Personality

Calm, trustworthy, expert. Quiet confidence — a capable agency you hand work to, not flashy software. Warm, human pt-BR voice in copy; restrained and precise in chrome. Nothing should feel risky or toy-like, because the product asks users to trust agents with real actions. Reassurance comes from clarity (you always know the state and the next step), not from decoration.

## Anti-references

- **Generic SaaS dashboard** — interchangeable card grids, gradient accents, big-number hero-metric blocks, icon+heading+text repeated endlessly. The category default; avoid it.
- **Cold enterprise admin tool** — gray dense tables, bureaucratic density, no warmth, intimidating. The backoffice especially must not become this; it carries the calm/expert voice too.

## Design Principles

- **The decision is the product.** Optimize the operator's read → decide → resume loop above all: scannable queue, a decide surface where the proposed action, its context, and the three outcomes (approve / reject / request-changes) are immediately legible. Fewer clicks, less scrolling, no context-hunting.
- **State is always legible.** Customers and operators must never wonder "what is happening / what's pending / what did the team make." Surface agent/ticket/action state plainly; pending and gated items are unmissable.
- **Trust through clarity, not chrome.** Reassurance comes from hierarchy, honest status, and confirmable destructive actions — not gradients, glass, or busy decoration. Calm surfaces read as competent.
- **One focal point per screen.** Resist competing CTAs and dense chrome. The primary task on each screen gets the visual weight; everything else recedes.
- **Human pt-BR voice.** Copy is warm and plain-spoken; errors explain the fix; empty states guide the next step. The interface speaks like a helpful team, the chrome stays quiet.

## Accessibility & Inclusion

WCAG 2.1 AA: body text ≥4.5:1 (including placeholders), large/bold text ≥3:1. Full keyboard support and visible `:focus-visible` rings; focus trap/return on dialogs. `prefers-reduced-motion` honored on every animation. Color is never the only status cue (pair with label/icon — relevant for approval states). pt-BR is the user-facing locale across all surfaces. Touch targets ≥24px (≥44px mobile); inputs ≥16px on mobile.
