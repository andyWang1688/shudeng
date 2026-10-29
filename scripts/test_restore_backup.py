#!/usr/bin/env python3
"""Owned EPUB fault backup. Keep a pending reference until byte-exact restore."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import test_resources as resources
BASE = ROOT / '.scratch/test-restore-backups'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def restore(directory):
    directory = Path(directory)
    owner = resources.read_json(directory / 'owner.json', {})
    if owner.get('schema') != 1 or owner.get('root') != str(ROOT) or directory.parent != BASE:
        raise RuntimeError('Unowned restore backup')
    original = directory / 'original.epub'
    target = Path(owner.get('target', '/nonexistent'))
    if owner.get('state') == 'created':
        # arm returns only after atomically registering the original hash.
        shutil.rmtree(directory)
        return
    if not original.exists():
        if owner.get('state') == 'created':
            shutil.rmtree(directory)
            return
        raise RuntimeError('Pending backup has no original EPUB; preserved')
    if sha(original) != owner.get('sha256') or not target.is_file():
        raise RuntimeError('Original EPUB or restoration target changed; backup preserved')
    if target.stat().st_size == 0:
        staging = target.with_name(target.name + '.shudeng-restore-' + directory.name)
        resources.write_json(directory / 'owner.json', {**owner, 'restoreStaging': str(staging)})
        try:
            with original.open('rb') as source, staging.open('wb') as out:
                shutil.copyfileobj(source, out)
                out.flush()
                os.fsync(out.fileno())
            if sha(staging) != owner['sha256'] or target.stat().st_size != 0:
                raise RuntimeError('Restore target changed during recovery; backup preserved')
            staging.replace(target)
        finally:
            staging.unlink(missing_ok=True)
    if sha(target) != owner['sha256']:
        raise RuntimeError('Target no longer matches this injected empty-file fault; backup preserved')
    shutil.rmtree(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('create', 'arm', 'restore'))
    parser.add_argument('paths', nargs='*')
    args = parser.parse_args()
    BASE.mkdir(parents=True, exist_ok=True)
    with resources.lock(BASE / 'registry.lock'):
        if args.command == 'create':
            for directory in BASE.iterdir():
                if not directory.is_dir():
                    continue
                owner = resources.read_json(directory / 'owner.json', {})
                if owner.get('schema') == 1 and owner.get('root') == str(ROOT) and not resources.alive(owner.get('pid')):
                    restore(directory)
            if sum(resources.size(p) for p in BASE.iterdir() if p.is_dir()) > 512 * 1024**2:
                raise RuntimeError('Pending restore backup retention limit reached')
            directory = BASE / uuid.uuid4().hex
            directory.mkdir()
            resources.write_json(directory / 'owner.json', {'schema': 1, 'root': str(ROOT),
                'pid': int(args.paths[0]), 'state': 'created', 'reference': str(directory / 'owner.json')})
            print(directory)
        elif args.command == 'arm':
            directory, target = map(Path, args.paths)
            owner = resources.read_json(directory / 'owner.json', {})
            if directory.parent != BASE or owner.get('state') != 'created':
                raise RuntimeError('Restore backup is not a fresh owned directory')
            shutil.copy2(target, directory / 'original.epub')
            owner.update(target=str(target), sha256=sha(target), state='pending-empty-file-fault')
            resources.write_json(directory / 'owner.json', owner)
            print(target)
        else:
            restore(Path(args.paths[0]))


if __name__ == '__main__':
    main()
