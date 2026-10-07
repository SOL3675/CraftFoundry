# Test world persistence across a server restart

Use `server-persistence` with Foundry 0.1.8 or later for Mods that save block entities, block-state properties, inventory slots or custom world data. Add it to each supported target's `requiredSuites`. The four packaged fixtures already require it; an existing-project template keeps it unsupported until the Mod supplies actual probes.

The driver prepares a new, empty session below the Run, deploys the recorded distribution/dependency artifacts, starts a dedicated process and waits for readiness. It executes seed commands and baseline assertions, waits for `save-all flush`, sends `stop` and requires a normal exit with code 0. Only after that process ends does it start a second process using the same world, read restoration assertions without reseeding, and stop cleanly again. Each launch retains distinct stdout/stderr logs. `persistence.json` retains the nonce, owner, command responses and case verdicts.

## Configure probes for your Mod

Commands must be single lines, and patterns must match the command's actual response. Include `{nonce}` in your seed data and read responses to prevent an unrelated response from satisfying a probe. The driver reads output only after each command's mark. For example:

An optional `failurePattern` on each probe recognizes an explicit negative response and ends the probe immediately with that response in its diagnostic. It uses the same nonce and output mark as the success pattern; it does not replace the required success match. Existing probes without this optional field retain their timeout behavior. Older strict configuration readers reject this new field; upgrade the installed package and Skills together before using it.

```json
{
  "driver": "server-persistence",
  "runtime": "dedicated-server",
  "requiredCapabilities": ["dedicated-server", "yourmod-persistence"],
  "expectedTests": ["persistence.seed", "persistence.saved", "persistence.stopped", "persistence.restarted", "persistence.restore.machine", "persistence.final-stop"],
  "minTests": 6,
  "persistence": {
    "seed": [{ "command": "yourmod test seed {nonce}", "pattern": "YOURMOD_SEEDED {nonce}" }],
    "assertions": [{ "id": "persistence.restore.machine", "command": "yourmod test read {nonce}", "pattern": "YOURMOD_RESTORED {nonce} state=active count=13" }]
  }
}
```

Use a dedicated runtime with test-only commands in the recorded Mod distribution. The probe must inspect game-loaded state, including representative block entity fields, a nondefault block property, stored item ID/count/components where relevant, and separate custom world saved data. A JSON/NBT roundtrip or reconnect alone cannot replace this suite. Mods with no such data may document the inapplicable scope rather than inventing coverage; required unsupported probes block release.

The fixture seeds `fixture:counter[persistent=true]` at `(8,80,8)`, counter 37, one stored ItemStack slot containing 13 diamonds, and separate `fixture_persistence` world data with a random token and value 73. The custom data uses the target's actual PersistentState/SavedData API. It is deliberately separate from the block entity. Commands require `-Dmch.fixture.persistence=true`; the fixture persistence runtimes supply it. The nine expected cases include four restoration assertions: `block`, `counter`, `inventory` and `saved`.

Timeout, cancellation or nonzero/forced shutdown prevents a clean-restart pass. Cleanup uses only the invocation's owned process tree; worlds are retained for diagnosis. Preparation rejects a nonempty session or an escaping path and never adopts a saved PID or user world. These checks cover clean shutdown persistence, not crash/power-loss recovery, upgrades, every chunk, player inventory, or arbitrary Mod data.

## Validate the four targets locally

Use a separate checkout of the exact reviewed Foundry candidate and its packed bytes, preserving original projects and worlds. Configure the existing accepted EULA state and actual Java 17/21 homes in ignored local configuration. Do not run these commands in a cloud contract-only task.

```console
mch test --target neoforge-1.21.1 --suite server-persistence --json
mch test --target fabric-1.21.1 --suite server-persistence --json
mch test --target forge-1.20.1 --suite server-persistence --json
mch test --target fabric-1.20.1 --suite server-persistence --json
mch test --all --profile release --json
```

Require all nine persistence cases per target, two independent process launches, unchanged deployed artifact identity and the same disposable world directory. Preserve all failed attempts. The added suite has cloud dummy-process/disk contracts; its Minecraft fixture compilation and game runs require separate target validation before claiming support.

For negative validation, modify only a disposable consumer overlay's persistence runtime to add `-Dmch.fixture.breakPersistence=counter`, `inventory` or `saved` before the Java launch. Each injection drops that field on deserialization, after the first-process baseline can pass; the corresponding restoration assertion must fail in the second process. Remove the overlay and run a fresh positive case. Also exercise startup failure (`-Dmch.fixture.failStart=true`), an intentionally short readiness deadline, cancellation and a short stop deadline. No forced-stop attempt may be classified as a clean restart. Verify no live owned process remains after every outcome and retain its world/evidence. Offline timeout and lost-state contracts do not substitute for these game checks.
