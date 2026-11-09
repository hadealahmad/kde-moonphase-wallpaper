// SPDX-License-Identifier: GPL-2.0-or-later
#include "desktop.h"
#import <AppKit/AppKit.h>
#import <ServiceManagement/ServiceManagement.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <QDebug>
#include <QScreen>
#include <QWindow>

static NSWindow *nativeWindow(QWindow *window) {
    if (!window || !window->handle()) return nil;
    NSView *view = (__bridge NSView *)reinterpret_cast<void *>(window->winId());
    return view.window;
}

static NSScreen *nativeScreen(QScreen *screen) {
    // Qt uses a top-left origin on the primary screen; AppKit a bottom-left one.
    NSArray<NSScreen *> *screens = NSScreen.screens;
    if (screens.count == 0) return nil;
    const CGFloat primaryHeight = screens.firstObject.frame.size.height;
    const QRect geometry = screen->geometry();
    for (NSScreen *candidate in screens) {
        NSRect frame = candidate.frame;
        QRect flipped(int(frame.origin.x), int(primaryHeight - frame.origin.y - frame.size.height),
                      int(frame.size.width), int(frame.size.height));
        if (flipped == geometry) return candidate;
    }
    return nil;
}

QString Desktop::displayId(QScreen *screen) {
    NSScreen *ns = nativeScreen(screen);
    NSNumber *number = ns.deviceDescription[@"NSScreenNumber"];
    if (number) {
        CFUUIDRef uuid = CGDisplayCreateUUIDFromDisplayID(number.unsignedIntValue);
        if (uuid) {
            NSString *text = (__bridge_transfer NSString *)CFUUIDCreateString(nullptr, uuid);
            CFRelease(uuid);
            return QString::fromNSString(text);
        }
    }
    return screen->name();
}

static NSInteger desktopLevel() { return CGWindowLevelForKey(kCGDesktopWindowLevelKey); }

bool Desktop::attach(QWindow *window, QScreen *screen, QString &error) {
    NSWindow *ns = nativeWindow(window);
    if (!ns) { error = "Wallpaper window has no native window"; return false; }
    NSScreen *target = nativeScreen(screen);
    if (!target) { error = "Cannot match AppKit screen for " + screen->name(); return false; }
    // Below Finder's icons (kCGDesktopIconWindowLevel), above the system wallpaper.
    ns.level = desktopLevel();
    ns.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary
        | NSWindowCollectionBehaviorIgnoresCycle | NSWindowCollectionBehaviorFullScreenNone;
    ns.ignoresMouseEvents = YES;
    ns.hasShadow = NO;
    ns.excludedFromWindowsMenu = YES;
    ns.hidesOnDeactivate = NO;
    ns.canHide = NO;   // Hide Others / ⌘H must not hide the wallpaper.
    ns.animationBehavior = NSWindowAnimationBehaviorNone;
    [ns setFrame:target.frame display:YES];
    [ns orderBack:nil];
    qInfo() << "Attached" << screen->name() << "level" << int(ns.level) << "frame"
            << int(target.frame.origin.x) << int(target.frame.origin.y)
            << int(target.frame.size.width) << int(target.frame.size.height);
    return true;
}

bool Desktop::isAttached(QWindow *window) {
    NSWindow *ns = nativeWindow(window);
    if (!ns || !ns.screen) return false;
    return ns.level == desktopLevel() && ns.isVisible && NSEqualRects(ns.frame, ns.screen.frame);
}

bool Desktop::isVisible(QWindow *window) {
    NSWindow *ns = nativeWindow(window);
    return ns && (ns.occlusionState & NSWindowOcclusionStateVisible);
}

bool Desktop::lowPowerMode() {
    if (@available(macOS 12.0, *)) return NSProcessInfo.processInfo.lowPowerModeEnabled;
    return false;
}

void Desktop::observe(std::function<void(Event)> handler) {
    auto send = [handler](Event event) { return ^(NSNotification *) { handler(event); }; };
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    NSOperationQueue *main = NSOperationQueue.mainQueue;
    [workspace addObserverForName:NSWorkspaceWillSleepNotification object:nil queue:main usingBlock:send(Event::Sleep)];
    [workspace addObserverForName:NSWorkspaceDidWakeNotification object:nil queue:main usingBlock:send(Event::Wake)];
    [workspace addObserverForName:NSWorkspaceScreensDidSleepNotification object:nil queue:main usingBlock:send(Event::DisplaySleep)];
    [workspace addObserverForName:NSWorkspaceScreensDidWakeNotification object:nil queue:main usingBlock:send(Event::DisplayWake)];
    [workspace addObserverForName:NSWorkspaceActiveSpaceDidChangeNotification object:nil queue:main usingBlock:send(Event::SpaceChanged)];
    NSDistributedNotificationCenter *distributed = NSDistributedNotificationCenter.defaultCenter;
    [distributed addObserverForName:@"com.apple.screenIsLocked" object:nil queue:main usingBlock:send(Event::Lock)];
    [distributed addObserverForName:@"com.apple.screenIsUnlocked" object:nil queue:main usingBlock:send(Event::Unlock)];
}

void Desktop::activate() {
    [NSApp activateIgnoringOtherApps:YES];
}

