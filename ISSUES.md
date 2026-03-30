# Issue guide

Thanks for filing an issue.

## Before opening one

- confirm you are on the latest commit from `main`
- run `bun run check:all`
- verify your GitHub Copilot auth still works if the report involves generation failures
- confirm whether the problem happens in the library, the `example/` app, or both

## Bug reports should include

- Bun version
- OS and architecture
- package version or commit SHA
- the model you used, if relevant
- the exact prompt or minimal reproduction
- expected behavior
- actual behavior
- relevant logs, warnings, or stack traces

## Feature requests should include

- the user problem you are trying to solve
- why the current API is insufficient
- an example of the proposed API or behavior

## Auth-related issues

If your issue involves authentication, specify whether you used:

- `COPILOT_GITHUB_TOKEN`
- `GH_TOKEN`
- `GITHUB_TOKEN`
- logged-in Copilot / `gh auth`

Do **not** paste secrets into issues.