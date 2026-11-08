# SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
# SPDX-License-Identifier: GPL-2.0-or-later
"""Explicitly download and verify matching Qt module source archives for packaging."""
import argparse
import hashlib
import json
import pathlib
import re
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version',default='6.8.3')
parser.add_argument('--output',required=True,type=pathlib.Path)
args = parser.parse_args()
if not re.fullmatch(r'6\.\d+\.\d+',args.version):
    parser.error('Expected a stable Qt 6.x.y version')
args.output.mkdir(parents=True,exist_ok=True)
manifest = []
for module in ('qtbase','qtdeclarative','qtsvg'):
    name = f'{module}-everywhere-src-{args.version}.tar.xz'
    url = f"https://download.qt.io/archive/qt/{'.'.join(args.version.split('.')[:2])}/{args.version}/submodules/{name}"
    path = args.output/name
    if not path.exists():
        print(f'Downloading {name}',flush=True)
        urllib.request.urlretrieve(url,path)
    with path.open('rb') as stream:
        actual = hashlib.file_digest(stream,'sha256').hexdigest()
    with urllib.request.urlopen(url+'.sha256',timeout=60) as response:
        expected = response.read().decode().split()[0]
    if actual != expected:
        raise ValueError(f'Checksum mismatch: {name}')
    manifest.append({'file':name,'url':url,'sha256':actual})
(args.output/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
