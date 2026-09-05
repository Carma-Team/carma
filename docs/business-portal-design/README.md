# CARMA Business Web Design Handoff

This directory contains the canonical approved Claude Design sources for the CARMA Business Web.

## Source of truth

Visual implementation must use the current files in this directory as the visual source of truth.

Start by reading:

1. `CARMA Business Portal MVP Handoff Index.dc.html`
2. `CARMA Business Web Style Guide.dc.html`

Then read the relevant feature design before implementing that feature:

- `CARMA Auth & Onboarding.dc.html`
- `CARMA Rewards Management.dc.html`
- `CARMA Voucher Redemption.dc.html`
- `CARMA Business Profile & Branches.dc.html`
- `CARMA Account Settings.dc.html`

Files marked `SUPERSEDED` are not canonical and should not be used for implementation.

## Implementation rules

These `.dc.html` files are design prototypes, not production code.

Recreate the approved visual output using the architecture and technology of the production application.

The existing application remains the source of truth for:

- product behavior
- routing
- permissions
- validation
- API contracts
- business logic

Do not invent backend behavior to satisfy a visual design.

If a design references functionality that does not exist in the product, document it as a separate follow-up issue.

## Shared design system

The canonical `CARMA Business Web Style Guide.dc.html` defines the shared visual language, including:

- typography
- colors
- spacing
- surfaces
- borders and radii
- shared components
- status semantics
- CARMA brand usage
- Hebrew/RTL patterns

Shared production components and tokens should be derived from this guide rather than recreated independently per page.