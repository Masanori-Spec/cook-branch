#!/usr/bin/env python3
"""Fetch integrity-pinned TEST tools only into the ignored oracle cache."""
import argparse
import json
import platform
import subprocess
import tarfile
import tempfile
from pathlib import Path
from oracle_support import CACHE, LOCK, archive_path, digest_ok, verify_cache


def fetch(item, seed, offline):
    target = archive_path(item)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        local = seed / item['archive'] if seed else None
        if local and local.is_file():
            payload = local.read_bytes()
        else:
            if offline:
                raise RuntimeError(f"Offline archive missing: {item['archive']}")
            with tempfile.TemporaryDirectory(prefix='cookbranch-fetch-') as temp:
                download = Path(temp) / 'artifact'
                subprocess.run(['curl', '--fail', '--location', '--retry', '2', '--max-time', '180',
                                '--proto', '=https', '--proto-redir', '=https', '--silent', '--show-error',
                                item['url'], '--output', str(download)], check=True)
                payload = download.read_bytes()
        if not digest_ok(payload, item):
            raise RuntimeError(f"Integrity failure: {item['archive']}")
        target.write_bytes(payload)
    if not digest_ok(target.read_bytes(), item):
        raise RuntimeError(f"Cached archive integrity failure: {item['archive']}")
    return target


def install_package(archive, destination):
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] != 'package' or '..' in parts or Path(member.name).is_absolute():
                raise RuntimeError('Unsafe package archive path')
            if member.isdir():
                continue
            if not member.isfile():
                raise RuntimeError('Package archive links/devices are not allowed')
            target = destination.joinpath(*parts[1:])
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.is_symlink():
                raise RuntimeError('Refusing to overwrite symbolic link')
            target.write_bytes(tar.extractfile(member).read())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-dir', type=Path, help='Optional directory of exact named pinned archives')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'AMD64'):
        raise RuntimeError('The pinned native oracle currently supports Linux x86_64 only')
    native = LOCK['native']
    with tarfile.open(fetch(native, args.archive_dir, args.offline)) as tar:
        member = tar.getmember('cook')
        if not member.isfile():
            raise RuntimeError('Native binary is not a regular file')
        binary = CACHE / 'native/cook'
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(tar.extractfile(member).read())
        binary.chmod(0o755)
    for package in LOCK['packages']:
        install_package(fetch(package, args.archive_dir, args.offline), CACHE / 'node_modules' / package['name'])
    binary = verify_cache()
    version = subprocess.check_output([str(binary), '--version'], text=True).strip()
    assert version == 'cookcli 0.37.0 - in food we trust', version
    print(json.dumps({'status':'pass','cookcli':native['version'],'extensionParser':'3.0.0-alpha.47',
                      'archiveIntegrity':'verified','installedBytes':'verified','scope':'test-only'}))

if __name__ == '__main__':
    main()
