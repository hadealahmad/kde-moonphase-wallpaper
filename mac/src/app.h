// SPDX-License-Identifier: GPL-2.0-or-later
// macOS host, ported from the Windows host by Muhannad Al-Ahmad.
#pragma once
#include <QObject>
#include <QQmlPropertyMap>
#include <QSettings>
#include <QTimer>
#include <QPointer>
#include <QQuickView>
#include <QSystemTrayIcon>
#include <QDialog>
#include <QElapsedTimer>
#include <memory>
#include <vector>

struct SettingSpec { QString key, type, label; QVariant initial; double minimum, maximum; };
class App : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool paused READ paused NOTIFY pausedChanged)
public:
    App(const QString &ini, QObject *parent = nullptr);
    ~App() override;
    bool paused() const { return paused_; }
    Q_INVOKABLE double utcOffset(double utcMs) const;
    Q_INVOKABLE QString timeZoneId() const;
    void start();
    void stop();
    void preview();
    void settings();
    void command(const QString &command);
    void setValue(const QString &key, const QVariant &value, bool persist = true);
    void capture(const QString &file);
    void report(const QString &file);
    void setUserPaused(bool value);
    bool failed = false;
signals:
    void pausedChanged();
    void settingsChanged();
    void displaysChanged();
private:
    bool displayEnabled(class QScreen *screen) const;
    void setDisplayEnabled(class QScreen *screen, bool enabled);
    QString displayLabel(class QScreen *screen) const;
    int enabledDisplayCount() const;
    void fillDisplayMenu(class QMenu *menu);
    QQuickView *makeView(bool desktop);
    void poll();
    void loadSchema();
    void chooseInitialLocation();
    void createMenus();
    void populate(class QMenu *menu);
    void reopened();
    QQmlPropertyMap config_;
    QSettings prefs_;
    QList<SettingSpec> specs_;
    QSystemTrayIcon tray_;
    std::unique_ptr<class QMenu> trayMenu_, dockMenu_;
    class QAction *pauseAction_ = nullptr, *loginAction_ = nullptr;
    std::vector<std::unique_ptr<QQuickView>> wallpapers_;
    QPointer<QQuickView> preview_;
    QPointer<QDialog> settings_;
    QTimer poll_;
    QElapsedTimer launched_;
    bool wallpaperRequested_ = false, userPaused_ = false, paused_ = false, locked_ = false,
         sleeping_ = false, displayAsleep_ = false, hidden_ = false, changing_ = false;
};
