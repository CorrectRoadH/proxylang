# Your title

An Issue is a problem that still needs handling. When it is handled, `concord issue close` checks references and atomically deletes this file and its `@issue` markers without running tests; Git keeps the history.

## Observation

Describe the local, reproducible observation without assigning an unverified cause.

## Expected Behavior

For a defect, link the Spec page or anchor whose behavior is not met and state the expected observable result.

## Reproduction

List the smallest repeatable steps, inputs, and resulting output.

## Investigation

Record evidence and remaining hypotheses. Put reusable findings in Memory and link them from the `relations` frontmatter with the `investigation` or `root-cause` role.

For a defect, read `concord --skill fix` and `concord --skill feedback`. The agent uses project tools to validate the fix and reports the actual results. Closing a handled Issue deletes this file; put the reason and validation evidence in the commit message, not a closed-Issue record.
