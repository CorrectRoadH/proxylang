# Your title

Before writing, read `docs/taste.md` and link each applicable entry ID next to the sentence that relies on it.

This README answers what the feature does and how to start. Write it like a tutorial for the people who use it. Fields, error codes, interface states, and internal mechanisms belong in the detail pages described by `concord --skill document`; link to them instead of repeating them.

## Who It Is For

Describe who uses the feature and the problem it solves for them.

## What You Can Do

List the capabilities in the user's language. Link shared terms to `concepts.md#id`, or define local terms in this directory's `concepts.md`.

## Quick Start

Show one complete path through the main user's actual interface, with the result they see after each action. Run `concord --skill document` for the docs tree and complete examples.

## How It Works

Explain the concepts users must understand. Use Mermaid for structure and an optional `p5` fence for collaboration, state changes, or data flow; keep the conclusion readable without running a sketch. Read `concord --skill view` for examples.

## Scope and Acceptance

State what the feature includes and excludes, and how a reader can confirm it works.

## Pages

- [Library](library.md)
- [CLI](cli.md)
- [API](api.md)
- [Format](format.md)
- [UI](ui.md)
- [Performance](performance.md)
- [Architecture](architecture.md)
- [Data Model](data-model.md)
- [Use Cases](use-case/README.md)
