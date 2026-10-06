"""Pinned oracle artifacts. Never imported by the application/compiler."""
import base64
import hashlib
import json
import os
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / 'fixtures/oracle-lock.json').read_text())
CACHE = Path(os.environ.get('COOKBRANCH_ORACLE_CACHE', ROOT / '.cache/oracles')).resolve()


def digest_ok(data, item):
    if 'sha256' in item:
        return hashlib.sha256(data).hexdigest() == item['sha256']
    algorithm, value = item['integrity'].split('-', 1)
    return base64.b64encode(hashlib.new(algorithm, data).digest()).decode() == value


def archive_path(item):
    return CACHE / 'archives' / item['archive']


def verify_cache():
    """Recheck archive integrity AND installed bytes; no version-only trust."""
    native = LOCK['native']
    assert digest_ok(archive_path(native).read_bytes(), native), 'Native archive digest mismatch'
    binary = CACHE / 'native/cook'
    assert hashlib.sha256(binary.read_bytes()).hexdigest() == native['binarySha256'], 'Native binary digest mismatch'
    for package in LOCK['packages']:
        archive = archive_path(package)
        assert digest_ok(archive.read_bytes(), package), f"Archive integrity mismatch: {package['name']}"
        installed = CACHE / 'node_modules' / package['name']
        metadata = json.loads((installed / 'package.json').read_text())
        assert metadata['name'] == package['name'] and metadata['version'] == package['version']
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                path = Path(member.name)
                assert path.parts[0] == 'package' and '..' not in path.parts
                target = installed.joinpath(*path.parts[1:])
                assert target.is_file() and not target.is_symlink(), 'Unexpected package link/missing file'
                assert target.read_bytes() == tar.extractfile(member).read(), f"Installed package bytes differ: {package['name']}"
    return binary
