# SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
# SPDX-License-Identifier: GPL-2.0-or-later
"""Deploy a portable x64 application with source, notices and verified Qt sources.

Requires the existing Qt SDK and licensed MSVC REDIST directory. Downloads and
system installation are deliberately separate from packaging.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import tarfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def package(args):
    qt, build, out = args.qt_directory.resolve(), args.build_directory.resolve(), args.output.resolve()
    exe = build / 'Moonphase.exe'
    if not exe.exists():
        exe = build / 'Release' / 'Moonphase.exe'
    if not exe.is_file():
        raise ValueError('Build the Release executable first')
    # Fresh output avoids carrying obsolete or debug libraries into a release.
    if out.exists():
        raise ValueError('Choose a new output directory; packaging never deletes an existing release')
    if out == ROOT or ROOT.is_relative_to(out) or out.is_relative_to(ROOT / 'contents'):
        raise ValueError('Output cannot overlap the shared source tree')
    version = subprocess.check_output([str(qt/'bin/qmake.exe'), '-query', 'QT_VERSION'], text=True).strip()
    manifest_path = args.qt_sources / 'manifest.json'
    source_manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    required = {f'{name}-everywhere-src-{version}.tar.xz' for name in ('qtbase','qtdeclarative','qtsvg')}
    verified = []
    for entry in source_manifest:
        if entry['file'] not in required:
            continue
        path = args.qt_sources / entry['file']
        expected_url = f"https://download.qt.io/archive/qt/{'.'.join(version.split('.')[:2])}/{version}/submodules/{entry['file']}"
        if entry['url'] != expected_url or digest(path) != entry['sha256']:
            raise ValueError(f'Qt source manifest/hash mismatch: {path.name}')
        verified.append(path)
    if {path.name for path in verified} != required:
        raise ValueError(f'Provide exact corresponding sources for Qt {version}: {sorted(required)}')
    crt = args.crt_directory.resolve()
    if not (crt/'vcruntime140.dll').is_file() or 'redist' not in str(crt).lower():
        raise ValueError('Pass a licensed MSVC REDIST x64 Microsoft.VC14x.CRT directory')
    out.mkdir(parents=True)
    shutil.copy2(exe, out / 'Moonphase.exe')
    subprocess.run([str(qt/'bin/windeployqt.exe'), '--release','--no-translations',
        '--no-system-d3d-compiler','--no-system-dxc-compiler','--no-opengl-sw','--no-compiler-runtime',
        '--skip-plugin-types','qmltooling','--qmldir',str(build/'adapted/contents/ui'),str(out/'Moonphase.exe')],check=True)
    for path in crt.glob('*.dll'):
        shutil.copy2(path,out/path.name)
    (out/'qt.conf').write_text('[Paths]\nPrefix=.\nQmlImports=qml\n',encoding='utf-8')
    for name in ('README.md','THIRD-PARTY-NOTICES.md','TESTING.md'):
        shutil.copy2(ROOT/'windows'/name, out/name)
    shutil.copytree(ROOT/'windows/docs', out/'docs')
    shutil.copy2(ROOT/'LICENSE',out/'LICENSE')
    licenses = out/'licenses'
    shutil.copytree(ROOT/'windows/licenses',licenses)
    sources = out/'sources'
    qt_sources = sources/'Qt'
    qt_sources.mkdir(parents=True)
    for path in verified:
        shutil.copy2(path,qt_sources/path.name)
        with tarfile.open(path,'r:xz') as archive:
            for member in archive:
                parts = pathlib.PurePosixPath(member.name).parts
                if member.isfile() and len(parts) == 3 and parts[1] == 'LICENSES':
                    (licenses/parts[2]).write_bytes(archive.extractfile(member).read())
    shutil.copy2(manifest_path,qt_sources/'manifest.json')
    if (qt/'sbom').is_dir():
        shutil.copytree(qt/'sbom',licenses/'Qt-SBOM')
    provenance = out/'asset-provenance'
    provenance.mkdir()
    for name in ('moon_assets_provenance.txt','earth_assets_provenance.txt'):
        shutil.copy2(ROOT/'scripts'/name,provenance/name)
    # Include the current tracked/staged source tree, without SDK/build output.
    files = subprocess.check_output(['git','-C',str(ROOT),'ls-files','-z'],text=True).split('\0')
    if 'windows/CMakeLists.txt' not in files:
        raise ValueError('Stage the Windows source files before packaging so corresponding source is complete')
    with zipfile.ZipFile(sources/'Moonphase-source.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(filter(None,files)):
            path = ROOT/name
            if path.is_file():
                archive.write(path,'Moonphase/'+name)
    revision = subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
    dirty = bool(subprocess.check_output(['git','-C',str(ROOT),'status','--porcelain','--untracked-files=no'],text=True))
    (sources/'source-state.json').write_text(json.dumps({'baseCommit':revision,'modifiedWorktree':dirty,
        'description':'Moonphase-source.zip contains the tracked/staged worktree used for this build'},indent=2))
    hashes = [{'path':path.relative_to(out).as_posix(),'sha256':digest(path)} for path in sorted(out.rglob('*')) if path.is_file()]
    (out/'SHA256SUMS.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
    zip_path = out.with_suffix('.zip')
    if zip_path.exists():
        raise ValueError('Choose a new output path; the ZIP already exists')
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(out.rglob('*')):
            if path.is_file():
                archive.write(path,out.name+'/'+path.relative_to(out).as_posix())
    print(f'Portable package created: {zip_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qt-directory',required=True,type=pathlib.Path)
    parser.add_argument('--build-directory',type=pathlib.Path,default=ROOT/'build/windows')
    parser.add_argument('--crt-directory',required=True,type=pathlib.Path)
    parser.add_argument('--qt-sources',required=True,type=pathlib.Path)
    parser.add_argument('--output',type=pathlib.Path,default=ROOT/'windows/dist/Moonphase-Windows')
    package(parser.parse_args())
