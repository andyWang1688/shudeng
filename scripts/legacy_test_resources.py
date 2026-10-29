#!/usr/bin/env python3
"""Path adapter and serialized process runner for frozen historical test entries.

Historical manifests retain their original bytes/hashes. Only verified path
mappings affect execution; this adapter never releases AI authorization gates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess as _subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import test_resources as resources

STDOUT = _subprocess.STDOUT
DEVNULL = _subprocess.DEVNULL
PIPE = _subprocess.PIPE
TimeoutExpired = _subprocess.TimeoutExpired
CalledProcessError = _subprocess.CalledProcessError
resolve_path = resources.resolve_path


def resolve_data(value):
    if isinstance(value, dict):
        return {str(resolve_path(k)) if k.startswith('/') else k: resolve_data(v)
                for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_data(item) for item in value]
    if isinstance(value, str) and value.startswith('/'):
        return str(resolve_path(value))
    return value


def _adapt(argv):
    if not isinstance(argv, (list, tuple)):
        return argv
    argv = list(map(str, argv))
    if argv and Path(argv[0]).name == 'xcodebuild':
        return [sys.executable, str(Path(__file__)), 'xcodebuild', '--', *argv[1:]]
    return [str(resolve_path(arg)) if arg.startswith('/') else arg for arg in argv]


def run(argv, *args, **kwargs):
    if kwargs.get('cwd') is not None:
        kwargs['cwd'] = resolve_path(kwargs['cwd'])
    return _subprocess.run(_adapt(argv), *args, **kwargs)


def Popen(argv, *args, **kwargs):
    if kwargs.get('cwd') is not None:
        kwargs['cwd'] = resolve_path(kwargs['cwd'])
    return _subprocess.Popen(_adapt(argv), *args, **kwargs)


def check_output(argv, *args, **kwargs):
    return _subprocess.check_output(_adapt(argv), *args, **kwargs)


def persistent_path(path):
    mapped = resolve_path(path)
    if str(mapped).startswith(('/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/')):
        raise RuntimeError(f'Historical output has not been migrated: {path}; run migrate_test_resources.py plan first')
    return mapped


def wait_process(argv, env=None):
    # Preserve live stdout for fault watchers while owning the entire child group.
    child = _subprocess.Popen(argv, env=env, start_new_session=True)
    resources.CHILDREN.add(child.pid)
    try:
        return child.wait()
    except BaseException:
        try:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=5)
        except _subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        except ProcessLookupError:
            pass
        raise
    finally:
        resources.CHILDREN.discard(child.pid)


def execute(argv, *, build=False):
    if os.environ.get('SHUDENG_LEGACY_LOCKED') == '1':
        raise RuntimeError('Nested legacy resource lock is not allowed')
    with resources.resume({}, ROOT / '.scratch/test-logs/legacy-reference.json'):
        if build:
            resources.check_space(ROOT)
            if resources.size(resources.BASE / 'legacy/probes') > 4 * 1024**3:
                raise RuntimeError('Legacy probe cache reached its 4 GiB retention limit')
        env = {**os.environ, 'SHUDENG_LEGACY_LOCKED': '1'}
        return wait_process(argv, env=env)


def managed_build(argv, original):
    if os.environ.get('SHUDENG_LEGACY_LOCKED') == '1':
        raise RuntimeError('Nested legacy build lock is not allowed')
    project = argv[argv.index('-project') + 1] if '-project' in argv else 'ios/Shudeng.xcodeproj'
    source = Path(project).resolve().parent
    flags = resources.canonical_flags(argv)
    profile_key = hashlib.sha256((str(source) + json.dumps(flags)).encode()).hexdigest()
    reference = resources.BASE / 'legacy-profiles' / (profile_key + '.json')
    with resources.ManagedBuild(ROOT, 'legacy-' + profile_key, inputs=(source,),
                                flags=flags, reference=reference) as resource:
        if not resource.packages.is_dir():
            raise RuntimeError('Persistent Readium dependency cache is missing')
        command = resources.replace_arg(argv, '-derivedDataPath', resource.derived)
        command = resources.replace_arg(command, '-clonedSourcePackagesDirPath', resource.packages)
        command = resources.replace_arg(command, '-packageCachePath', resource.caches / 'packages')
        code = wait_process(['xcodebuild', *command], env={**os.environ, **resource.env})
        if code:
            return code
        resource.ready()
        state = {**resource.fields(), 'profile': profile_key, 'project': str(source),
                 'derivedData': str(resource.derived), 'argv': command}
        resources.write_json(reference, state)
        resource.pin(reference)
        if original:
            with resources.lock(resources.BASE / 'registry.lock'):
                path = resources.BASE / 'path-migrations.json'
                registry = resources.read_json(path, {'schema': 1, 'mappings': []})
                registry['mappings'] = [m for m in registry['mappings'] if m['source'] != str(original)]
                registry['mappings'].append({'source': str(original), 'destination': str(resource.derived), 'verified': True})
                resources.write_json(path, registry)
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('xcodebuild', 'locked', 'resolve', 'output'))
    parser.add_argument('argv', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    argv = args.argv[1:] if args.argv[:1] == ['--'] else args.argv
    if args.command in ('resolve', 'output'):
        print(persistent_path(argv[0]) if args.command == 'output' else resolve_path(argv[0]))
        return 0
    if args.command == 'locked':
        return execute(argv, build=True)
    original = Path(argv[argv.index('-derivedDataPath') + 1]) if '-derivedDataPath' in argv else None
    argv = [str(resolve_path(arg)) if arg.startswith('/') else arg for arg in argv]
    building = any(item in argv for item in ('build', 'build-for-testing', 'test'))
    if '-resultBundlePath' in argv:
        at = argv.index('-resultBundlePath') + 1
        result = Path(argv[at])
        if str(result).startswith(('/tmp/', '/private/tmp/')):
            result = ROOT / '.scratch/test-evidence/legacy' / result.name
            result.parent.mkdir(parents=True, exist_ok=True)
            argv[at] = str(result)
    argv = resources.persistent_result(argv, 'legacy')
    if building:
        return managed_build(argv, original)
    return execute(['xcodebuild', *argv])


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, resources.interrupted)
    signal.signal(signal.SIGINT, resources.interrupted)
    try:
        raise SystemExit(main())
    except (RuntimeError, KeyboardInterrupt) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
