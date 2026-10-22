#!/usr/bin/env python3
"""Owned, bounded local test caches. Evidence never lives in this directory.

Prepared workspaces pin their cache until release; a dead prepare process alone
is not permission to discard a workspace consumed by a later run command.
Only directories carrying our manifest are eligible for automatic reclamation.
Historical directories require the separate, explicitly approved migration.
"""
from __future__ import annotations

import argparse
import atexit
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.build/test-resources'
SCHEMA = 1
MIN_FREE = 10 * 1024**3
MAX_CACHES = 3
MAX_BYTES = 12 * 1024**3
MAX_DEPENDENCIES = 2
MAX_DEPENDENCY_BYTES = 6 * 1024**3
MAX_EVIDENCE_BUNDLES = 100
MAX_EVIDENCE_BYTES = 8 * 1024**3
CHILDREN: set[int] = set()


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def lock(path, *, blocking=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


@contextlib.contextmanager
def cleanup_signals():
    if threading.current_thread() is not threading.main_thread():
        yield
        return
    previous = {number: signal.signal(number, interrupted)
                for number in (signal.SIGINT, signal.SIGTERM)}
    try:
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def resolve_path(path):
    """Resolve only verified, explicitly migrated paths; retain legacy fallbacks."""
    value = Path(path)
    mappings = read_json(BASE / 'path-migrations.json', {}).get('mappings', [])
    for item in sorted(mappings, key=lambda row: len(row['source']), reverse=True):
        if not item.get('verified'):
            continue
        source = Path(item['source'])
        for spelling in (value, Path(os.path.realpath(value))):
            for prefix in (source, Path(os.path.realpath(source))):
                try:
                    return Path(item['destination']) / spelling.relative_to(prefix)
                except ValueError:
                    pass
    return value


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, ValueError, TypeError):
        return True


def in_use(path):
    """Failure to inspect open files is not proof that a directory is idle."""
    try:
        result = subprocess.run(['lsof', '-nP', '-F', 'n', '+D', str(path)],
                                capture_output=True, text=True, timeout=30)
        return result.returncode not in (0, 1) or bool(result.stderr.strip()) or any(
            line.startswith('n') for line in result.stdout.splitlines())
    except (OSError, subprocess.TimeoutExpired):
        return True


def valid_reference(run, manifest):
    references = manifest.get('references', [manifest.get('reference')])
    for reference in references:
        if reference:
            value = read_json(reference, {})
            if value.get('resourceRun') == str(run) and not value.get('resourceReleased', False):
                return True
    return False


def size(path):
    total = 0
    for parent, dirs, files in os.walk(path, followlinks=False):
        dirs[:] = [name for name in dirs if not (Path(parent) / name).is_symlink()]
        for name in files:
            item = Path(parent) / name
            if not item.is_symlink():
                try:
                    total += item.stat().st_size
                except FileNotFoundError:
                    pass
    return total


