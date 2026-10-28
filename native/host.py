#!/usr/bin/env python3
"""Minimal read-only native messaging host for Game Library Guard.

No network access, database changes, or browser access to full DB bytes.
"""
import json
import os
import struct
import subprocess
import hashlib
import sys
from pathlib import Path

MAX_INPUT = 1024 * 1024
LIB = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'GameLibraryGuard' / 'library.json'
DEFAULT_DB = Path(os.environ.get('APPDATA', str(Path.home()))) / 'Playnite' / 'library' / 'games.db'


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return None
    count = struct.unpack('<I', header)[0]
    if count > MAX_INPUT:
        raise ValueError('Request too large')
    payload = sys.stdin.buffer.read(count)
    if len(payload) != count:
        raise ValueError('Truncated request')
    return json.loads(payload.decode('utf-8'))


def write_message(data):
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(payload) > 900000:
        payload = json.dumps({'error': 'Response too large'}).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(payload)) + payload)
    sys.stdout.buffer.flush()


READER = Path(__file__).resolve().parent / 'reader' / 'bin' / 'Release' / 'net10.0' / 'PlayniteReader.exe'


def read_playnite_db(db_path):
    if not READER.is_file():
        raise RuntimeError('Database reader missing. Run: dotnet build native/reader/PlayniteReader.csproj -c Release (requires .NET 10 SDK).')
    result = subprocess.run([str(READER), '--read', str(db_path)], capture_output=True, timeout=60, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        data = json.loads(result.stdout)
    except ValueError:
        raise RuntimeError('Database reader failed to start. Install .NET 10 Desktop/Runtime. ' + result.stderr[:500])
    if result.returncode or data.get('error'):
        raise RuntimeError(data.get('error', 'Database reader failed'))
    return data


def default_database():
    config = DEFAULT_DB.parent.parent / 'config.json'
    if config.is_file():
        value = json.loads(config.read_text(encoding='utf-8-sig')).get('DatabasePath')
        if isinstance(value, str) and value:
            path = Path(os.path.expandvars(value))
            if not path.is_absolute():
                path = config.parent / path
            return path / 'games.db'
    return DEFAULT_DB


def add_revision(data):
    data['revision'] = hashlib.sha256(json.dumps(data['games'], sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()
    return data


def handle(req):
    if not isinstance(req, dict) or req.get('action') != 'get_library':
        return {'error': 'Unsupported request'}
    backend = req.get('backend', 'db')
    if backend not in ('db', 'sdk'):
        return {'error': 'Unsupported Playnite backend'}
    if backend == 'db':
        try:
            requested = req.get('db_path')
            if requested is not None and (not isinstance(requested, str) or len(requested) > 1024):
                raise ValueError('Invalid games.db path')
            path = Path(os.path.expandvars(requested)).expanduser() if requested else default_database()
            return add_revision(read_playnite_db(path))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as ex:
            return {'error': str(ex)}
    try:
        if LIB.stat().st_size > 5 * 1024 * 1024:
            raise ValueError('Export exceeds 5 MB')
        data = json.loads(LIB.read_text(encoding='utf-8-sig'))
        games = data.get('games')
        if not isinstance(games, list) or len(games) > 30000:
            raise ValueError('Expected games array (maximum 30,000)')
        for game in games:
            if not isinstance(game, dict) or not isinstance(game.get('name'), str) or not game['name'].strip() or len(game['name']) > 255 or not isinstance(game.get('source'), str) or not game['source'].strip() or len(game['source']) > 100:
                raise ValueError('Export contains an invalid game title or source')
        return add_revision({'games': games, 'source_type': 'playnite_export', 'exported_at': LIB.stat().st_mtime})
    except (OSError, ValueError, TypeError, AttributeError) as ex:
        return {'error': 'Playnite SDK export unavailable or invalid: ' + str(ex) + '. See playnite/README.md.'}


if __name__ == '__main__':
    try:
        request = read_message()
        if request is not None:
            write_message(handle(request))
    except Exception:
        write_message({'error': 'Native host error'})
