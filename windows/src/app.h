// SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <QAbstractNativeEventFilter>
#include <QQmlPropertyMap>
#include <QSettings>
#include <QTimer>
#include <QPointer>
#include <QQuickView>
#include <QSystemTrayIcon>
#include <QDialog>
#include <memory>
#include <vector>
#include "desktop.h"

struct SettingSpec { QString key, type, label; QVariant initial; double minimum, maximum; };
class App : public QObject, public QAbstractNativeEventFilter {
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
    bool nativeEventFilter(const QByteArray &, void *, qintptr *) override;
    bool failed = false;
signals:
    void pausedChanged();
    void settingsChanged();
private:
    QQuickView *makeView(bool desktop);
    void poll();
    void loadSchema();
    void createTray();
    void setStartup(bool enabled);
    QQmlPropertyMap config_;
    QSettings prefs_;
    QList<SettingSpec> specs_;
    QSystemTrayIcon tray_;
    std::unique_ptr<class QMenu> menu_;
    std::vector<std::unique_ptr<QQuickView>> wallpapers_;
    QPointer<QQuickView> preview_;
    QPointer<QDialog> settings_;
    Desktop::Layer layer_;
    QTimer poll_;
    bool wallpaperRequested_ = false, userPaused_ = false, paused_ = false, locked_ = false, sleeping_ = false, changing_ = false;
    class QWidget *receiver_ = nullptr;
};