def reap(base=BASE, *, reserve_slots=0):
    """Reap our own abandoned runs, then bounded unpinned caches."""
    base = Path(base)
    report = {'removedRuns': [], 'removedCaches': [], 'retained': []}
    with lock(base / 'registry.lock'):
        pins = set()
        for run in (base / 'runs').glob('*'):
            manifest = read_json(run / 'owner.json', {})
            if manifest.get('schema') != SCHEMA or manifest.get('root') != str(ROOT):
                continue
            protected = (valid_reference(run, manifest) or alive(manifest.get('pid')) or
                         any(alive(pid) for pid in manifest.get('children', [])))
            if protected:
                pins.add(manifest.get('cache'))
                report['retained'].append(str(run))
                continue
            try:
                with lock(base / 'locks' / (manifest['key'] + '.lock'), blocking=False):
                    cache = Path(manifest['cache']) if manifest.get('cache') else None
                    if in_use(run) or (cache and cache.exists() and in_use(cache)):
                        pins.add(manifest.get('cache'))
                        report['retained'].append(str(run))
                    else:
                        shutil.rmtree(run)
                        report['removedRuns'].append(str(run))
            except BlockingIOError:
                pins.add(manifest.get('cache'))
        entries = []
        for cache in (base / 'caches').glob('*'):
            state = read_json(cache / 'cache.json', {})
            if state.get('schema') == SCHEMA and state.get('root') == str(ROOT):
                entries.append((cache, state, size(cache)))
        entries.sort(key=lambda item: item[1].get('used', 0), reverse=True)
        retained_bytes = sum(item[2] for item in entries)
        retained_count = len(entries)
        for cache, state, cache_bytes in reversed(entries):
            incomplete = state.get('state') != 'ready'
            over_limit = retained_count > MAX_CACHES - reserve_slots or retained_bytes > MAX_BYTES
            if str(cache) in pins or not (incomplete or over_limit):
                continue
            try:
                with lock(base / 'locks' / (cache.name + '.lock'), blocking=False):
                    if in_use(cache):
                        continue
                    shutil.rmtree(cache)
                    report['removedCaches'].append(str(cache))
                    retained_count -= 1
                    retained_bytes -= cache_bytes
            except BlockingIOError:
                continue
        # Dependency sets remain while any retained cache references them.
        dependency_pins = {read_json(path / 'cache.json', {}).get('dependencyKey')
                           for path in (base / 'caches').glob('*')}
        dependencies = []
        for path in (base / 'dependencies').glob('*'):
            if len(path.name) != 64 or any(char not in '0123456789abcdef' for char in path.name):
                continue  # Python environments have a separate migration/retention owner.
            owner = read_json(path / 'owner.json', {})
            if owner.get('schema') == SCHEMA and owner.get('root') == str(ROOT):
                dependencies.append((path, size(path)))
        dependencies.sort(key=lambda item: item[0].stat().st_mtime, reverse=True)
        total_bytes = sum(item[1] for item in dependencies)
        count = len(dependencies)
        for path, path_bytes in reversed(dependencies):
            if count <= MAX_DEPENDENCIES and total_bytes <= MAX_DEPENDENCY_BYTES:
                break
            if path.name in dependency_pins:
                continue
            try:
                with lock(base / 'dependencies.lock', blocking=False):
                    if not in_use(path):
                        shutil.rmtree(path)
                        count -= 1
                        total_bytes -= path_bytes
            except BlockingIOError:
                break
    return report


def fingerprint(paths, flags=(), *, toolchain=True, base=BASE):
    """Content hashes include uncommitted sources and injected tests/resources."""
    base = Path(base)
    with lock(base / 'digest.lock'):
        index = read_json(base / 'digests.json', {})
        digest = hashlib.sha256()
        for source in paths:
            source = Path(source).resolve()
            digest.update(source.name.encode())
            files = sorted(source.rglob('*')) if source.is_dir() else [source]
            for file in files:
                relative = file.relative_to(source) if source.is_dir() else Path(source.name)
                if not file.is_file() or any(part in {'.git', '.build', 'DerivedData',
                        'xcuserdata', '__pycache__', '.DS_Store'} for part in relative.parts):
                    continue
                stat = file.stat()
                identity = [stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino]
                record = index.get(str(file))
                if not record or record['identity'] != identity:
                    with file.open('rb') as stream:
                        content = hashlib.file_digest(stream, 'sha256').hexdigest()
                    record = {'identity': identity, 'sha256': content}
                    index[str(file)] = record
                digest.update(str(relative).encode())
                digest.update(record['sha256'].encode())
        write_json(base / 'digests.json', index)
    digest.update(json.dumps(list(flags), sort_keys=True).encode())
    if toolchain:
        for argv in (['xcode-select', '-p'], ['xcodebuild', '-version'],
                     ['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'],
                     ['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path']):
            result = subprocess.run(argv, capture_output=True, check=True)
            digest.update(result.stdout)
        digest.update(os.environ.get('DEVELOPER_DIR', '').encode())
        names = ('SDKROOT', 'ARCHS', 'SWIFT_VERSION', 'OTHER_SWIFT_FLAGS', 'OTHER_CFLAGS',
                 'OTHER_LDFLAGS', 'SWIFT_OPTIMIZATION_LEVEL', 'CONFIGURATION', 'CC', 'CXX',
                 'SWIFT_EXEC', 'TOOLCHAINS', 'IPHONEOS_DEPLOYMENT_TARGET')
        digest.update(json.dumps({name: os.environ.get(name) for name in names}, sort_keys=True).encode())
        digest.update(os.uname().machine.encode())
    return digest.hexdigest()


