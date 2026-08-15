# Development Workflow

> Status: Current for the public repository.

AgentLimb is developed in short, verifiable increments. A change is not considered complete merely because the extension loads: it needs focused automated coverage, a packaged runtime check when it affects installation, and manual browser validation when it crosses the Chrome boundary.

## 1. Define the behavioral boundary

Start with a concise statement of the user-visible outcome, the affected modules, and what must not change. Browser actions, local Bridge behavior, installer behavior, and stored muscle data have different safety properties, so their validation should remain separate.

When a change introduces a new workflow, document the decision in this directory or update the relevant current document. Keep design intent adjacent to the code that enforces it.

## 2. Implement against the public source tree

The public source lives at the repository root:

```text
kernel/     Browser control, prompt generation, Bridge, CLI, and muscle runtime
ui/         Side panel and options UI
scripts/    macOS and Windows installation and release tooling
tests/      Node.js regression tests
website/    Static public site
```

Local worktrees, build output, credentials, test records, and private references belong under `忽略上传/`, which is ignored as a whole. Do not add machine-specific paths, account data, tokens, or raw browser records to public source or documentation.

## 3. Verify locally

Run the focused test first, then the full suite before handing off a change:

```bash
npm test
node scripts/build-release.mjs 0.2.1
git diff --check
```

The release builder creates the Chrome package and `SHA256SUMS.txt` under `忽略上传/dist/`. The Chrome package is the single user-facing artifact; the onboarding prompt bootstraps the platform runtime from the fixed public source tag after explicit approval. Inspect the archive after packaging or installation changes. It must not contain `website/`, `忽略上传/`, local archives, or development-only files.

## 4. Validate the browser and runtime boundary

Automated tests cover the shared contracts. Manual validation is still necessary for Chrome extension permissions, side-panel lifecycle, Native Messaging, and OS process management.

- For Windows installer, scheduled task, PATH, native host, upgrade, and uninstall checks, follow [Windows 0.2.1 test checklist](../windows-testing.md).
- For macOS, verify the LaunchAgent, installed CLI, Bridge health endpoint, and a loaded extension against a disposable browser task.
- For browser automation, use a non-sensitive page and confirm both the visible browser result and the Bridge response. Do not place real account actions or their logs in the repository.

## 5. Review the public boundary

Before a public commit or release, review the candidate files, ignored paths, and documentation claims:

```bash
git status --short
git check-ignore -v 忽略上传/dist/agentlimb-chrome-v0.2.1.zip
npm test
```

The public repository should contain reproducible source, documentation, tests, and CI configuration. Releases are built from a semantic-version tag; generated artifacts are attached to the GitHub Release rather than committed.

## 6. Close the loop

Record any material design decision, regression, or validation gap in the appropriate documentation. For a change that affects cross-platform setup, distinguish static validation from real-machine validation. A macOS-only check cannot verify PowerShell, Windows Registry, Task Scheduler, or Chrome Native Messaging behavior on Windows.
