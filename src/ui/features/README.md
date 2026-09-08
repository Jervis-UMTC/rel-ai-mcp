# Dashboard feature structure

The dashboard uses a feature-first React structure. Each user-facing capability owns its route component and feature-specific implementation details under this directory. Backend projections and the canonical dashboard store remain outside feature presentation code.

## Feature boundaries

- `home/` owns the Overview experience and its presentation model.
- `sessions/` owns Tasks/Sessions history, live task presentation, and inspector behavior.
- `workspaces/` owns Projects/Workspaces cards, forms, repair/delete flows, recents, and project-specific navigation.
- `activity/` owns activity history, filters, stable event-row presentation, and its inspector.
- `code/` owns the read-only Changes/Monaco route.
- `processes/` owns managed-process presentation and controls.
- `tools/` owns the tool catalog/reference route.
- `usage/` owns local analytics/usage presentation and range models.
- `settings/` owns application preference/configuration panels and the current Troubleshooting/Diagnostics React implementation used by the System destination.
- `onboarding/` owns browser onboarding state and desktop handoff helpers used by Overview.
- `system/` currently owns shared styling for the System navigation surfaces; the concrete System destinations are the React-owned Processes, Diagnostics, Tools, and Usage routes.

Cross-feature infrastructure remains in `src/ui/`: routing, API access, canonical store state, SSE delivery, interaction safety, preferences, and connection state. The React shell and top-level route registry live in `src/ui/react/main.js`. Reusable visual/interaction primitives remain in `src/ui/components/`.

## State and live-update rules

- React renders dashboard routes; do not add a second imperative feature renderer beside a React route.
- Backend/API projection remains authoritative for backend state and lifecycle decisions.
- `src/ui/store.js` is canonical client state and is revision-aware. Features consume the store; they do not maintain competing copies of server state.
- `src/ui/events.js` owns the dashboard SSE connection. Do not create feature-specific `EventSource` instances.
- Keep unsaved form values, open/closed controls, selection, and similar UI-only state local to the owning feature when possible.
- Use stable domain identifiers for live lists. Do not use array indexes where inserts/updates would destroy unrelated rows.

## Rules for new UI code

1. Add user-facing behavior to the feature that owns it; do not create another generic `sections` or `pages` directory.
2. Keep imports between features explicit. Move logic to shared infrastructure only when at least two features require the same stable behavior.
3. Put feature-only CSS beside the feature and import it from `src/ui/styles/app.css`.
4. Use Tailwind utilities for layout, spacing, and responsive composition. Use named component classes for product-specific states and semantics.
5. Register a new top-level route in `src/ui/react/main.js` only when the product actually exposes that route.
6. Preserve accessibility contracts: semantic navigation/current state, keyboard operation, focus restoration/containment, live announcements, reduced motion, forced colors, and responsive reachability.
7. Desktop-only authority must use the approved preload bridge (`window.relaiDesktop`); feature code must not import Electron or expose new privileged renderer behavior without an IPC contract.
8. Add focused tests for the feature/model/store boundary that changed and browser/Electron acceptance only where the real interaction crosses those boundaries.
9. Keep `public/dashboard-app.js`, `public/dashboard-react.js`, `public/dashboard.css`, and `public/dashboard-chunks/` generated. Edit source under `src/ui/` or the production dashboard entry, then run `npm run build:frontend` and `npm run verify:generated`.