def dependency_key(root=ROOT):
    root = Path(root)
    return fingerprint([root / 'Vendor', root / 'ios/Shudeng.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'],
                       toolchain=False, base=root / '.build/test-resources')


def dependency_path(root=ROOT):
    return Path(root) / '.build/test-resources/dependencies' / dependency_key(root) / 'readium'


def check_space(root=ROOT):
    free = shutil.disk_usage(root).free
    if free < MIN_FREE:
        raise RuntimeError(f'Only {free / 1024**3:.2f} GiB free; a build requires at least 10 GiB')


class ManagedBuild:
    def __init__(self, root, profile, inputs=(), flags=(), reference=None, *,
                 base=None, toolchain=True, large=True, key=None):
        self.root = Path(root).resolve()
        self.base = Path(base) if base else self.root / '.build/test-resources'
        self.profile = profile
        self.inputs = [self.root / 'ios', self.root / 'Vendor', *map(Path, inputs)]
        self.key = key or fingerprint(self.inputs, flags, toolchain=toolchain, base=self.base)
        self.cache = self.base / 'caches' / self.key
        self.source = self.cache / 'source'
        self.derived = self.cache / 'derived'
        self.caches = self.cache / 'modules'
        self.dependency_key = dependency_key(self.root) if toolchain else 'contract-test'
        self.packages = self.base / 'dependencies' / self.dependency_key / 'readium'
        self.work = self.base / 'runs' / uuid.uuid4().hex
        self.reference = Path(reference) if reference else None
        self.large = large
        self.pinned = False
        self.metadata = {}
        self.reused = False
        self.cache_owned = False
        self.stack = contextlib.ExitStack()

    def __enter__(self):
        reap(self.base)
        self.stack.enter_context(lock(self.base / 'dependencies.lock'))
        self.stack.enter_context(lock(self.base / 'locks' / (self.key + '.lock')))
        self.stack.enter_context(cleanup_signals())
        try:
            state = read_json(self.cache / 'cache.json', {})
            self.reused = state.get('state') == 'ready' and self.derived.is_dir()
            self.metadata = state.get('metadata', {})
            for run in (self.base / 'runs').glob('*'):
                owner = read_json(run / 'owner.json', {})
                if owner.get('cache') == str(self.cache) and not valid_reference(run, owner):
                    if alive(owner.get('pid')) or (self.cache.exists() and in_use(self.cache)):
                        raise RuntimeError('The cache still belongs to a running or interrupted task')
            existing = list((self.base / 'caches').glob('*'))
            if not self.cache.exists() and (len(existing) >= MAX_CACHES or
                    sum(size(path) for path in existing) >= MAX_BYTES):
                reap(self.base, reserve_slots=1)
                existing = list((self.base / 'caches').glob('*'))
            if not self.cache.exists() and (len(existing) >= MAX_CACHES or
                    sum(size(path) for path in existing) >= MAX_BYTES):
                raise RuntimeError('Cache retention limit reached; release a prepared profile before building another')
            self.work.mkdir(parents=True)
            write_json(self.work / 'owner.json', {
                'schema': SCHEMA, 'root': str(ROOT), 'pid': os.getpid(),
                'cache': str(self.cache), 'key': self.key, 'profile': self.profile,
                'reference': None, 'created': time.time(),
                'session': os.environ.get('SHUDENG_TEST_SCRATCH'),
            })
            self.cache_owned = True
            self.cache.mkdir(parents=True, exist_ok=True)
            self.caches.mkdir(exist_ok=True)
            (self.work / 'tmp').mkdir()
            self.state = state if self.reused else {
                'schema': SCHEMA, 'root': str(ROOT), 'state': 'building',
                'key': self.key, 'profile': self.profile, 'metadata': {},
                'dependencyKey': self.dependency_key,
            }
            self.state['used'] = time.time()
            write_json(self.cache / 'cache.json', self.state)
            if self.large and not self.reused:
                check_space(self.root)
            return self
        except BaseException:
            shutil.rmtree(self.work, ignore_errors=True)
            if self.cache_owned and not self.reused:
                shutil.rmtree(self.cache, ignore_errors=True)
            self.stack.close()
            raise

    def copy_source(self):
        if not self.source.exists():
            self.source.mkdir()
            shutil.copytree(self.root / 'ios', self.source / 'ios',
                ignore=shutil.ignore_patterns('.build', 'DerivedData', 'xcuserdata',
                                             '*.xcuserstate', '.DS_Store'))
            (self.source / 'Vendor').symlink_to(self.root / 'Vendor', target_is_directory=True)
        return self.source

    @property
    def env(self):
        return {
            'CLANG_MODULE_CACHE_PATH': str(self.caches / 'clang'),
            'SWIFT_MODULE_CACHE_PATH': str(self.caches / 'swift'),
            'SWIFTPM_MODULECACHE_OVERRIDE': str(self.caches / 'swiftpm'),
            'TMPDIR': str(self.work / 'tmp') + '/',
        }

    def ready(self, metadata=None):
        reap(self.base)
        cache_bytes = sum(size(path) for path in (self.base / 'caches').glob('*'))
        if cache_bytes > MAX_BYTES:
            raise RuntimeError('Built cache exceeds the retention byte limit; release another prepared profile')
        self.state.update(state='ready', used=time.time(),
                          metadata=self.metadata if metadata is None else metadata)
        write_json(self.cache / 'cache.json', self.state)

    def fields(self):
        return {'resourceRun': str(self.work), 'resourceCache': str(self.cache),
                'resourceKey': self.key, 'resourceReleased': False,
                'cacheReused': self.reused}

    def pin(self, reference):
        reference = Path(reference).resolve()
        if read_json(reference, {}).get('resourceRun') != str(self.work):
            raise RuntimeError('A prepared reference must contain resourceRun before pinning')
        value = read_json(self.work / 'owner.json')
        value['reference'] = str(reference)
        value['references'] = list(dict.fromkeys([*value.get('references', []), str(reference)]))
        write_json(self.work / 'owner.json', value)
        self.pinned = True

    def release(self):
        if self.reference:
            value = read_json(self.reference, {})
            if value.get('resourceRun') == str(self.work):
                value['resourceReleased'] = True
                write_json(self.reference, value)
        self.pinned = False

    def __exit__(self, kind, value, traceback):
        try:
            if not self.pinned:
                shutil.rmtree(self.work, ignore_errors=True)
            # Failed builds are never offered as reusable caches.
            if self.state.get('state') != 'ready':
                shutil.rmtree(self.cache, ignore_errors=True)
        finally:
            self.stack.close()
        reap(self.base)


