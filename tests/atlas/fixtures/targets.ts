import { createHash } from 'node:crypto';
import type { DefinitionPack, Snapshot } from '../../../projects/craft-atlas/packages/core/src/types.ts';

export const targets = [
  { id: 'neoforge-1.21.1', minecraft: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.252' },
  { id: 'fabric-1.21.1', minecraft: '1.21.1', loader: 'fabric', loaderVersion: '0.16.14' },
  { id: 'forge-1.20.1', minecraft: '1.20.1', loader: 'forge', loaderVersion: '47.3.0' },
  { id: 'fabric-1.20.1', minecraft: '1.20.1', loader: 'fabric', loaderVersion: '0.16.14' },
] as const;
export type Target = typeof targets[number];
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Adapt synthetic fixtures to actual version-specific recipe forms, never claim a game capture. */
export function targetFixture(snapshot: Snapshot, target: Target, packs: DefinitionPack[] = []) {
  Object.assign(snapshot, { minecraft: target.minecraft, loader: target.loader, loaderVersion: target.loaderVersion });
  snapshot.mods.filter(mod => mod.id === 'minecraft').forEach(mod => { mod.version = target.minecraft; });
  for (const pack of packs) Object.assign(pack.targets, { minecraft: target.minecraft, loader: target.loader });
  if (target.minecraft === '1.20.1') {
    const legacyResult = (data: any) => {
      if (data?.result?.id) { data.result.item = data.result.id; delete data.result.id; }
    };
    for (const recipe of snapshot.recipes) {
      legacyResult(recipe.data);
      recipe.serialization = { encoding: 'recipe-network-1.20.1', bytesBase64: 'AAEC', sha256: sha256(Buffer.from([0, 1, 2])), limitations: ['Synthetic network bytes; not Minecraft execution'] };
    }
    if (snapshot.datapack) {
      snapshot.datapack.directories = snapshot.datapack.directories.map(path => path === 'recipe' ? 'recipes' : path);
      for (const resource of snapshot.datapack.resources) {
        resource.id = resource.id.replace(':recipe/', ':recipes/');
        for (const variant of [resource.effective, ...resource.stack]) {
          legacyResult(variant.data);
          variant.text = JSON.stringify(variant.data); variant.sha256 = sha256(variant.text);
        }
      }
    }
  }
  return snapshot;
}
