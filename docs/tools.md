# Installing the fixed mc-pilot backend

The harness installs external tools locally. `installMcPilot(projectRoot, { npmCommand?, signal? })`, exported from `dist/core/tools.js`, prepares `.harness/tools/mc-pilot` and returns `backendRoot`, `packageTarball`, `helperJar`, `version`, `sha256`, `helperSha256`, and `lockfile`. It does not edit project configuration or Java/EULA settings. The caller can use these returned paths when configuring the runtime.

```console
mch tools install mc-pilot --project <project-directory> --json
```

Set `harness.local.json.backends.mc-pilot` to the returned `backendRoot`. Java homes and existing EULA acceptance are configured separately. The four-target shared lock pins the additional loader helpers and dedicated-server installers; the runtime downloads and verifies those tools when local.tools does not provide an existing file. `--npm-command <absolute-path>` can select an explicit npm executable.

The installer downloads [the published npm 0.15.0 package](https://registry.npmjs.org/@kzheart_/mc-pilot/-/mc-pilot-0.15.0.tgz) with SHA256 `369ea25fb7a563c97e8b9c1daed01411193579b78a838f5e774900cef8775629` and [the Fabric 1.21.1 helper hosted in release v0.14.0](https://github.com/kzheart/mc-pilot/releases/download/v0.14.0/mct-client-mod-fabric-1.21.1.jar) with SHA256 `1242ef239b837222fd4eee6f7d957e0e749bde9d47875d62eba14365df5cb749`. The helper's in-game version is 0.9.1. Downloaded bytes must also match the npm package lock's SHA512 integrity before installation proceeds.

`templates/mc-pilot/package.json` and `package-lock.json` preserve the exact successful PoC dependency set. The installer runs `npm ci --ignore-scripts --no-audit --no-fund`, with a project-local prefix and cache. The npm package's postinstall hook does not run and nothing is installed globally. npm is resolved from PATH, or an explicit `npmCommand` can select `npm.cmd`/`npm`; command arguments remain an array through the platform process runner.

The resulting package must identify itself as `@kzheart_/mc-pilot` version 0.15.0. Installation records input hashes and hashes of installed dependency files in `.mch-mc-pilot.json`. Repeated installation verifies these records, the pinned helper and cache bytes before reuse. Modified files are rejected. Existing nonempty tool directories without managed metadata are preserved and rejected, including manually prepared earlier PoC installations. Install in a fresh project directory to keep those installations available.

Downloads and npm caches are below `.harness/cache`; installation logs remain below the tools directory. Links in these managed paths are rejected. If a failed or interrupted install leaves files without managed metadata, inspect its logs and remove only that project's `.harness/tools/mc-pilot` directory before a fresh installation. A retained lock requires confirmation that the earlier operation ended; the installer never steals it.

The backend's MIT license and dependency license files remain in the installed npm tree. Installation fixes bytes and versions; it does not certify dependency security. The tested dependency set had four npm advisories. See [the backend PoC record](backends/mc-pilot.md) for empirical limitations, the helper catalog correction, and process ownership policy. Installation alone does not mark a Minecraft target or suite as verified.
