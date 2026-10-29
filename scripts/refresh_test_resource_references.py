#!/usr/bin/env python3
"""Refresh only audited script/product seals and verified execution path references.

Original manifests are archived byte-for-byte. Authorization/release records and
historical logs are never edited, and a pre-existing hash mismatch is not blessed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import test_resources as resources

OUT = ROOT / '.scratch/delivery/test-resource-cleanup'


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(path):
    return {str(p.relative_to(path)): {'sha256': sha(p), 'bytes': p.stat().st_size}
            for p in sorted(path.rglob('*')) if p.is_file()}


def tree_record(path):
    files = inventory(path)
    rows = [name + '\0' + item['sha256'] + '\0' + str(item['bytes']) for name, item in files.items()]
    return {'sha256': hashlib.sha256('\n'.join(rows).encode()).hexdigest(), 'files': len(files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    changed, mismatches = {}, []
    scripts = resources.read_json(OUT / 'script-adaptation-audit.json', {}).get('files', {})
    for row in resources.read_json(OUT / 'card-controller-hash-audit.json', []):
        scripts[row['file']] = {'oldSHA256': row['preEditSHA256Reconstructed'], 'newSHA256': sha(ROOT / row['file'])}
    for name, row in scripts.items():
        if sha(ROOT / name) != row['newSHA256']:
            raise RuntimeError('Edited script changed after its audit: ' + name)
        changed[row['oldSHA256']] = row['newSHA256']
    bases = {str(Path(name).parent) for name in scripts if name.startswith('.scratch/delivery/')}
    names = {'entry-manifest.json', 'manifest.json', 'input-pins.json', 'signed-products.json',
             'execution-manifest.json', 'host-copy-manifest.json', 'state.json', 'preflight-state.json',
             'build-command.json', 'signed-build-command.json'}
    paths = {ROOT / base / name for base in bases for name in names if (ROOT / base / name).is_file()}
    paths.update((ROOT / '.scratch/delivery/issue-11-card-pilot').rglob('workspace.json'))
    paths.add(ROOT / '.scratch/delivery/issue-11-c061-fix2/run/workspace.json')
    for name in ('freeze.json', 'manifest.json'):
        paths.add(ROOT / '.scratch/supervision/issue-11/book-map-v8-c061-fix2' / name)
    originals = {p: p.read_bytes() for p in paths if p.is_file()}
    values = {p: json.loads(raw) for p, raw in originals.items()}

    def file_update(old_path, expected):
        old_path = Path(old_path)
        new_path = resources.resolve_path(old_path)
        if expected in changed:
            return changed[expected]
        if new_path != old_path and old_path.is_file() and sha(old_path) == expected and new_path.is_file():
            return sha(new_path)
        return expected

    def update(value, owner):
        if isinstance(value, list):
            return [update(item, owner) for item in value]
        if not isinstance(value, dict):
            return str(resources.resolve_path(value)) if isinstance(value, str) and value.startswith('/') else value
        result = {}
        for key, item in value.items():
            candidate = Path(key) if key.startswith('/') else owner.parent / key
            if not candidate.is_file() and (ROOT / key).is_file():
                candidate = ROOT / key
            if isinstance(item, str) and len(item) == 64 and candidate.is_file():
                item = file_update(candidate, item)
            elif isinstance(item, str) and key.endswith(('SHA256', '_sha256')) and item in changed:
                item = changed[item]
            elif isinstance(item, dict) and isinstance(item.get('sha256'), str) and candidate.is_file():
                item = dict(item)
                fresh = file_update(candidate, item['sha256'])
                if fresh != item['sha256']:
                    item['sha256'] = fresh
                    if 'bytes' in item:
                        item['bytes'] = resources.resolve_path(candidate).stat().st_size
            new_key = str(resources.resolve_path(key)) if key.startswith('/') else key
            result[new_key] = update(item, owner)
        if isinstance(value.get('path'), str) and isinstance(value.get('sha256'), str):
            original_path = Path(value['path'])
            result['sha256'] = file_update(original_path, value['sha256'])
            if 'bytes' in result and resources.resolve_path(original_path).is_file():
                result['bytes'] = resources.resolve_path(original_path).stat().st_size
        return result

    # Host tree gates validate the original entire app before accepting relocated bytes.
    for path, value in values.items():
        if path.name != 'host-copy-manifest.json':
            continue
        for original, container in ((value['normalApp']['path'], value['normalApp']), (value['app'], value['appProduct'])):
            old, new = Path(original), resources.resolve_path(original)
            if old == new:
                continue
            if tree_record(old) != container['tree']:
                mismatches.append({'file': str(path.relative_to(ROOT)), 'gate': 'original-app-tree', 'path': str(old)})
                continue
            container['tree'] = tree_record(new)
            container['files'] = inventory(new)
    # Update dependency seals until parent manifests see the new child hashes.
    for _ in range(8):
        any_change = False
        for path, value in list(values.items()):
            original = originals[path]
            new_value = update(value, path)
            if path.name == 'workspace.json':
                for field in ('sourceTree', 'xctestrun'):
                    if field in value:
                        new_value[field] = str(resources.resolve_path(value[field]))
                if 'xctestrun' in new_value:
                    new_value['derivedData'] = str(Path(new_value['xctestrun']).parents[2])
                old_work = Path(json.loads(original).get('workDirectory', '/nonexistent'))
                if old_work.name.startswith(('shudeng-issue11-card-pilot-', 'shudeng-issue11-full-map-')):
                    new_value['workDirectory'] = str(OUT / 'archived-backups' / old_work.name)
                pin = new_value.get('controllerSHA256')
                if pin in changed:
                    new_value['controllerSHA256'] = changed[pin]
                elif pin and pin not in changed.values():
                    note = {'file': str(path.relative_to(ROOT)), 'gate': 'pre-existing-controller-pin', 'sha256': pin}
                    if note not in mismatches:
                        mismatches.append(note)
                # Build/preflight fields are historical evidence, not execution inputs.
                for field in ('build', 'preflight'):
                    if field in value:
                        new_value[field] = value[field]
            raw = original if new_value == json.loads(original) else (json.dumps(new_value, ensure_ascii=False, indent=2) + '\n').encode()
            old_sha, new_sha = hashlib.sha256(original).hexdigest(), hashlib.sha256(raw).hexdigest()
            if values[path] != new_value:
                any_change = True
            values[path] = new_value
            if old_sha != new_sha:
                changed[old_sha] = new_sha
        if not any_change:
            break
    report = {'schema': 1, 'applied': args.apply, 'changes': [], 'preExistingMismatchesNotReleased': mismatches}
    for path, value in values.items():
        raw = originals[path] if value == json.loads(originals[path]) else (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
        if raw == originals[path]:
            continue
        old_sha, new_sha = hashlib.sha256(originals[path]).hexdigest(), hashlib.sha256(raw).hexdigest()
        archive = OUT / 'original-reference-manifests' / (old_sha + '.json')
        report['changes'].append({'file': str(path.relative_to(ROOT)), 'oldSHA256': old_sha, 'newSHA256': new_sha, 'original': str(archive.relative_to(ROOT))})
        if args.apply:
            archive.parent.mkdir(parents=True, exist_ok=True)
            if not archive.exists():
                archive.write_bytes(originals[path])
            path.write_bytes(raw)
    resources.write_json(OUT / 'reference-refresh-audit.json', report)
    print(json.dumps({'changedManifests': len(report['changes']), 'preExistingMismatchCount': len(mismatches), 'applied': args.apply}))


if __name__ == '__main__':
    main()
