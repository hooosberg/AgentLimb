# AgentLimb Development Notes

AgentLimb is a single public repository. The Chrome extension, Bridge, and CLI live at the repository root; the Cloudflare Pages site lives in `website/`.

## Commands

```bash
npm test
npm run build
node kernel/bridge/mvp/run-server.js
```

## Boundaries

- `忽略上传/` contains all local-only references, legacy worktrees, private material, and generated release assets. Never commit it.
- Keep credentials, Cloudflare tokens, browser data, and local runtime state out of git.
- Release tags use `vX.Y.Z`; `scripts/build-release.mjs` synchronizes source versions and builds assets into `忽略上传/dist/`.
