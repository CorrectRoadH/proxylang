# Your title

## User Goal

State who wants what and why, in the user's language. Every step must advance this goal; independent goals belong in separate Use Cases. Run `concord --skill document` for the docs tree and complete examples.

## Starting State

List what must already be true: configuration, existing documents, data, and any readiness condition needed to perform the journey.

## Complete Path

Write one numbered item per user action that shows how to meet the need. Use the actual interface: UI actions, commands, calls, or a combination with external tools. Show what the user observes at each step; label results as expected until verified. End the first paragraph of each item with a stable step ID such as `{#run-red}` so tests and code can point at that step.

When external tools participate, state their prerequisites, what data or entrypoint the product hands over, and how the user continues. Verify external commands and guarantees against authoritative documentation. Distinguish each party's responsibility and visible failures; do not turn an internal dependency choice into a user step.

For interactive explanations, an optional `p5` fence can show the process. State the initial conditions and expected observation in prose. Sketches load and play automatically; describe controls only for an interactive experiment. Animation does not replace acceptance evidence. Keep Mermaid for static flows and read `concord --skill view` for p5 authoring and project library configuration.

## Result

Describe how the user confirms that the need is met, where to observe that result, and what would fail acceptance. Check relevant side effects such as persisted data, messages, or released resources alongside the visible result. Describe visible failures and their triggers; include error codes and real output when the interface provides them.

For retries, cancellation, concurrency, or recovery, describe the applicable failure paths, termination conditions, and state retained after failure. Reuse the steps and result table; link shared guarantees instead of maintaining a second checklist. Verification setup and cleanup belong in the project's Engineering pages.

## Contract Sources

Link only to existing pages that own the CLI, API, or architecture rules used by this path. Do not redefine those rules here. Implementation belongs in the architecture page, not here.
