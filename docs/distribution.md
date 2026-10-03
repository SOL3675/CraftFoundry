# Development and local distribution

Use Node.js 24.19.0 and npm 11.9.0 when producing reproducible consumer packages. Keep `package-lock.json` authoritative. `private: true` and `UNLICENSED` intentionally prevent registry publication and do not confer an open-source license. Fixture MIT licenses and Gradle Apache-2.0 notices apply only to their respective files.

```console
npm ci --ignore-scripts
npm run check
npm pack
```

`prepack` builds TypeScript. The package includes the CLI, six explicit consumer API subpaths, schemas, Skills, templates, docs, and fixtures. It excludes caches, machine configuration, game downloads, credentials, and run evidence. Review `npm pack --dry-run --json` when changing the package allowlist. Verify a real packed consumer, not only this source checkout.

## CraftAtlas consumer

[CraftAtlas](https://github.com/SOL3675/CraftAtlas) has an independent pnpm lockfile and a bootstrap script. In its root, run:

```console
node scripts/prepare-foundry.mjs --source ../CraftFoundry
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
```

The source argument is an existing Git checkout containing the exact commit in Atlas's `craft-foundry.source.json`. Atlas builds that commit in its ignored temporary checkout; it does not install from the source working tree or change its branch. Omit `--source` to fetch the pinned commit from the recorded origin. Credentials, if required, must already be configured in Git. No tarball or generated build output is committed.

Atlas pins the complete Git commit and the packed bytes in its pnpm lockfile. Its development guide owns the update procedure. A new source pin must be made available remotely before other developers can bootstrap without the local checkout. Squashing Foundry can change that commit identity; update Atlas's pin and lockfile to the final reachable commit afterward.

Foundry must never install Atlas, recurse into submodules during bootstrap, or add Atlas as a root npm workspace. Future placement at `projects/craft-atlas` only changes the explicit source path to `../..` from Atlas. Keep the two histories and lockfiles independent. No submodule is required for this workflow.

## Other consumers

Create the tarball in a reviewed source checkout, copy it into an ignored local dependency directory in the consumer, and install it with an exact file dependency:

```console
npm install --save-dev --save-exact ./craft-foundry-0.1.1.tgz --ignore-scripts
npx mch --help
```

For reproducible restoration, automate rebuilding the exact source commit before `npm ci`, and retain the tarball integrity in the consumer lockfile. Do not commit generated archives. Installing the package does not create a consumer test script or harness configuration.

Use [existing-project](../templates/existing-project/README.md) and [configuration](configuration.md) to connect actual tasks and artifacts. To try packaged fixtures, copy `fixtures/`, `templates/`, `harness.config.json`, and `harness.lock.json` from the installed package into a new empty project, preserving their relative layout. Set that project's local Java roles, install its backend using `mch tools install mc-pilot --project <directory> --json`, then set the returned backend path locally. Reuse EULA acceptance only when the user has already accepted it.

Keep package version, schemas, and Skills together. Update consumer Skills with `mch skills install --destination .agents/skills --json`; inspect preserved edits before replacing any customization. Existing Mod source copies are not automatically upgraded.

Before merging, review diff and package contents and use meaningful commit messages for rationale. An initial squash merge does not erase prior dev commits, PR history, or copies of that history. Push, merge, visibility changes, and npm publication are separate operations.
