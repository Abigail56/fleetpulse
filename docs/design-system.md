# Design system

The components live in `frontend/src/components/ui`, with theme tokens in `frontend/src/app/globals.css`. In development, `/design-system` shows them all; it returns 404 in production.

## Direction

Calm, precise and data-first: thin rules and clear hierarchy, not stacks of shadowed cards. No gradients, glass effects or decorative animation.

- **Colour:** deep teal ink as the primary, with signal amber used sparingly for emphasis. Light and dark themes are both defined, and dark follows the system setting.
- **Type:** Archivo for headings, Public Sans for reading and IBM Plex Mono for data such as plates and labels.
- **Shape:** small radii, 1px borders, no shadows.

The logo mark and palette are proposals and can be replaced by changing `components/layout/logo.tsx`, `app/icon.svg` and the theme tokens.

## Rules

- Status is never shown by colour alone; `StatusBadge` always has a text label.
- Use `ConfirmDialog` before anything hard to undo, and toasts only for confirmations; errors belong next to what caused them.
- Forms use `Field`, which links the label, hint and error for screen readers.
- Show an explicit empty, loading and error state wherever data is fetched.
- Use `ButtonLink` for navigation and `Button` for actions. A control that can't do anything yet shouldn't be on the page.

## Content rules

- No invented customers, testimonials, logos, statistics or prices.
- Anything showing the product with invented data carries a visible label, such as "DEMO · SIMULATED VEHICLE DATA".
- While the product is being built, the site-wide notice stays, and features are described as what FleetPulse is being built to do.
