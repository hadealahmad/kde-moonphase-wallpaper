// SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
// SPDX-License-Identifier: GPL-2.0-or-later
// Tests the Windows timezone bridge at the real upstream prayer-engine boundary.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
const payload = process.argv[2];
assert.ok(payload, 'Pass the CMake build/adapted directory');
const scope = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(payload,'contents/code/prayer.js'),'utf8').replace(/^\.pragma library\s*/,''), scope);
const date = new Date('2026-06-21T23:30:00Z');
scope.setWindowsZone('Africa/Cairo', 180);
const cairo = scope.getPrayerState(date,30,31.2,3,0,false,180);
assert.equal(cairo.tzHours,3);
assert.equal(cairo.localTimeHours,2.5);
assert.match(cairo.cacheKey,/2026-06-22\|Africa\/Cairo\|180/);
scope.injectCacheForTest(date,30,31.2,3,0,{fajr:4,sunrise:6,dhuhr:12,asr:15,maghrib:18,isha:20});
assert.equal(scope.getPrayerState(date,30,31.2,3,0,false,180).source,'api');
scope.setWindowsZone('Europe/Stockholm',120);
assert.equal(scope.getPrayerState(date,30,31.2,3,0,false,120).source,'offline');
let url = '';
scope.XMLHttpRequest = class { open(method,value) { url=value; } send() {} };
scope.setWindowsZone('Africa/Cairo',180);
scope.fetchPrayerTimesAsync(new Date('2026-06-22T23:30:00Z'),30,31.2,3,0,()=>{},'Africa/Cairo');
assert.match(url,/timings\/23-06-2026/);
assert.match(url,/timezonestring=Africa%2FCairo/);
console.log('PASS Windows timezone offset, midnight local date, cache isolation, and API timezone');
const main = fs.readFileSync(path.join(payload,'contents/ui/main.qml'),'utf8');
assert.match(main,/import "..\/code\/hijri.js" as Hijri/);
assert.match(main,/root\.requestMoonRender\(\)/);
assert.match(main,/moonCacheLocked/);
assert.match(main,/hijriMonthYearLabel/);
assert.ok(!main.includes('org.kde'));
assert.ok(!fs.existsSync(path.join(payload,'contents/images/moon_albedo.jpg')));
assert.ok(!fs.existsSync(path.join(payload,'contents/images/earth_night.jpg')));
console.log('PASS upstream Hijri, render/evict caching, and packed asset integration');