void Desktop::onReopen(std::function<void()> handler) {
    // Qt's application delegate answers applicationShouldHandleReopen itself
    // and never tells the app. Wrap that method so a Dock click opens settings.
    id delegate = NSApp.delegate;
    if (!delegate) { qWarning() << "No application delegate; Dock clicks will not open settings"; return; }
    Class cls = object_getClass(delegate);
    SEL selector = @selector(applicationShouldHandleReopen:hasVisibleWindows:);
    Method method = class_getInstanceMethod(cls, selector);
    using Reopen = BOOL (*)(id, SEL, NSApplication *, BOOL);
    Reopen original = method ? reinterpret_cast<Reopen>(method_getImplementation(method)) : nullptr;
    IMP replacement = imp_implementationWithBlock(^BOOL(id self, NSApplication *app, BOOL visible) {
        handler();
        return original ? original(self, selector, app, visible) : YES;
    });
    if (method) method_setImplementation(method, replacement);
    else class_addMethod(cls, selector, replacement, "c@:@c");
}

// A quarantined app opened from Downloads runs from a read-only randomized
// copy (App Translocation). Ask Security for the real location.
static NSString *originalBundlePath(NSString *path) {
    if (![path containsString:@"/AppTranslocation/"]) return path;
    using Original = CFURLRef (*)(CFURLRef, CFErrorRef *);
    void *security = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY);
    auto original = security ? reinterpret_cast<Original>(dlsym(security, "SecTranslocateCreateOriginalPathForURL")) : nullptr;
    if (!original) return nil;
    CFURLRef url = original((__bridge CFURLRef)[NSURL fileURLWithPath:path], nullptr);
    return url ? ((__bridge_transfer NSURL *)url).path : nil;
}

Desktop::MoveResult Desktop::offerMoveToApplications() {
    NSString *source = originalBundlePath(NSBundle.mainBundle.bundlePath);
    if (!source) return MoveResult::NotNeeded;
    NSString *userApplications = [NSHomeDirectory() stringByAppendingPathComponent:@"Applications/"];
    if ([source hasPrefix:@"/Applications/"] || [source hasPrefix:userApplications]) return MoveResult::NotNeeded;

    [NSApp activateIgnoringOtherApps:YES];
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Move Moonphase to the Applications folder?";
    alert.informativeText = [NSString stringWithFormat:
        @"Moonphase is running from “%@”. In Applications it keeps working after you clean up that folder, and Open at Login stays reliable.",
        [NSFileManager.defaultManager displayNameAtPath:source.stringByDeletingLastPathComponent]];
    [alert addButtonWithTitle:@"Move to Applications Folder"];
    [alert addButtonWithTitle:@"Do Not Move"];
    alert.showsSuppressionButton = YES;
    alert.suppressionButton.title = @"Don’t ask again";
    if ([alert runModal] != NSAlertFirstButtonReturn)
        return alert.suppressionButton.state == NSControlStateValueOn ? MoveResult::DeclinedForever : MoveResult::Declined;

    NSFileManager *files = NSFileManager.defaultManager;
    NSString *destination = [@"/Applications" stringByAppendingPathComponent:source.lastPathComponent];
    NSError *error = nil;
    BOOL ok = YES;
    if ([files fileExistsAtPath:destination])   // An older copy: keep it in the Trash, not deleted.
        ok = [files trashItemAtURL:[NSURL fileURLWithPath:destination] resultingItemURL:nil error:&error];
    if (ok) ok = [files copyItemAtPath:source toPath:destination error:&error];
    if (!ok) {
        NSAlert *failed = [NSAlert new];
        failed.alertStyle = NSAlertStyleWarning;
        failed.messageText = @"Couldn’t move Moonphase";
        failed.informativeText = [NSString stringWithFormat:@"%@\n\nDrag Moonphase into the Applications folder in Finder instead.",
                                  error.localizedDescription];
        [failed runModal];
        return MoveResult::Declined;
    }
    [files trashItemAtURL:[NSURL fileURLWithPath:source] resultingItemURL:nil error:nil];
    qInfo() << "Moved to" << QString::fromNSString(destination) << "; relaunching";

    // Open the new copy once this process has exited, so the single-instance
    // check does not hand the launch back to us.
    NSTask *relaunch = [NSTask new];
    relaunch.executableURL = [NSURL fileURLWithPath:@"/bin/sh"];
    relaunch.arguments = @[@"-c", @"while /bin/kill -0 \"$1\" 2>/dev/null; do /bin/sleep 0.2; done; /usr/bin/open \"$2\"",
                           @"relaunch", @(NSProcessInfo.processInfo.processIdentifier).stringValue, destination];
    [relaunch launchAndReturnError:nil];
    return MoveResult::Moved;
}

bool Desktop::loginItemEnabled() {
    if (@available(macOS 13.0, *)) return SMAppService.mainAppService.status == SMAppServiceStatusEnabled;
    return false;
}

bool Desktop::setLoginItem(bool enabled, QString &error) {
    if (@available(macOS 13.0, *)) {
        NSError *failure = nil;
        BOOL ok = enabled ? [SMAppService.mainAppService registerAndReturnError:&failure]
                          : [SMAppService.mainAppService unregisterAndReturnError:&failure];
        if (!ok) error = QString::fromNSString(failure.localizedDescription);
        return ok;
    }
    error = "Open at login needs macOS 13 or later";
    return false;
}
