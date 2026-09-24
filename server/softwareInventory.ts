import path from 'path';
import type { AIProcessItem, AISoftwareAppItem } from '../src/types';
import { detectInstalledAISoftware } from './softwareDetector';
import { detectCatalogSoftware, outermost } from './catalogDetector';
import { detectAIPackages } from './aiPackages';
import { detectAIModels } from './aiModels';
import { listInstalledPrograms } from './installedPrograms';
import { listAllProcesses } from './processList';
import { formatBytes, measureDirectory } from './scanner';
import { mapLimit } from './fsAsync';
import { withAppIcons } from './appIcons';

const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Everything AI-related on this machine, for the Installed AI tools page:
 * AI apps and agents, apps with AI built in, the runtimes and services they
 * rely on, and the packages they installed.
 */
export async function detectSoftwareInventory(aiProcesses: AIProcessItem[]): Promise<AISoftwareAppItem[]> {
  const [programs, allProcesses] = await Promise.all([listInstalledPrograms(), listAllProcesses()]);
  const [apps, catalog, models] = await Promise.all([
    detectInstalledAISoftware(aiProcesses, programs),
    detectCatalogSoftware(programs, allProcesses),
    detectAIModels().catch(() => [] as AISoftwareAppItem[])
  ]);

  // An AI app found both by its folders and in the programs list is one row:
  // fold the catalog's install folder and running state into the folder-based
  // entry, then measure the combined folders once.
  const byName = new Map(apps.filter(a => a.status !== 'NOT INSTALLED').map(a => [norm(a.name), a]));
  const merged: AISoftwareAppItem[] = [];
  const catalogRows: AISoftwareAppItem[] = [];
  for (const c of catalog) {
    const existing = c.group === 'ai' ? byName.get(norm(c.name)) : undefined;
    if (!existing) { catalogRows.push(c); continue; }
    const running = c.status === 'ACTIVE IN RAM' && existing.status !== 'ACTIVE IN RAM';
    const joined: AISoftwareAppItem = {
      ...existing,
      detectionPaths: outermost([...existing.detectionPaths, ...c.detectionPaths]),
      version: existing.version ?? c.version,
      iconPath: existing.iconPath ?? c.iconPath,
      publisher: existing.publisher ?? c.publisher,
      status: running ? 'ACTIVE IN RAM' : existing.status === 'LAYING ON DISK (RESIDUAL)' ? 'INSTALLED ON DISK' : existing.status,
      ...(running ? { pid: c.pid, ramMb: c.ramMb, processCount: c.processCount } : {})
    };
    byName.set(norm(c.name), joined);
    merged.push(joined);
  }
  await mapLimit(merged, 4, async item => {
    const sizes = await Promise.all(item.detectionPaths.map(p => measureDirectory(p)));
    item.totalDiskSizeBytes = sizes.reduce((a, s) => a + s.bytes, 0);
    item.formattedDiskSize = formatBytes(item.totalDiskSizeBytes);
  });

  const toolchainRoot = (id: string) => catalog.find(c => c.id === id)?.detectionPaths.filter(p => !/[\\/]npm$/i.test(p)) ?? [];
  const packages = await detectAIPackages(toolchainRoot('tc-node'), toolchainRoot('tc-python'));

  const aiRows = apps.map(a => byName.get(norm(a.name)) ?? a).map(a => ({ ...a, group: a.group ?? ('ai' as const) }));
  return withAppIcons([...aiRows, ...models, ...catalogRows, ...packages].map(item => ({
    ...item,
    detectionPaths: item.detectionPaths.map(p => path.normalize(p))
  })));
}
