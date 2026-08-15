# Deployment

## Cloudflare Pages

The production site is the static `website/` directory.

Configure the existing Cloudflare Pages project with:

- Production branch: `main`
- Root directory: repository root
- Build command: leave empty
- Build output directory: `website`

No Cloudflare account ID or API token belongs in this repository. Keep deployment credentials in Cloudflare or GitHub encrypted secrets if a future workflow needs them.

## GitHub Releases

Create and push a semantic version tag after the matching version is ready:

```bash
npm test
node scripts/build-release.mjs 0.2.1 b2
git tag v0.2.1
git push origin main v0.2.1
```

Local builds are written under the ignored `忽略上传/dist/` directory. The release workflow creates these assets:

- `agentlimb-chrome-v0.2.1-b2.zip`
- `agentlimb-runtime-v0.2.1-b2.zip`
- `SHA256SUMS.txt`

The extension manifest remains the numeric browser version (`0.2.1`); the `b2` suffix is a release-asset build identifier. Use `node scripts/build-release.mjs <version> <bN>` to produce a later build.

The Chrome Web Store upload remains a manual step. The extension is the only user-facing package. After explicit approval, its onboarding prompt downloads the matching Runtime from this GitHub Release, verifies its checksum, and configures the local service. The Runtime zip is a machine-consumed release asset, not a separate product the user needs to locate or install manually.
