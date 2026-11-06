import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, cp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exportPreview} from '../export-preview.mjs';

test('two exports are stable; missing assets and late write failures preserve results and clean up', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'shudeng-export-test-'));
  try {
    const output = join(scratch, 'standalone.html');
    await exportPreview({output});
    const first = await readFile(output);
    await exportPreview({output});
    assert.deepEqual(await readFile(output), first);
    const root = join(scratch, 'missing-assets');
    await mkdir(join(root, 'assets'), {recursive:true});
    for (const name of ['index.html','app.html','app.css','app.js','spec.md','assets/PHOSPHOR-LICENSE']) await cp(fileURLToPath(new URL('../' + name, import.meta.url)), join(root, name));
    await assert.rejects(exportPreview({root, output}), /设计资源缺失/);
    assert.deepEqual(await readFile(output), first);
    const directory = join(scratch, 'not-a-file');
    await mkdir(directory);
    await assert.rejects(exportPreview({output:directory}));
    assert.equal((await readdir(scratch)).some(name => name.includes('.tmp-')), false);
  } finally {
    await rm(scratch, {recursive:true, force:true});
  }
});
