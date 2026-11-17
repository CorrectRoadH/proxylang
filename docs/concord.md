# Developing with Concord

Follow this project's AGENTS.md and keep the Spec current before changing behavior. Read the guides from the installed Concord version; this page is an entrypoint, not a copy of their workflows.

## Start writing

Run `concord --skill start` with the current request and repository context. Reuse an already stated goal; ask only when a missing decision affects the work.

Run `concord --skill document` for the document model, a docs tree and complete linked examples. Write through the main user's actual interface, choose only the pages needed, and review the prose before adding implementation relations.

## Choose the task

| Task | Guide |
| --- | --- |
| Discover guides | `concord --skill` |
| Set up or configure this repository | `concord --skill init` |
| Write or revise Spec | `concord --skill spec` |
| Implement an agreed Spec | `concord --skill implement` |
| Review changes against Spec | `concord --skill review` |
| Fix a defect | `concord --skill fix` |
| Work with Issue or reusable Memory | `concord --skill feedback` or `concord --skill memory` |

Use each command's `--help` for its current parameters. Keep changes within the task's scope and existing authorization. Run `concord check` after editing; distinguish introduced findings, necessary dependencies and other existing problems.

## Project documents

Start at [the project docs](README.md), [architecture](architecture.md) and [taste](taste.md). Use `concord list` and `concord show` to discover current documents and their relations. Examples in guides illustrate writing; replace them with this project's own requirements.
