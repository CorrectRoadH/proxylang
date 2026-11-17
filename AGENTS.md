<!-- BEGIN CONCORD AGENT INSTRUCTIONS -->
## Concord

This repository uses Concord-driven development. Product contracts, executable test relationships, and engineering memory stay in repository-owned sources.

Before planning, implementing, or reviewing governed work:

- Run `concord --skill` to read the task router from the installed Concord version.
- Run `concord --skill <topic>` for the relevant workflow, where topics include `init`, `document`, `code`, `test`, `memory`, `trace`, `recovery`, `view`, `feedback`.
- Use `concord --skill all` only when the complete offline guide is needed.
- Before changing behavior, read or update the owning Spec and the pages for its actual interface. Run `concord --skill document` for the document model, docs tree and complete examples. Review the prose before using `concord trace gaps --json` to inspect implementation relationships within the task's scope.
- Write contracts as declarations of intended behavior, constraints, and acceptance. Memory holds reusable lessons; development logs, investigation timelines and delivery progress stay in the task handoff. Product workflows remain valid contract content.
- Directly edit files under `docs/` and `memory/`, including relations. Use `concord memory search` and `concord issue search` for search. Use project tools to run tests yourself. Run `concord check` and resolve findings until it passes before declaring completion; an Issue is not a substitute for completing authorized work. Report genuine blockers as unfinished. Do not maintain a manual INDEX.
- For remote Issue writes, run remote preview, obtain explicit user agreement to its authorization string (or its action, target, and payload), then remote apply with `--authorize`; never infer authorization from preview success, tool availability, or permissive access.
- Local issues work without GitHub, Linear, credentials, or connections. Use `concord new issue` for local observations; local operations never authorize remote mutations.
- Directly edit directory-scoped `concepts.md` and `writing.md`; `concord check` validates them. Keep each concept's term, definition and explanation together; only deprecated names become terminology bans.

Follow the returned instructions and the repository's current `docs/taste.md`. A gap result means an explicit Concord relationship is absent; it is not code coverage, and undocumented CLI commands require the product's own inventory. Do not infer completion or test coverage from document structure or command receipts alone.
<!-- END CONCORD AGENT INSTRUCTIONS -->