@contextlib.contextmanager
def resume(workspace, reference):
    """Hold the same locks when a later CLI command consumes prepared products."""
    if 'resourceRun' not in workspace:
        # Pre-migration workspaces remain usable, but serialize their legacy paths.
        with lock(BASE / 'dependencies.lock'), lock(BASE / 'legacy.lock'), cleanup_signals():
            yield None
        return
    cache = Path(workspace['resourceCache'])
    if cache.parent != BASE / 'caches':
        raise RuntimeError('Workspace cache is outside the managed root')
    with lock(BASE / 'dependencies.lock'), lock(BASE / 'locks' / (cache.name + '.lock')), cleanup_signals():
        run = Path(workspace['resourceRun'])
        owner = read_json(run / 'owner.json', {})
        if not valid_reference(run, owner):
            raise RuntimeError('Prepared workspace has been released or its owner is missing')
        owner['pid'] = os.getpid()
        write_json(run / 'owner.json', owner)
        class Resumed:
            def release(self):
                value = read_json(reference, {})
                value['resourceReleased'] = True
                write_json(reference, value)
                shutil.rmtree(run)
        yield Resumed()


def stop_children():
    before = sorted(CHILDREN)
    for pid in before:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.monotonic() + 5
    while CHILDREN and time.monotonic() < deadline:
        for pid in list(CHILDREN):
            try:
                waited, _ = os.waitpid(pid, os.WNOHANG)
                if waited:
                    CHILDREN.discard(pid)
            except ChildProcessError:
                if not alive(pid):
                    CHILDREN.discard(pid)
        if CHILDREN:
            time.sleep(0.05)
    for pid in list(CHILDREN):
        try:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
        CHILDREN.discard(pid)
    return {'remainingTestProcessesBeforeCleanup': before,
            'remainingTestProcessesAfterCleanup': [pid for pid in before if alive(pid)]}


