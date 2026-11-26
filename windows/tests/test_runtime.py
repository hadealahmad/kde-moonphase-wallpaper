# SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
# SPDX-License-Identifier: GPL-2.0-or-later
"""Bounded tests of the deployed Windows host; no input injection or Explorer restart."""
import argparse
import json
import os
import pathlib
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable',type=pathlib.Path,default=ROOT/'windows/dist/Moonphase-Windows/Moonphase.exe')
    parser.add_argument('--case',choices=('all','preview','wallpaper','controls','settings'),default='all')
    args = parser.parse_args()
    exe = args.executable.resolve()
    output = ROOT/'windows/test-results'
    output.mkdir(exist_ok=True)
    work = pathlib.Path(tempfile.mkdtemp(prefix='run-',dir=output))
    env = os.environ.copy()
    for key in ('QTDIR','QT_PLUGIN_PATH','QML_IMPORT_PATH','QML2_IMPORT_PATH'):
        env.pop(key,None)
    env['PATH'] = str(pathlib.Path(os.environ['SystemRoot'])/'System32')
    results = []

    def run(name, flags, controls=False):
        duration = 18 if controls else 8
        report = work/f'{name}.json'
        frame = work/f'{name}.png'
        log = work/'test-results/isolated/moonphase.log'
        old_size = log.stat().st_size if log.exists() else 0
        proc = subprocess.Popen([str(exe),'--isolated','--no-network','--static','--test-seconds',str(duration),
            '--report',str(report),'--capture',str(frame),*flags],cwd=work,env=env)
        try:
            if controls:
                time.sleep(4)
                for command in ('pause','resume','stop','wallpaper','test-detach'):
                    subprocess.run([str(exe),'--isolated','--'+command],cwd=work,env=env,check=True,timeout=15)
                    time.sleep(.5)
            code = proc.wait(timeout=45)
        finally:
            if proc.poll() is None:
                # Terminate only the exact child process launched by this test.
                proc.terminate()
                proc.wait(timeout=10)
        assert code == 0,(name,code)
        data = json.loads(report.read_text(encoding='utf-8'))
        assert not data['failed'],data
        assert frame.stat().st_size > 10000, 'Inspect missing/blank frame'
        text = log.read_bytes()[old_size:].decode('utf-8')
        assert 'Clean shutdown: wallpaper windows destroyed' in text
        assert not any(error in text for error in ('ReferenceError','TypeError','Failed to create','shader compilation failed')),text
        if '--settings' not in flags:
            scene = data['scene']
            assert scene['hijriDayLabel'] and scene['hijriMonthYearLabel']
            assert not scene['moonTexLoaded'] and scene['moonCacheLocked'], 'Source texture was not evicted'
            if '--phase' in flags:
                target = float(flags[flags.index('--phase')+1])
                actual = scene['moon']['phase']
                assert min(abs(actual-target),1-abs(actual-target)) < .003,(actual,target)
        if '--wallpaper' in flags:
            assert data['iconsValid'] and data['windows'],data
            assert all(w['valid'] and w['parentMatches'] and w['childStyle'] and w['noActivate'] for w in data['windows'])
        if controls:
            assert 'Rendering paused: true' in text and 'Rendering paused: false' in text
            assert 'Wallpaper stopped;' in text
            assert 'Test: detached an owned wallpaper window' in text
            assert 'Recovering missing or detached wallpaper windows' in text
        results.append({'name':name,'exitCode':code,'passed':True})
        print(f'PASS {name}',flush=True)

    if args.case in ('all','preview'):
        for name,phase,day,style in [('new-spring',0,80,0),('quarter-summer',.25,172,1),
                                   ('full-autumn',.5,266,2),('last-quarter-winter',.75,355,2)]:
            run(name,['--preview','--phase',str(phase),'--day',str(day),'--style',str(style)])
    if args.case in ('all','wallpaper'):
        run('wallpaper',['--wallpaper'])
    if args.case in ('all','controls'):
        run('controls-recovery',['--wallpaper'],controls=True)
    if args.case in ('all','settings'):
        run('settings',['--settings'])
    (work/'summary.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(f'Evidence: {work}')


if __name__ == '__main__':
    main()
