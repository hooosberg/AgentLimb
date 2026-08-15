# Contributing

## Local development

AgentLimb requires Node.js 18 or later. It has no production npm dependencies.

```bash
npm test
npm run build
```

To test the extension, open `chrome://extensions`, enable Developer Mode, choose **Load unpacked**, and select the repository root.

To test the Bridge without installing a background service:

```bash
node kernel/bridge/mvp/run-server.js
node kernel/bridge/mvp/terminal-client.mjs status
```

## Pull requests

- Keep runtime, extension, and website changes in their existing directories.
- Add focused tests for behavioral changes.
- Do not commit `忽略上传/`, runtime state, credentials, private keys, cookies, or browser profile data.
- Run `npm test` and `npm run build` before opening a pull request.

## Releases

`node scripts/build-release.mjs x.y.z` synchronizes the version and creates the Chrome and Windows assets in `忽略上传/dist/`. Pushing a matching `vx.y.z` tag runs the release workflow and uploads those assets to GitHub Releases.
