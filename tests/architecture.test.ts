import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const simulationDir = fileURLToPath(new URL('../src/simulation', import.meta.url));

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('simulation and render stay separated', () => {
  const files = listTypeScriptFiles(simulationDir);

  it('finds the simulation sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s does not import Three.js or the render layer', (file) => {
    const source = readFileSync(file, 'utf8');
    const importedModules = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

    for (const moduleName of importedModules) {
      expect(moduleName).not.toMatch(/^three(\/|$)/);
      expect(moduleName).not.toMatch(/render\//);
    }
  });
});
