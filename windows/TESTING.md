# Windows verification

## Automated checks

After a Release build, run `ctest --test-dir build/windows --output-on-failure -C Release`. With Node on PATH this runs the four shared suites (54 upstream checks) and the Windows timezone/adapter integration test. The adapter must retain the shared Hijri and render/evict hooks and use the packed assets from the current tree.

Run the deployed application smoke suite from any directory:

```powershell
python windows/tests/test_runtime.py --executable windows/dist/Moonphase-Windows/Moonphase.exe
```

The suite clears Qt SDK environment variables, limits PATH to Windows System32 and uses an isolated test working directory. It captures frames after texture eviction, checks lunar/season/Hijri state and native wallpaper parenting, exercises pause/resume/stop/start and recovery after detaching an owned window, and requires clean exits. Artifacts remain in the ignored `windows/test-results/` directory. No test kills Explorer or changes Windows startup registration. Inspect the PNGs; native parent checks alone cannot prove icon usability or final desktop composition.

## Manual checks before a Windows binary release

- Verify the image appears behind icons; open an icon and use desktop selection/context menus and normal application windows.
- Change settings, close/reopen the app, and verify preferences, timezone/DST, all background styles, captions and instrument toggles. Change relief/Earthshine after the source textures have been evicted to verify cache refresh.
- Check multiple monitors, negative origins, mixed scaling, display hotplug/resolution changes and remote desktop.
- Restart Explorer normally and check recovery; also test lock/unlock, suspend/resume and graphics-device resets.
- Run actual fullscreen games and overlays, verify animation pauses and resumes, and sample sustained CPU/GPU/VRAM use. The fullscreen diagnostic window is not a substitute for game testing.
- Test opt-in startup registration and removal, tray Exit, and a fresh-machine portable launch.

## Contribution preparation results

Verified on **8 November 2026**, based on upstream `9983124a2d60674ab37b33fa6291c14bbcbc1c63`:

- Release x64 build passed with MSVC 19.51, Qt 6.8.3, CMake/Ninja and Windows SDK. All five current shader sources were rebaked for D3D11. One build-script default-path error was corrected before the successful build.
- All five CTest suites passed: 54 shared checks and the Windows adapter tests. No final test failures remain.
- All seven deployed smoke scenarios passed: four phase/season/style combinations, native wallpaper parenting, pause/resume/stop/start/automatic parent-loss recovery, and native settings rendering. Runs exited cleanly. Diagnostic reports confirmed Arabic Hijri labels, a locked Moon cache and evicted source texture; the full-Moon PNG was visually inspected afterward.
- The portable ZIP passed CRC validation and includes shared assets, exact verified Qt sources, complete application source, MIT/GPL/LGPL notices, Qt SBOMs and licensed REDIST runtime files. Runtime tests clear SDK environment variables and use only Windows System32 on PATH.
- The selected capture in `docs/preview.png` is an actual rendered Windows preview. It demonstrates scene output, not desktop-icon input behavior.
- Shared `contents/`, metadata, root Makefile, Linux scripts/tests, root LICENSE and existing README credits are unchanged against the upstream base. The earlier standalone application is preserved separately.

Only one physical monitor was available. Native HWND/parent/style tests passed, but desktop-icon interaction, actual Explorer restart, multi-monitor/mixed-DPI/hotplug, interactive settings persistence, startup registration, game fullscreen behavior, sleep/lock and GPU reset were **not reverified** during this preparation. The user's existing standalone application was reported to run smoothly; that report is distinct from the automated checks above. No Linux/Plasma runtime was available, so KDE runtime behavior was not executed; shared files were preserved byte-for-byte in Git.
