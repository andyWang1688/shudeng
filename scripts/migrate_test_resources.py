#!/usr/bin/env python3
"""Reviewable copy/verify migration; original historical data is never removed."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import test_resources as resources

BASE = ROOT / '.build/test-resources'
EVIDENCE = ROOT / '.scratch/delivery/test-resource-cleanup'
MAX_LEGACY_BYTES = 16 * 1024**3
MACHO = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'}


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def bytes_used(path):
    path = Path(path)
    return path.stat().st_size if path.is_file() else resources.size(path)


def in_use(path):
    if Path(path).is_dir():
        return resources.in_use(path)
    try:
        result = subprocess.run(['lsof', '-nP', '-F', 'n', str(path)],
                                capture_output=True, text=True, timeout=30)
        return result.returncode not in (0, 1) or bool(result.stderr.strip()) or any(
            line.startswith('n') for line in result.stdout.splitlines())
    except (OSError, subprocess.TimeoutExpired):
        return True


def map_path(value, mappings):
    for pair in sorted(mappings, key=lambda m: len(m['source']), reverse=True):
        for prefix in (pair['source'], pair['source'].replace('/private/tmp/', '/tmp/', 1),
                       pair['source'].replace('/private/var/', '/var/', 1)):
            if value == prefix or value.startswith(prefix + '/'):
                return pair['destination'] + value[len(prefix):]
    return value


def relocate_products(destination, mappings):
    """Change only copied loader/plist paths; preserve original products and seals."""
    changes, changed_bundles = [], set()
    for path in sorted(destination.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        if path.suffix == '.xctestrun':
            original = path.read_bytes()
            value = plistlib.loads(original)
            def remap(item):
                if isinstance(item, dict):
                    return {k: remap(v) for k, v in item.items()}
                if isinstance(item, list):
                    return [remap(v) for v in item]
                return map_path(item, mappings) if isinstance(item, str) else item
            updated = remap(value)
            if updated != value:
                path.write_bytes(plistlib.dumps(updated, fmt=plistlib.FMT_XML))
                changes.append({'path': str(path.relative_to(destination)), 'kind': 'xctestrun-paths',
                                'oldSHA256': hashlib.sha256(original).hexdigest(), 'newSHA256': digest(path)})
            continue
        with path.open('rb') as stream:
            if stream.read(4) not in MACHO:
                continue
        output = subprocess.run(['xcrun', 'otool', '-l', str(path)], capture_output=True, text=True, check=True).stdout
        commands, edits = [], []
        for command, body in re.findall(r'cmd (LC_[A-Z_]+)\n(.*?)(?=Load command|$)', output, re.S):
            if command not in ('LC_RPATH', 'LC_LOAD_DYLIB', 'LC_LOAD_WEAK_DYLIB', 'LC_REEXPORT_DYLIB', 'LC_ID_DYLIB'):
                continue
            match = re.search(r'\n\s+(?:path|name) (.+?) \(offset ', body)
            if not match:
                continue
            old = match.group(1)
            new = map_path(old, mappings)
            if command == 'LC_RPATH' and old.startswith(('/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/')) and old.endswith('/PackageFrameworks'):
                if path.parent.suffix == '.framework':
                    new = '@loader_path/..'
                    local_frameworks = path.parent.parent
                elif path.parent.suffix == '.app':
                    new = '@loader_path/Frameworks'
                    local_frameworks = path.parent / 'Frameworks'
                elif any(p.suffix == '.xctest' for p in path.parents):
                    new = '@executable_path/Frameworks'
                    app = next((p for p in path.parents if p.suffix == '.app'), None)
                    local_frameworks = app / 'Frameworks' if app else None
                else:
                    local_frameworks = None
                if local_frameworks is None or not local_frameworks.is_dir():
                    raise RuntimeError(f'No copied Frameworks fallback for {path}')
                needed = set(re.findall(r'name @rpath/([^ \n]+\.framework/[^ \n]+) \(offset ', output))
                developer = Path(subprocess.check_output(['xcode-select', '-p'], text=True).strip())
                platform = developer / 'Platforms/iPhoneSimulator.platform/Developer/Library'
                absent = [name for name in needed if not (local_frameworks / name).is_file()
                          and not (platform / 'Frameworks' / name).is_file()
                          and not (platform / 'PrivateFrameworks' / name).is_file()]
                if absent:
                    raise RuntimeError(f'Copied framework dependencies missing for {path}: {absent}')
                if 'path @executable_path/Frameworks (offset ' in output and path.parent.suffix != '.framework':
                    new = '@executable_path/Frameworks'
            if old.startswith(('/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/')) and old == new:
                raise RuntimeError(f'Unmapped temporary loader dependency: {path}: {old}')
            if old == new or (old, new) in edits:
                continue
            edits.append((old, new))
            duplicate = command == 'LC_RPATH' and ('path ' + new + ' (offset ') in output
            commands.extend((['-delete_rpath', old] if duplicate else ['-rpath', old, new] if command == 'LC_RPATH' else
                             ['-id', new] if command == 'LC_ID_DYLIB' else ['-change', old, new]))
        if not commands:
            continue
        old_sha = digest(path)
        subprocess.run(['xcrun', 'install_name_tool', *commands, str(path)], check=True, capture_output=True)
        subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-',
                        '--preserve-metadata=entitlements,requirements,flags', str(path)], check=True, capture_output=True)
        for parent in path.parents:
            if parent == destination:
                break
            if parent.suffix in ('.app', '.framework', '.xctest', '.bundle'):
                changed_bundles.add(parent)
        changes.append({'path': str(path.relative_to(destination)), 'kind': 'loader-paths',
                        'oldSHA256': old_sha, 'newSHA256': digest(path), 'edits': edits})
        final = subprocess.run(['xcrun', 'otool', '-l', str(path)], capture_output=True, text=True, check=True).stdout
        if re.search(r'\n\s+(?:path|name) /(?:private/)?(?:tmp|var/folders)/', final):
            raise RuntimeError(f'Temporary loader dependency survived relocation: {path}')
    for bundle in sorted(changed_bundles, key=lambda p: len(p.parts), reverse=True):
        subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-',
                        '--preserve-metadata=entitlements,requirements,flags', str(bundle)], check=True, capture_output=True)
        subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(bundle)], check=True, capture_output=True)
    for change in changes:
        change['newSHA256'] = digest(destination / change['path'])
    return changes


def reap_migration_runs(registry):
    removed = []
    for marker in (BASE / 'migration-runs').glob('*.json'):
        owner = resources.read_json(marker, {})
        if owner.get('schema') != 1 or owner.get('root') != str(ROOT) or resources.alive(owner.get('pid')):
            continue
        retained = False
        for key in ('staging', 'destination'):
            target = Path(owner.get(key, '/nonexistent'))
            allowed = target.is_relative_to(BASE) or target.is_relative_to(EVIDENCE / 'archived-results')
            registered = any(m.get('verified') and (Path(m['destination']) == target or Path(m['destination']).is_relative_to(target)) for m in registry['mappings'])
            if allowed and target.exists() and not registered and not resources.in_use(target):
                shutil.rmtree(target)
                removed.append(str(target))
            elif allowed and target.exists() and not registered:
                retained = True
        if not retained:
            marker.unlink()
    return removed


def tree(path):
    path = Path(path)
    rows = []
    files = sorted(path.rglob('*')) if path.is_dir() else [path]
    for file in files:
        if file.is_symlink():
            rows.append([str(file.relative_to(path)), 'link', os.readlink(file)])
        elif file.is_file():
            with file.open('rb') as stream:
                rows.append([str(file.relative_to(path)) if path.is_dir() else '.',
                             file.stat().st_size, hashlib.file_digest(stream, 'sha256').hexdigest()])
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


def plan():
    inventory = resources.read_json(EVIDENCE / 'inventory-before.json', {})
    roots = inventory.get('privateTmpRoots', [])
    dependency = resources.dependency_path(ROOT)
    selections = {
        'shudeng-readium-spm': (dependency, ['.'], 'readium'),
        'shudeng-issue11-real-entry-2l7uspnc': (BASE / 'legacy/real-entry', ['source', 'derived/Build/Products'], 'snapshot'),
        'shudeng-issue11-dummy-c5xwq3ic': (BASE / 'legacy/dummy', ['source', 'derived/Build/Products'], 'snapshot'),
        'shudeng-issue11-semantic-adapter-venv': (BASE / 'dependencies/python', ['.'], 'venv'),
        'shudeng-issue11-v4-assets': (BASE / 'dependencies/local-model-v4', ['qwen2.5-1.5b-instruct-q4_k_m.gguf', 'llama.cpp/build/bin'], 'model'),
        'shudeng-issue11-grammar-diagnostic-tools': (BASE / 'dependencies/grammar-tools', ['.'], 'tool'),
        'shudeng-e5-small': (BASE / 'dependencies/e5-small', ['model.onnx', 'config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'README.md'], 'model'),
        'shudeng-issue17-app-only': (BASE / 'legacy/normal-app', ['Build/Products'], 'snapshot'),
        'shudeng-derived': (BASE / 'legacy/shudeng-derived', ['Build/Products'], 'snapshot'),
        'shudeng-issue10-derived': (BASE / 'legacy/issue10-derived', ['Build/Products'], 'snapshot'),
        'shudeng-issue11-real-entry-verify-derived': (BASE / 'legacy/real-entry-verify', ['Build/Products'], 'snapshot'),
        'shudeng-issue11-runner-preflight-sccng4lo': (BASE / 'legacy/runner-preflight', ['source', 'derived/Build/Products'], 'snapshot'),
    }
    entries = []
    inventoried = {Path(item['path']).name for item in roots}
    roots = [*roots, *({'path': str(Path('/private/tmp') / name)} for name in selections
                      if name not in inventoried and (Path('/private/tmp') / name).exists())]
    for item in roots:
        source = Path(item['path'])
        if source.name not in selections:
            continue
        destination, components, kind = selections[source.name]
        components = [part for part in components if (source / part).exists()]
        if not components:
            continue
        entries.append({'source': str(source), 'destination': str(destination), 'kind': kind,
                        'components': components, 'copyBytes': sum(bytes_used(source / part) for part in components),
                        'references': item.get('references', {}), 'openFilesAtInventory': item.get('live', []),
                        'safeToCopyAtInventory': not item.get('live'),
                        'sourceRetained': True, 'verify': 'SHA256 tree; venv additionally records rewritten bin text',
                        'mappings': [{'source': str(source / c), 'destination': str(destination / c)} for c in components],
                        'retention': 'one immutable named snapshot; all migrated dependency/snapshot data cap 16 GiB; evidence is separate and never evicted'})
    # Workspace metadata is a live reference even though the prepare process ended.
    for reference in sorted((ROOT / '.scratch').rglob('workspace.json')):
        workspace = resources.read_json(reference, {})
        source = Path(workspace.get('workDirectory', '/nonexistent'))
        if not source.is_dir() or not source.name.startswith(('shudeng-issue11-card-pilot-', 'shudeng-issue11-full-map-')):
            continue
        destination = BASE / 'legacy/card-workspaces' / source.name
        if any(e['source'] == str(source) for e in entries):
            continue
        components = [c for c in ('source', 'derived/Build/Products') if (source / c).exists()]
        entries.append({'source': str(source), 'destination': str(destination), 'kind': 'snapshot',
                        'components': components, 'copyBytes': sum(resources.size(source / c) for c in components),
                        'references': [str(reference.relative_to(ROOT))], 'sourceRetained': True,
                        'mappings': [{'source': str(source / c), 'destination': str(destination / c)} for c in components],
                        'retention': 'immutable registered workspace snapshot; 16 GiB shared migration budget'})
        backup = source / 'original-app'
        if backup.exists():
            archived = EVIDENCE / 'archived-backups' / source.name / 'original-app'
            entries.append({'source': str(backup), 'destination': str(archived), 'kind': 'evidence',
                            'components': ['.'], 'copyBytes': bytes_used(backup),
                            'references': [str(reference.relative_to(ROOT))], 'sourceRetained': True,
                            'mappings': [{'source': str(backup), 'destination': str(archived)}],
                            'retention': 'same evidence budget; backups never evicted automatically'})
    # Explicitly referenced results are evidence, never a cache eviction candidate.
    references = {}
    for base in (ROOT / '.scratch/supervision', ROOT / 'docs'):
        for document in base.rglob('*.md'):
            for token in re.findall(r'/(?:private/)?tmp/[^`\s)<>]+\.xcresult', document.read_text(errors='replace')):
                source = Path(token).resolve()
                if source.is_dir():
                    references.setdefault(str(source), []).append(str(document.relative_to(ROOT)))
    for old, refs in references.items():
        source = Path(old)
        destination = EVIDENCE / 'archived-results' / source.name
        entries.append({'source': old, 'destination': str(destination), 'kind': 'evidence', 'components': ['.'],
                        'copyBytes': resources.size(source), 'references': refs, 'sourceRetained': True,
                        'mappings': [{'source': old, 'destination': str(destination)}],
                        'retention': 'frozen reviewed list only; stop new migration beyond 8 GiB evidence budget; never auto-delete'})
    for source in Path('/private/tmp').glob('issue11-english-query-selection-freeze*.json'):
        destination = EVIDENCE / 'archived-model-freezes' / source.name
        entries.append({'source': str(source), 'destination': str(destination), 'kind': 'evidence',
                        'components': ['.'], 'copyBytes': bytes_used(source), 'sourceRetained': True,
                        'mappings': [{'source': str(source), 'destination': str(destination)}],
                        'references': ['.scratch/supervision/issue-11/english-query-offline-selection.py'],
                        'retention': 'frozen reviewed model provenance; same 8 GiB evidence budget'})
    value = {'schema': 1, 'workspace': str(ROOT), 'inventoryMeasuredAt': inventory.get('measuredAt'),
             'created': time.time(), 'entries': entries, 'totalCopyBytes': sum(e['copyBytes'] for e in entries),
             'maximumLegacyBytes': MAX_LEGACY_BYTES, 'deletion': False,
             'excludedActiveDerived': ['/private/tmp/shudeng-issue11-fix-derived', '/private/tmp/shudeng-deepseek-anthropic-derived'],
             'notes': ['No historical source/Products/backup/xcresult is removed.',
                       'Only mapped execution paths change; original evidence manifests remain available.',
                       'Current process/open-file checks are mandatory again during apply.']}
    resources.write_json(EVIDENCE / 'migration-plan.json', value)
    return value


def venv_rewrite(destination, source):
    changes = []
    for path in (destination / 'bin').glob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        raw = path.read_bytes()
        if b'\0' in raw:
            continue
        updated = raw
        for alias in (str(source), str(source).replace('/private/tmp/', '/tmp/', 1)):
            updated = updated.replace(alias.encode(), str(destination).encode())
        if updated == raw:
            continue
        path.write_bytes(updated)
        changes.append({'path': str(path.relative_to(destination)),
                        'oldSHA256': hashlib.sha256(raw).hexdigest(),
                        'newSHA256': hashlib.sha256(updated).hexdigest()})
    return changes


def relocate_readium_metadata(destination, mappings, evidence=EVIDENCE):
    """Called only under dependencies.lock, with the dependency tree idle."""
    destination = Path(destination).resolve()
    metadata = destination / 'workspace-state.json'
    original = metadata.read_bytes()
    value = json.loads(original)
    artifacts = value.get('object', {}).get('artifacts')
    if not isinstance(artifacts, list):
        raise RuntimeError(f'Unsupported SwiftPM artifact metadata: {metadata}')
    changes = []
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise RuntimeError('Invalid SwiftPM artifact entry')
        identity = artifact.get('packageRef', {}).get('identity')
        target = artifact.get('targetName')
        if not all(isinstance(part, str) and part not in ('', '.', '..') and
                   Path(part).name == part for part in (identity, target)):
            raise RuntimeError('Invalid SwiftPM artifact identity or target')
        expected = destination / 'artifacts' / identity / target / (target + '.xcframework')
        old = artifact.get('path')
        if not isinstance(old, str) or not Path(old).is_absolute() or map_path(old, mappings) != str(expected):
            raise RuntimeError(f'Unmapped or unexpected SwiftPM artifact path: {old}')
        if expected.resolve() != expected or not (expected / 'Info.plist').is_file():
            raise RuntimeError(f'Missing or redirected migrated xcframework: {expected}')
        info = plistlib.loads((expected / 'Info.plist').read_bytes())
        libraries = info.get('AvailableLibraries', [])
        if not libraries:
            raise RuntimeError(f'No xcframework slices: {expected}')
        for library in libraries:
            slice_path = expected / library['LibraryIdentifier'] / library['LibraryPath']
            if not slice_path.resolve().is_relative_to(expected) or not slice_path.exists():
                raise RuntimeError(f'Missing or redirected xcframework slice: {slice_path}')
        if old != str(expected):
            artifact['path'] = str(expected)
            changes.append({'old': old, 'new': str(expected)})
    old_sha = hashlib.sha256(original).hexdigest()
    row = {'path': str(metadata), 'oldSHA256': old_sha, 'changes': changes}
    if changes:
        archive = Path(evidence) / 'original-dependency-metadata' / (old_sha + '.json')
        archive.parent.mkdir(parents=True, exist_ok=True)
        if archive.exists():
            if archive.read_bytes() != original:
                raise RuntimeError(f'Dependency metadata archive mismatch: {archive}')
        else:
            archive.write_bytes(original)
        resources.write_json(metadata, value)
        row['original'] = str(archive)
    row['newSHA256'] = digest(metadata)
    return row


def repair_readium_metadata():
    with resources.lock(BASE / 'dependencies.lock', blocking=False):
        destination = resources.dependency_path(ROOT)
        registry = resources.read_json(BASE / 'path-migrations.json', {})
        mappings = [m for m in registry.get('mappings', []) if m.get('verified')
                    and Path(m['destination']) == destination
                    and Path(m['source']) == Path('/private/tmp/shudeng-readium-spm')]
        if len(mappings) != 1:
            raise RuntimeError('Readium migration lacks one verified source/destination mapping')
        if in_use(destination):
            raise RuntimeError(f'Dependency active or process inspection unavailable: {destination}')
        row = relocate_readium_metadata(destination, mappings)
        resources.write_json(EVIDENCE / 'readium-metadata-repair.json', row)
        return row


def apply(path, selected=()):
    value = resources.read_json(path, {})
    if value.get('workspace') != str(ROOT) or value.get('schema') != 1:
        raise RuntimeError('Plan workspace/schema mismatch')
    entries = [e for e in value['entries'] if not selected or Path(e['source']).name in selected]
    if not entries:
        raise RuntimeError('No selected migration entries')
    retained = sum(resources.size(BASE / name) for name in ('legacy', 'dependencies'))
    fresh = [e for e in entries if not Path(e['destination']).exists()]
    if sum(e['copyBytes'] for e in fresh if e['kind'] != 'evidence') + retained > MAX_LEGACY_BYTES:
        raise RuntimeError('Legacy migration retention budget exceeded')
    evidence_bytes = sum(resources.size(EVIDENCE / name) for name in ('archived-results', 'archived-backups'))
    if sum(e['copyBytes'] for e in fresh if e['kind'] == 'evidence') + evidence_bytes > 8 * 1024**3:
        raise RuntimeError('Evidence migration retention budget exceeded')
    need = sum(e['copyBytes'] for e in entries if not Path(e['destination']).exists())
    if shutil.disk_usage(ROOT).free - need < resources.MIN_FREE:
        raise RuntimeError('Migration would leave less than 10 GiB free')
    audit = resources.read_json(EVIDENCE / 'migration-audit.json', {'schema': 1, 'entries': []})
    audit.update(started=time.time(), planSHA256=tree(path))
    with resources.lock(BASE / 'dependencies.lock'), resources.lock(BASE / 'legacy.lock'):
        registry = resources.read_json(BASE / 'path-migrations.json', {'schema': 1, 'mappings': []})
        audit['recoveredUnregisteredMigrationDirectories'] = reap_migration_runs(registry)
        for entry in entries:
            source, destination = map(Path, (entry['source'], entry['destination']))
            if in_use(source):
                raise RuntimeError(f'Source active or process inspection unavailable: {source}')
            if destination.exists():
                mappings = entry.get('mappings', [{'source': str(source), 'destination': str(destination)}])
                if all(any(m['source'] == pair['source'] and m['destination'] == pair['destination'] and m.get('verified') for m in registry['mappings']) for pair in mappings):
                    if entry['kind'] == 'readium':
                        if in_use(destination):
                            raise RuntimeError(f'Dependency active or process inspection unavailable: {destination}')
                        row = relocate_readium_metadata(destination, mappings)
                        resources.write_json(EVIDENCE / 'readium-metadata-repair.json', row)
                    continue
                raise RuntimeError(f'Destination already exists without verified mapping: {destination}')
            destination.parent.mkdir(parents=True, exist_ok=True)
            staging = destination.with_name(destination.name + '.migration-' + uuid.uuid4().hex)
            owner_path = BASE / 'migration-runs' / (uuid.uuid4().hex + '.json')
            resources.write_json(owner_path, {'schema': 1, 'root': str(ROOT), 'pid': os.getpid(),
                                             'staging': str(staging), 'destination': str(destination)})
            row = {'source': str(source), 'destination': str(destination), 'components': []}
            installed = False
            committed = False
            try:
                if source.is_dir():
                    staging.mkdir()
                for component in entry['components']:
                    old, new = (source / component, staging / component) if source.is_dir() else (source, staging)
                    before = tree(old)
                    if old.is_dir():
                        shutil.copytree(old, new, symlinks=True, dirs_exist_ok=True)
                    else:
                        new.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(old, new)
                    after = tree(new)
                    if before != after or before != tree(old):
                        raise RuntimeError(f'Copy verification failed: {old}')
                    row['components'].append({'path': component, 'sourceSHA256': before, 'copySHA256': after})
                staging.rename(destination)
                installed = True
                if entry['kind'] == 'venv':
                    row['rewrittenBinFiles'] = venv_rewrite(destination, source)
                    probe = subprocess.run([str(destination / 'bin/python'), '-c', 'import sys, importlib.metadata; print(sys.prefix); [print(n, importlib.metadata.version(n)) for n in ("onnxruntime","tokenizers","numpy","regex")]'], capture_output=True, text=True)
                    if probe.returncode or probe.stdout.splitlines()[0] != str(destination):
                        raise RuntimeError('Relocated venv validation failed')
                    row['venvProbe'] = probe.stdout.splitlines()
                if entry['kind'] == 'readium':
                    row['artifactMetadataChanges'] = relocate_readium_metadata(destination, entry.get('mappings', []))
                    resources.write_json(destination.parent / 'owner.json', {'schema': 1, 'root': str(ROOT), 'key': resources.dependency_key(ROOT)})
                if entry['kind'] == 'snapshot':
                    row['productPathChanges'] = relocate_products(destination, entry.get('mappings', []))
                for pair in entry.get('mappings', [{'source': str(source), 'destination': str(destination)}]):
                    registry['mappings'].append({**pair, 'verified': True})
                resources.write_json(BASE / 'path-migrations.json', registry)
                committed = True
                audit['entries'].append(row)
                resources.write_json(EVIDENCE / 'migration-audit.json', audit)
            except BaseException:
                # Only this attempt's unregistered destination can be rolled back.
                if installed and not committed:
                    shutil.rmtree(destination) if destination.is_dir() else destination.unlink()
                raise
            finally:
                if staging.exists():
                    shutil.rmtree(staging) if staging.is_dir() else staging.unlink()
                owner_path.unlink(missing_ok=True)
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('plan', 'apply', 'repair-readium-metadata'))
    parser.add_argument('--plan', type=Path, default=EVIDENCE / 'migration-plan.json')
    parser.add_argument('--only', action='append', default=[])
    args = parser.parse_args()
    result = (plan() if args.command == 'plan' else repair_readium_metadata()
              if args.command == 'repair-readium-metadata' else apply(args.plan, args.only))
    print(json.dumps({'plan': str(EVIDENCE / 'migration-plan.json'), 'entries': len(result['entries']),
                      'copyGiB': round(result['totalCopyBytes']/1024**3, 3)}
                     if args.command == 'plan' else result, indent=2))


if __name__ == '__main__':
    main()
