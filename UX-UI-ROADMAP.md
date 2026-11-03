# Hamlet UX/UI Improvement Roadmap

Reviewed against the current `main` branch on 21 October 2026.

## Audit scope

Static source review of the homepage, members area, member property portfolio, authenticated live listings, main deal pipeline, shared theme stylesheet, mobile compatibility stylesheet, and page standards. This is not a live browser or accessibility test.

## Findings and priorities

### P0 — Visual consistency and mobile clarity
- The members area uses white guide and welcome cards with dark text over the dark animated background, while the pipeline and member portfolio use dark surfaces. This creates an avoidable visual discontinuity and conflicts with Hamlet's established dark interface.
- Shared design tokens exist in `theme.css`, but extensive page-level CSS overrides allow spacing, contrast, card surfaces, and status styles to drift between modules.
- The Kanban board retains a 1,240px minimum width to keep columns usable. On mobile, the list-view route should be easy to find rather than forcing users into a cramped board.

### P1 — Core member journeys
- Make the first screen answer three questions: what is live, which deals need attention, and what is the next action?
- Make property submission progress, draft state, photo upload, validation, and publishing status obvious without changing the existing data model.
- Align property cards and status labels across member portfolios and live listings, while preserving the distinction between public portfolios and member-only resources.
- Keep deadline reminders actionable and linked to their source deal or task.

### P2 — Accessibility and interaction quality
- Validate focus order, keyboard access, touch targets, contrast, reduced-motion behaviour, and screen-reader status announcements across core flows.
- Check mobile navigation, sticky headers, long property details, and form layouts at narrow widths.
- Ensure search and data-driven screens provide clear loading, empty, error, and success states.

### P3 — Measured optimisation
- Establish baseline measures for property submission completion, deal update time, abandoned forms, data completeness, and deadline follow-through.
- Prioritise further work using observed friction rather than adding dashboard metrics that do not change a member's next action.

## Housekeeping progress — 21 October 2026

- **Completed:** Broker Rankings now uses Hamlet's dark workspace palette for the page canvas, panels, filters, ranking cards, empty states and footer. Keyboard focus and reduced-motion styles were added.
- **Completed:** Members Area guidance cards, authentication shell, security note and sidebar menu now follow the dark palette. Focus visibility and reduced-motion support were added. The floating shortcut remains labelled **Open Broker Rankings** and points to `/rankings.html`.
- **Reviewed:** Live Commercial Property Listings responsive rules and focus/reduced-motion support. Active property cards and the broker review panel intentionally retain their light surfaces; they were left unchanged to avoid undoing prior presentation decisions.
- **Not yet verified:** Live browser rendering, end-to-end keyboard/screen-reader behaviour, mobile device testing, and post-deployment checks. These should be treated as outstanding rather than assumed successful.

## Housekeeping progress — 21 October 2026

- **Completed:** Broker Rankings dark palette and accessibility-focused styling.
- **Completed:** Members Area guide cards, authentication shell, security note and sidebar now use the dark palette; the floating shortcut remains labelled **Open Broker Rankings** and links to `/rankings.html`.
- **Reviewed:** Live Commercial Property Listings; active listing cards and the broker review panel intentionally retain their light surfaces.
- **Completed:** Shared navigation now has 44px minimum targets, explicit keyboard-focus outlines and touch-friendly horizontal scrolling.
- **Completed:** Deal Pipeline source review. Existing mobile list layout, authentication guard, deadline logic and deal persistence were preserved.
- **Completed:** Property experience styling pass on live listings and public member portfolios. Added clear keyboard focus, minimum touch targets and more consistent loading/error text treatment without changing listing data, filters, Firestore queries, or sustainability claims.
- **Completed:** Dashboard/workflow pass: each item in the Next Actions panel now has a **Review** control that scrolls to and keyboard-focuses its corresponding critical-path reminder. Responsive styling keeps the action usable on narrow screens; reduced-motion preferences are respected. Deal/reminder records, due-date calculations, authentication and persistence are unchanged.
- **Not yet verified:** Live browser rendering, end-to-end keyboard/screen-reader behaviour, mobile device testing and post-deployment checks remain outstanding.

## Incremental delivery plan

1. **Verification pass:** inspect diffs, validate HTML/CSS structure, and run available repository checks; manually verify deployed pages where browser access is available.

## Safety boundaries

- Do not modify Firebase Authentication, Firestore security rules, storage permissions, transaction history, reminder delivery, or deal persistence as part of a visual-only change.
- Do not present member-entered sustainability claims as independently certified.
- Preserve public portfolio access without sign-in and existing member-only access controls for private workspace resources.
- Review changes for unintended functional effects before publishing.
