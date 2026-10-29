#!/usr/bin/env python3
"""Small offline contract check; no build, AI, simulator, or historical deletion."""
from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import test_resources as resources

OUT = ROOT / '.scratch/delivery/test-resource-cleanup'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_readium_metadata():
    from scripts import migrate_test_resources as migration
    directory = resources.BASE / ('metadata-contract-' + uuid.uuid4().hex)
    destination = directory / 'readium'
    metadata = destination / 'workspace-state.json'
    source = '/private/tmp/shudeng-readium-spm'
    mappings = [{'source': source, 'destination': str(destination)}]
    cases = []
    try:
        artifacts = []
        for target in ('onnxruntime', 'onnxruntime_extensions'):
            relative = Path('artifacts/package') / target / (target + '.xcframework')
            framework = destination / relative
            (framework / 'ios-simulator').mkdir(parents=True)
            (framework / 'ios-simulator/library.a').write_bytes(b'fixture')
            (framework / 'Info.plist').write_bytes(plistlib.dumps({'AvailableLibraries': [
                {'LibraryIdentifier': 'ios-simulator', 'LibraryPath': 'library.a'}]}))
            artifacts.append({'packageRef': {'identity': 'package'}, 'targetName': target,
                              'source': {'checksum': target, 'url': 'https://example.invalid'},
                              'path': '/tmp/shudeng-readium-spm/' + str(relative)})
        initial = {'version': 7, 'object': {'artifacts': artifacts, 'dependencies': [{'subpath': 'unchanged'}]}}
        resources.write_json(metadata, initial)
        row = migration.relocate_readium_metadata(destination, mappings, directory / 'evidence')
        assert len(row['changes']) == 2 and sha(row['original']) == row['oldSHA256']
        expected = json.loads(json.dumps(initial))
        for artifact in expected['object']['artifacts']:
            artifact['path'] = artifact['path'].replace('/tmp/shudeng-readium-spm', str(destination), 1)
        assert json.loads(metadata.read_text()) == expected
        cases.append('two-paths-relocated-other-fields-preserved')
        before, mtime = metadata.read_bytes(), metadata.stat().st_mtime_ns
        row = migration.relocate_readium_metadata(destination, mappings, directory / 'evidence')
        assert not row['changes'] and metadata.read_bytes() == before and metadata.stat().st_mtime_ns == mtime
        cases.append('second-run-byte-and-mtime-idempotent')
        for case in ('outside-mapping', 'missing-framework', 'missing-slice'):
            value = json.loads(json.dumps(initial))
            if case == 'outside-mapping':
                value['object']['artifacts'][1]['path'] = '/tmp/unregistered/artifacts/package/onnxruntime_extensions/onnxruntime_extensions.xcframework'
            elif case == 'missing-framework':
                (framework / 'Info.plist').unlink()
            else:
                (framework / 'Info.plist').write_bytes(plistlib.dumps({'AvailableLibraries': [
                    {'LibraryIdentifier': 'absent', 'LibraryPath': 'library.a'}]}))
            resources.write_json(metadata, value)
            before = metadata.read_bytes()
            try:
                migration.relocate_readium_metadata(destination, mappings, directory / 'evidence')
                raise AssertionError(f'Accepted invalid metadata: {case}')
            except RuntimeError:
                assert metadata.read_bytes() == before, case
            cases.append(case + '-refused-without-write')
        return cases
    finally:
        if directory.exists():
            shutil.rmtree(directory)


def main():
    if sys.argv[1:] == ['--readium-metadata-only']:
        report = {'status': 'PASS', 'readiumMetadataCases': verify_readium_metadata()}
        resources.write_json(OUT / 'readium-metadata-contract-check.json', report)
        print(json.dumps(report, indent=2))
        return
    audit = resources.read_json(OUT / 'script-adaptation-audit.json', {})
    scripts = [ROOT / name for name in audit['files']]
    scripts += [ROOT / 'scripts' / name for name in ('legacy_test_resources.py',
                'migrate_test_resources.py', 'refresh_test_resource_references.py',
                'test_restore_backup.py', 'verify_legacy_test_resources.py')]
    for path in scripts:
        if path.suffix == '.py':
            ast.parse(path.read_text(), filename=str(path))
        elif path.suffix == '.sh':
            subprocess.run(['sh', '-n', str(path)], check=True)
    registry = resources.read_json(resources.BASE / 'path-migrations.json', {})
    missing = [m['destination'] for m in registry['mappings'] if m.get('verified') and not Path(m['destination']).exists()]
    assert not missing, missing
    manifest_checks = []
    refresh = resources.read_json(OUT / 'reference-refresh-audit.json', {})
    initial = resources.read_json(OUT / 'reference-refresh-initial-audit.json', {})
    final_changes = {row['file']: row for row in [*initial.get('changes', []), *refresh.get('changes', [])]}
    for row in final_changes.values():
        path = ROOT / row['file']
        assert sha(path) == row['newSHA256'], str(path)
        assert sha(ROOT / row['original']) == row['oldSHA256'], row['original']
        value = json.loads(path.read_text())
        for name, expected in value.get('files', {}).items():
            if not isinstance(expected, dict) or 'sha256' not in expected:
                continue
            target = path.parent / name
            if target.is_file() and str(target.relative_to(ROOT)) in audit['files']:
                assert sha(target) == expected['sha256'], str(target)
                manifest_checks.append(str(target.relative_to(ROOT)))
        if path.name == 'workspace.json':
            for field in ('sourceTree', 'xctestrun'):
                assert Path(value[field]).exists(), (str(path), field)
    # Local throwaway fixtures have explicit ownership and are always removed.
    spec = importlib.util.spec_from_file_location('test_restore_contract', ROOT / 'scripts/test_restore_backup.py')
    restore = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(restore)
    restore.BASE.mkdir(parents=True, exist_ok=True)
    fixtures, cases = [], []
    try:
        for case in ('dead-created-with-copy', 'pending-empty', 'external-change'):
            directory = restore.BASE / ('contract-' + uuid.uuid4().hex)
            directory.mkdir()
            fixtures.append(directory)
            original = directory / 'original.epub'
            target = directory / 'fixture.epub'
            original.write_bytes(b'fixture original epub')
            target.write_bytes(b'' if case == 'pending-empty' else b'user modified data')
            resources.write_json(directory / 'owner.json', {'schema': 1, 'root': str(ROOT),
                'pid': 99999999, 'state': 'created' if case.startswith('dead-') else 'pending-empty-file-fault',
                'target': str(target), 'sha256': sha(original)})
            try:
                restore.restore(directory)
                assert case != 'external-change' and not directory.exists()
            except RuntimeError:
                assert case == 'external-change' and original.exists() and target.read_bytes() == b'user modified data'
            cases.append(case)
    finally:
        for directory in fixtures:
            if directory.exists():
                shutil.rmtree(directory)
    mismatches = []
    for row in refresh.get('preExistingMismatchesNotReleased', []):
        path = ROOT / row['file']
        value = resources.read_json(path, {})
        mismatches.append({**row, 'preservedExpectedSHA256': value.get('controllerSHA256'),
                           'currentMainControllerSHA256': sha(ROOT / '.scratch/delivery/issue-11-card-pilot/controller.py')})
    report = {'syntaxScripts': len(scripts), 'verifiedMappings': len(registry['mappings']),
              'manifestScriptHashesChecked': len(set(manifest_checks)), 'restoreCases': cases,
              'readiumMetadataCases': verify_readium_metadata(),
              'preExistingControllerPinsPreserved': mismatches, 'status': 'PASS'}
    resources.write_json(OUT / 'legacy-contract-check.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
