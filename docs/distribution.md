# Development and local distribution

Use Node.js 24.19.0 and npm 11.9.0 when producing reproducible consumer packages. Keep `package-lock.json` authoritative. Original CraftFoundry code and documentation use [MIT](../LICENSE); separate fixture licenses and third-party notices remain applicable to their respective files. `private: true` continues to prevent npm registry publication.

```console
npm ci --ignore-scripts
npm run check
npm pack
npm run test:consumer -- --package craft-foundry-0.1.7.tgz
```

`prepack` builds TypeScript. The package includes the CLI, six explicit consumer API subpaths, schemas, Skills, templates, docs, fixtures, root LICENSE, and existing fixture/Gradle notices. Fixture binary and source JARs include their existing MIT license in `META-INF/LICENSE`. The package excludes caches, machine configuration, game downloads, credentials, and run evidence. Review `npm pack --dry-run --json` when changing the package allowlist. Verify a real packed consumer, not only this source checkout.

## CraftAtlas consumer

[CraftAtlas](https://github.com/SOL3675/CraftAtlas) is pinned as a real submodule at `projects/craft-atlas`, retaining its independent history, pnpm lockfile, and bootstrap script. Initialize with `git submodule update --init projects/craft-atlas`. From `projects/craft-atlas`, run:

```console
node scripts/prepare-foundry.mjs --source ../..
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
```

The source argument is an existing Git checkout containing the exact commit in Atlas's `craft-foundry.source.json`. Atlas builds that commit in its ignored temporary checkout; it does not install from the source working tree or change its branch. Omit `--source` to fetch the pinned commit from the recorded origin. No tarball or generated build output is committed.

The merged Atlas submodule independently pins Foundry 0.1.5 at `21a7a3d4984eaa154b1c5a8b8d0a2756dfee05c6`; this integration update does not alter that pin or its frozen lock. To validate a new packed candidate on a local validation machine, use the isolated consumer overlay in [survival validation](survival.md#validate-a-new-foundry-package-locally).

Atlas pins the complete Git commit and the packed bytes in its pnpm lockfile. Its development guide owns the update procedure. A new source pin must be made available remotely before other developers can bootstrap without the local checkout. Squashing Foundry can change that commit identity; update Atlas's pin and lockfile to the final reachable commit afterward.

Foundry root install/build/pack must never install Atlas, recurse into submodules during bootstrap, or add Atlas as a root npm workspace. Atlas bootstraps its independently pinned Foundry main commit, rather than the parent working tree or dev tip; the parent submodule therefore creates no install cycle. The repository-only [survival suite](survival.md) calls Atlas source APIs with Node 24 and the root locked Ajv, without installing Atlas or its consumer dependency. It is not a published npm API and the submodule is excluded from the Foundry package.

## Other consumers

Create the tarball in a reviewed source checkout, copy it into an ignored local dependency directory in the consumer, and install it with an exact file dependency:

```console
npm install --save-dev --save-exact ./craft-foundry-0.1.7.tgz --ignore-scripts
npx mch --help
```

For reproducible restoration, automate rebuilding the exact source commit before `npm ci`, and retain the tarball integrity in the consumer lockfile. Do not commit generated archives. Installing the package does not create a consumer test script or harness configuration.

Use [existing-project](../templates/existing-project/README.md) and [configuration](configuration.md) to connect actual tasks and artifacts. To try packaged fixtures, copy `fixtures/`, `templates/`, `harness.config.json`, and `harness.lock.json` from the installed package into a new empty project, preserving their relative layout. Set that project's local Java roles, install its backend using `mch tools install mc-pilot --project <directory> --json`, then set the returned backend path locally. Reuse EULA acceptance only when the user has already accepted it.

Keep package version, schemas, and Skills together. Update consumer Skills with `mch skills install --destination .agents/skills --json`; inspect preserved edits before replacing any customization. Existing Mod source copies are not automatically upgraded.

Before merging, review diff and package contents and use meaningful commit messages for rationale. An initial squash merge does not erase prior dev commits, PR history, or copies of that history. Push, merge, visibility changes, and npm publication are separate operations.

For harness development, the commands at the top run TypeScript and dummy-runtime contracts, not Minecraft validation. Initialize the exact gitlink and run `npm run check:atlas`, `npm run test:atlas`, and `npm run test:atlas:definitions` for four-target saved-data integration. Use a fresh clone with `git submodule update --init projects/craft-atlas`, without `--atlas-source`, before accepting a pin change. Keep developer fixtures and regression procedures here and in the survival guide; the root READMEs address package users.

The consumer check installs the actual tarball into an empty project, imports all six explicit API subpaths, lists packaged targets, installs Skills and checks acquisition template boundaries. Add `--previous <0.1.5-tarball>` to exercise an actual package upgrade: untouched Skills receive new hash/version provenance while a customized setup Skill retains its original record. CI runs the installed-package check after packing.
