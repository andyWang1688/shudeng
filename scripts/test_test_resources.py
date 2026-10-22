#!/usr/bin/env python3
"""Small real-process lifecycle contracts; never builds or contacts an AI service."""
from pathlib import Path
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import test_resources as resources


class ResourcesContract(unittest.TestCase):
    def setUp(self):
        parent = resources.ROOT / '.build'
        parent.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='resource-contract-', dir=parent)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'ios').mkdir()
        (self.root / 'Vendor').mkdir()
        self.source = self.root / 'ios/source.swift'
        self.source.write_text('original')
        self.base = self.root / '.build/test-resources'
        self.children = []
        self.addCleanup(self.stop_children)

    def stop_children(self):
        for process in self.children:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()
            process.stderr.close()

    def build(self, **kwargs):
        return resources.ManagedBuild(self.root, 'contract', toolchain=False,
                                      large=False, **kwargs)

    def spawn(self, body):
        code = (
            'import sys,time,json,os,signal\n'
            'from pathlib import Path\n'
            f'sys.path.insert(0,{str(resources.ROOT)!r})\n'
            'from scripts import test_resources as r\n'
            f'root=Path({str(self.root)!r})\n'
            'with r.ManagedBuild(root,"contract",toolchain=False,large=False) as b:\n'
            + ''.join('    '+line+'\n' for line in body.splitlines())
        )
        process = subprocess.Popen([sys.executable, '-B', '-u', '-c', code],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(process)
        return process

    def test_two_rounds_reuse_and_normal_exit(self):
        with self.build() as first:
            self.assertFalse(first.reused)
            first.derived.mkdir()
            product = first.derived / 'compiled'
            product.write_text('immutable build product')
            before = product.stat().st_mtime_ns
            key = first.key
            first.ready({'test': 'ready'})
        with self.build() as second:
            self.assertTrue(second.reused)
            self.assertEqual(key, second.key)
            self.assertEqual(before, (second.derived / 'compiled').stat().st_mtime_ns)
        self.assertEqual([], list((self.base / 'runs').glob('*')))

    def test_failure_before_publication_removes_run_and_incomplete_cache(self):
        with self.assertRaisesRegex(RuntimeError, 'controlled failure'):
            with self.build() as build:
                work, cache = build.work, build.cache
                (work / 'tmp/partial').write_text('partial')
                build.derived.mkdir()
                raise RuntimeError('controlled failure')
        self.assertFalse(work.exists())
        self.assertFalse(cache.exists())

    def test_term_cleans_and_kill_is_recovered_on_next_run(self):
        for number in (signal.SIGTERM, signal.SIGKILL):
            child = self.spawn('print(str(b.work),flush=True)\ntime.sleep(60)')
            run = Path(child.stdout.readline().strip())
            self.assertTrue(run.is_dir())
            child.send_signal(number)
            child.wait(timeout=10)
            if number == signal.SIGKILL:
                self.assertTrue(run.exists())
                resources.reap(self.base)
            self.assertFalse(run.exists())
            self.assertEqual([], list((self.base / 'caches').glob('*')))

    def test_prepare_reference_survives_process_exit_and_releases(self):
        child = self.spawn(
            'b.derived.mkdir()\nb.ready()\n'
            'reference=root/"workspace.json"\n'
            'r.write_json(reference,b.fields())\nb.pin(reference)\nprint(str(b.work),flush=True)')
        run = Path(child.stdout.readline().strip())
        self.assertEqual(0, child.wait(timeout=10), child.stderr.read())
        resources.reap(self.base)
        self.assertTrue(run.exists(), 'separate prepare/run CLI handoff must remain pinned')
        (self.root / 'workspace.json').unlink()
        resources.reap(self.base)
        self.assertFalse(run.exists())

    def test_live_task_and_exclusive_lock(self):
        first = self.spawn('print("entered",flush=True)\ntime.sleep(1)')
        self.assertEqual('entered', first.stdout.readline().strip())
        owner = next((self.base / 'runs').glob('*'))
        resources.reap(self.base)
        self.assertTrue(owner.exists())
        second = self.spawn('print("second",flush=True)')
        time.sleep(0.15)
        self.assertIsNone(second.poll(), 'concurrent writer entered a locked cache')
        self.assertEqual(0, first.wait(timeout=10))
        self.assertEqual('second', second.stdout.readline().strip())
        self.assertEqual(0, second.wait(timeout=10), second.stderr.read())

    def test_sources_injection_dependencies_flags_and_sdk_invalidate(self):
        def key(paths=None, flags=()):
            return resources.fingerprint(paths or [self.root / 'ios', self.root / 'Vendor'],
                                         flags, toolchain=False, base=self.base)
        before = key()
        self.source.write_text('uncommitted change')
        self.assertNotEqual(before, key())
        injected = self.root / 'InjectedTest.swift'
        injected.write_text('test first')
        before = key([injected])
        injected.write_text('test second')
        self.assertNotEqual(before, key([injected]))
        before = key()
        (self.root / 'Vendor/Package.swift').write_text('dependency update')
        self.assertNotEqual(before, key())
        self.assertNotEqual(key(flags=['ARCHS=arm64']), key(flags=['ARCHS=x86_64']))
        def sdk(value):
            with mock.patch.object(resources.subprocess, 'run', return_value=
                    subprocess.CompletedProcess([], 0, stdout=value)):
                return resources.fingerprint([self.source], toolchain=True, base=self.base)
        self.assertNotEqual(sdk(b'Xcode-A SDK-A'), sdk(b'Xcode-B SDK-B'))

    def test_low_space_stops_before_leaking_owner(self):
        with mock.patch.object(resources.shutil, 'disk_usage', return_value=
                type('Usage', (), {'free': 1})()):
            with self.assertRaisesRegex(RuntimeError, '10 GiB'):
                with resources.ManagedBuild(self.root, 'contract', toolchain=False):
                    self.fail('a low-space build was allowed')
        self.assertEqual([], list((self.base / 'runs').glob('*')))
        self.assertEqual([], list((self.base / 'caches').glob('*')))

    def test_nested_shell_term_stops_separate_grandchild_group(self):
        marker = self.root / 'grandchild.pid'
        leaf = ('import os,time;from pathlib import Path;'
                f'Path({str(marker)!r}).write_text(str(os.getpid()));time.sleep(60)')
        nested = (
            'import sys;from pathlib import Path;'
            f'sys.path.insert(0,{str(resources.ROOT)!r});'
            'from scripts import test_resources as r;'
            f'r.BASE=Path({str(self.base)!r});root=Path({str(self.root)!r})\n'
            'with r.ManagedBuild(root,"nested",toolchain=False,large=False):\n'
            f' r.run_process([sys.executable,"-c",{leaf!r}],log=root/"nested.log")\n')
        outer = (
            'import sys,signal;from pathlib import Path;'
            f'sys.path.insert(0,{str(resources.ROOT)!r});'
            'from scripts import test_resources as r;'
            f'r.BASE=Path({str(self.base)!r});'
            'signal.signal(signal.SIGTERM,r.interrupted);'
            f'r.run_shell([sys.executable,"-B","-c",{nested!r}])')
        child = subprocess.Popen([sys.executable, '-B', '-c', outer],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(marker.exists())
        grandchild = int(marker.read_text())
        child.terminate()
        child.wait(timeout=15)
        self.assertFalse(resources.alive(grandchild), 'nested process group outlived its owner')
        resources.reap(self.base)
        self.assertEqual([], list((self.base / 'runs').glob('*')))

    def test_parallel_shell_handoffs_preserve_each_build(self):
        # Two CLI shells may update the public latest-profile pointer between build
        # and test. Each shell's own immutable handoff must keep its build pinned.
        reference = self.root / 'latest.json'
        first_handoff = self.root / 'first.json'
        second_handoff = self.root / 'second.json'
        with self.build(flags=['ARCHS=arm64']) as first:
            first.derived.mkdir()
            first.ready()
            resources.write_json(reference, first.fields())
            resources.write_json(first_handoff, first.fields())
            first.pin(reference)
            first.pin(first_handoff)
            first_run = first.work
        with self.build(flags=['ARCHS=x86_64']) as second:
            second.derived.mkdir()
            second.ready()
            resources.write_json(reference, second.fields())
            resources.write_json(second_handoff, second.fields())
            second.pin(reference)
            second.pin(second_handoff)
        self.assertTrue(resources.valid_reference(first_run, resources.read_json(first_run/'owner.json')))
        self.assertNotEqual(resources.read_json(first_handoff)['resourceKey'],
                            resources.read_json(reference)['resourceKey'])

    def test_full_cache_limit_released_slot_allows_next_source_revision(self):
        references = []
        for index in range(resources.MAX_CACHES):
            self.source.write_text(str(index))
            reference = self.root / f'prepared-{index}.json'
            references.append(reference)
            child = self.spawn(
                'b.derived.mkdir()\nb.ready()\n'
                f'reference=Path({str(reference)!r})\n'
                'r.write_json(reference,b.fields())\nb.pin(reference)')
            self.assertEqual(0, child.wait(timeout=10), child.stderr.read())
        self.source.write_text('fourth revision')
        with self.assertRaisesRegex(RuntimeError, 'retention limit'):
            with self.build():
                self.fail('all pinned caches must prevent an extra slot')
        first = resources.read_json(references[0])
        first['resourceReleased'] = True
        resources.write_json(references[0], first)
        with self.build() as next_build:
            next_build.derived.mkdir()
            next_build.ready()
        self.assertEqual(resources.MAX_CACHES, len(list((self.base / 'caches').glob('*'))))

    def test_result_bundle_default_is_persistent_and_does_not_change_key(self):
        argv = ['build-for-testing', '-project', 'Example.xcodeproj']
        with mock.patch.object(resources, 'ROOT', self.root):
            command = resources.persistent_result(argv, 'failure-profile')
        result = Path(command[command.index('-resultBundlePath') + 1])
        self.assertTrue(result.is_relative_to(self.root / '.scratch/test-evidence'))
        self.assertEqual(resources.canonical_flags(argv), resources.canonical_flags(command))

    def test_automatic_evidence_caps_stop_before_command_and_preserve_evidence(self):
        existing = self.root / '.scratch/test-evidence/old/existing.xcresult'
        existing.mkdir(parents=True)
        (existing / 'evidence').write_text('keep')
        with mock.patch.object(resources, 'ROOT', self.root), \
                mock.patch.object(resources, 'BASE', self.base), \
                mock.patch.object(resources.subprocess, 'Popen') as launch:
            for limits in ({'MAX_EVIDENCE_BUNDLES': 1}, {'MAX_EVIDENCE_BYTES': 1}):
                with mock.patch.multiple(resources, **limits):
                    with self.assertRaisesRegex(RuntimeError, 'evidence retention limit'):
                        resources.run_process(['xcodebuild', 'build-for-testing'],
                                              log=self.root / 'blocked.log')
            launch.assert_not_called()
            with mock.patch.object(resources, 'MAX_EVIDENCE_BYTES', 1), \
                    mock.patch.object(resources.sys, 'stderr'):
                resources.record_evidence_status(['-resultBundlePath', str(existing)])
            status = resources.read_json(self.root / '.scratch/test-evidence/retention-status.json')
            self.assertEqual('limit-reached-evidence-preserved', status['state'])
            self.assertEqual('keep', (existing / 'evidence').read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