def track_child(pid):
    CHILDREN.add(pid)
    for run in (BASE / 'runs').glob('*'):
        owner = read_json(run / 'owner.json', {})
        if owner.get('pid') == os.getpid():
            owner['children'] = sorted(CHILDREN)
            write_json(run / 'owner.json', owner)


def session_children(run):
    children = set()
    for directory in (BASE / 'runs').glob('*'):
        owner = read_json(directory / 'owner.json', {})
        if directory == run or owner.get('session') == str(run):
            children.update(owner.get('children', []))
    return children


def run_shell(argv):
    """Give shell-created scratch files an owner that survives SIGKILL discovery."""
    reap()
    run = BASE / 'runs' / uuid.uuid4().hex
    run.mkdir(parents=True)
    write_json(run / 'owner.json', {
        'schema': SCHEMA, 'root': str(ROOT), 'pid': os.getpid(), 'key': run.name,
        'cache': None, 'reference': None, 'created': time.time(), 'profile': 'shell',
    })
    process = None
    try:
        process = subprocess.Popen(argv, env={**os.environ,
            'SHUDENG_TEST_SCRATCH': str(run), 'SHUDENG_TEST_SHELL_MANAGED': '1'},
            start_new_session=True)
        track_child(process.pid)
        owner = read_json(run / 'owner.json')
        owner['children'] = [process.pid]
        write_json(run / 'owner.json', owner)
        return process.wait()
    finally:
        if process is not None:
            # Nested helpers start separate groups; terminate only recorded owners.
            owned = session_children(run) | {process.pid}
            for pid in owned:
                if alive(pid):
                    try:
                        os.killpg(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            deadline = time.monotonic() + 5
            while any(alive(pid) for pid in owned) and time.monotonic() < deadline:
                time.sleep(0.05)
            for pid in owned:
                if alive(pid):
                    try:
                        os.killpg(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            CHILDREN.discard(process.pid)
        shutil.rmtree(run, ignore_errors=True)


def run_process(argv, *, cwd=None, log=None, timeout=None, env=None, root=ROOT, profile=None):
    argv = list(map(str, argv))
    if Path(argv[0]).name == 'xcodebuild' and profile:
        argv = [sys.executable, str(ROOT / 'scripts/test_resources.py'),
                'xcodebuild', '--profile', profile, '--', *argv[1:]]
    elif Path(argv[0]).name == 'xcodebuild':
        argv = [argv[0], *persistent_result(argv[1:], Path(log).parent.name if log else 'xcodebuild')]
    began = time.monotonic()
    if log is None:
        log = Path(root) / '.scratch/test-logs' / (uuid.uuid4().hex + '.log')
    log = Path(log)
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open('wb') as stream:
        if '-resultBundlePath' in argv:
            stream.write((json.dumps({'resultBundlePath': argv[argv.index('-resultBundlePath') + 1]}) + '\n').encode())
            stream.flush()
        process = subprocess.Popen(argv, cwd=cwd, env={**os.environ, **(env or {})},
                                   stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        track_child(process.pid)
        timed_out = False
        try:
            code = process.wait(timeout=timeout)
        except BaseException as error:
            timed_out = isinstance(error, subprocess.TimeoutExpired)
            try:
                os.killpg(process.pid, signal.SIGTERM)
                code = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                code = process.wait()
            if not timed_out:
                raise
        finally:
            CHILDREN.discard(process.pid)
            record_evidence_status(argv)
    return {'argv': argv, 'cwd': None if cwd is None else str(cwd),
            'exit_code': code, 'timed_out': timed_out,
            'seconds': round(time.monotonic() - began, 6),
            'log': str(log.relative_to(root)) if log.is_relative_to(root) else str(log)}


def canonical_flags(argv):
    values = []
    skip = False
    for index, arg in enumerate(argv):
        if skip:
            skip = False
            continue
        if arg in {'-destination', '-resultBundlePath', '-derivedDataPath',
                   '-clonedSourcePackagesDirPath', '-packageCachePath'}:
            if arg == '-destination':
                destination = argv[index + 1]
                platform = next((item for item in destination.split(',') if item.startswith('platform=')),
                                'platform=iOS Simulator' if destination.startswith('id=') else destination)
                values.extend(['-destination', platform.removeprefix('generic/')])
            skip = True
            continue
        if arg in {'build-for-testing', 'test', 'test-without-building', 'build'} or arg.startswith(
                ('-only-testing:', '-skip-testing:')):
            continue
        if arg.startswith('OTHER_LDFLAGS=') and '__entitlements ' in arg:
            separator = ' -Xlinker ' if ' -Xlinker ' in arg else '__entitlements '
            prefix, path = arg.rsplit(separator, 1)
            arg = prefix + separator + 'sha256:' + hashlib.sha256(Path(path).read_bytes()).hexdigest()
        values.append(arg)
    return values


def replace_arg(argv, flag, value):
    argv = list(argv)
    if flag in argv:
        index = argv.index(flag)
        argv[index + 1] = str(value)
    else:
        argv.extend([flag, str(value)])
    return argv


def persistent_result(argv, profile):
    if '-resultBundlePath' in argv:
        return list(argv)
    with lock(BASE / 'evidence.lock'):
        status = evidence_status()
        if status['bundles'] >= MAX_EVIDENCE_BUNDLES or status['bytes'] >= MAX_EVIDENCE_BYTES:
            raise RuntimeError('Automatic evidence retention limit reached (100 bundles / 8 GiB); existing evidence is preserved. Archive it explicitly before starting another command')
    name = ''.join(char if char.isalnum() or char in '-_' else '_' for char in profile)[:64] or 'xcodebuild'
    result = ROOT / '.scratch/test-evidence' / name / (uuid.uuid4().hex + '.xcresult')
    result.parent.mkdir(parents=True, exist_ok=True)
    return [*argv, '-resultBundlePath', str(result)]


def evidence_status():
    directory = ROOT / '.scratch/test-evidence'
    bundles = [path for path in directory.glob('*/*.xcresult') if path.is_dir()]
    byte_count = size(directory)
    return {'bundles': len(bundles), 'bytes': byte_count,
            'maxBundles': MAX_EVIDENCE_BUNDLES, 'maxBytes': MAX_EVIDENCE_BYTES,
            'state': 'limit-reached-evidence-preserved' if
                len(bundles) >= MAX_EVIDENCE_BUNDLES or byte_count >= MAX_EVIDENCE_BYTES else 'within-limit'}


def record_evidence_status(argv):
    if '-resultBundlePath' not in argv:
        return
    result = Path(argv[argv.index('-resultBundlePath') + 1]).resolve()
    if not result.is_relative_to(ROOT / '.scratch/test-evidence'):
        return
    with lock(BASE / 'evidence.lock'):
        status = evidence_status()
        write_json(ROOT / '.scratch/test-evidence/retention-status.json', status)
        if status['state'] != 'within-limit':
            print(json.dumps({'evidenceRetention': status, 'resultBundlePath': str(result)}),
                  file=sys.stderr, flush=True)


def _xcodebuild(profile, argv):
    profile_file = BASE / 'profiles' / (hashlib.sha256(profile.encode()).hexdigest() + '.json')
    scratch = os.environ.get('SHUDENG_TEST_SCRATCH')
    handoff = Path(scratch) / profile_file.name if scratch else None
    inputs = [ROOT / 'ios', ROOT / 'Vendor']
    for index, value in enumerate(argv):
        if value == '-xcconfig':
            inputs.append(Path(argv[index + 1]))
    source_key = fingerprint(inputs)
    testing_only = 'test-without-building' in argv
    prior = read_json(handoff, None) if handoff else None
    prior = prior or read_json(profile_file, {})
    if testing_only:
        if prior.get('sourceKey') != source_key:
            raise RuntimeError(f'No compatible prepared build for {profile}; run its build entry first')
        key = prior['key']
        supplied = {item.split('=', 1)[0]: item for item in canonical_flags(argv)
                    if '=' in item and not item.startswith('-')}
        built = {item.split('=', 1)[0]: item for item in prior.get('flags', [])
                 if '=' in item and not item.startswith('-')}
        if any(built.get(name) != value for name, value in supplied.items()):
            raise RuntimeError('Prepared build flags differ from the requested test flags')
    else:
        key = hashlib.sha256((source_key + json.dumps(canonical_flags(argv))).encode()).hexdigest()
    with ManagedBuild(ROOT, profile, key=key) as resource:
        if testing_only and not resource.reused:
            raise RuntimeError(f'Prepared cache was evicted for {profile}; run its build entry first')
        # Bounded shared packages must be installed/migrated explicitly, never created in /tmp.
        if not resource.packages.is_dir():
            raise RuntimeError('Persistent Readium cache is missing; migrate the inventoried cache first')
        command = replace_arg(argv, '-derivedDataPath', resource.derived)
        command = replace_arg(command, '-clonedSourcePackagesDirPath', resource.packages)
        command = replace_arg(command, '-packageCachePath', resource.caches / 'packages')
        execute = not (resource.reused and 'build-for-testing' in argv)
        if execute:
            command = persistent_result(command, profile)
        print(json.dumps({'profile': profile, 'cacheKey': key, 'cacheReused': resource.reused,
                          'derivedData': str(resource.derived),
                          'resultBundlePath': command[command.index('-resultBundlePath') + 1]
                              if '-resultBundlePath' in command else None}),
              file=sys.stderr, flush=True)
        if execute:
            if not testing_only:
                check_space(ROOT)
            process = subprocess.Popen(['xcodebuild', *command], env={**os.environ, **resource.env},
                                       start_new_session=True)
            track_child(process.pid)
            try:
                code = process.wait()
            except BaseException:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise
            finally:
                CHILDREN.discard(process.pid)
                record_evidence_status(command)
            if code:
                return code
        if not testing_only:
            if fingerprint(inputs) != source_key:
                raise RuntimeError('Source content changed during the build; cache was not published')
            resource.ready()
            write_json(profile_file, {'sourceKey': source_key, 'key': key, 'profile': profile,
                                     'flags': canonical_flags(argv), **resource.fields()})
            resource.pin(profile_file)
            if handoff:
                write_json(handoff, read_json(profile_file))
                resource.pin(handoff)
    return 0


def xcodebuild(profile, argv):
    with lock(BASE / 'profile-locks' / (hashlib.sha256(profile.encode()).hexdigest() + '.lock')):
        return _xcodebuild(profile, argv)


def release_profile(profile):
    profile_file = BASE / 'profiles' / (hashlib.sha256(profile.encode()).hexdigest() + '.json')
    with lock(BASE / 'profile-locks' / (hashlib.sha256(profile.encode()).hexdigest() + '.lock')):
        value = read_json(profile_file, {})
        value['resourceReleased'] = True
        write_json(profile_file, value)
    return reap()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    xcode = sub.add_parser('xcodebuild')
    xcode.add_argument('--profile', required=True)
    xcode.add_argument('argv', nargs=argparse.REMAINDER)
    shell = sub.add_parser('shell')
    shell.add_argument('argv', nargs=argparse.REMAINDER)
    sub.add_parser('reap')
    sub.add_parser('status')
    release = sub.add_parser('release')
    release.add_argument('--profile', required=True)
    resolve = sub.add_parser('resolve')
    resolve.add_argument('path')
    args = parser.parse_args()
    if args.command == 'shell':
        return run_shell(args.argv[1:] if args.argv[:1] == ['--'] else args.argv)
    if args.command == 'release':
        print(json.dumps(release_profile(args.profile), indent=2))
        return 0
    if args.command == 'xcodebuild':
        return xcodebuild(args.profile, args.argv[1:] if args.argv[:1] == ['--'] else args.argv)
    if args.command == 'resolve':
        print(resolve_path(args.path))
    elif args.command == 'reap':
        print(json.dumps(reap(), indent=2))
    else:
        print(json.dumps({'base': str(BASE), 'bytes': size(BASE),
                          'maxCaches': MAX_CACHES, 'maxCacheBytes': MAX_BYTES,
                          'caches': list(map(str, (BASE / 'caches').glob('*')))}, indent=2))
    return 0


def interrupted(signum, frame):
    raise KeyboardInterrupt(f'Interrupted by signal {signum}')


atexit.register(stop_children)
if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        raise SystemExit(main())
    except (RuntimeError, KeyboardInterrupt) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
