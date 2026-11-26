// SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
// SPDX-License-Identifier: GPL-2.0-or-later
#include "app.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QFile>
#include <QStandardPaths>
#include <QDateTime>
#include <QMutex>
#include <QMutexLocker>
#include <QLocalServer>
#include <QLocalSocket>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QTextStream>
#include <atomic>

static QString logPath;
static QMutex logMutex;
static std::atomic_bool renderError{false};
static void logMessage(QtMsgType type, const QMessageLogContext &, const QString &message) {
    QMutexLocker guard(&logMutex);
    QFile log(logPath);
    if (log.open(QIODevice::Append | QIODevice::Text)) {
        QTextStream out(&log);
        out << QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs) << " [" << int(type) << "] " << message << '\n';
    }
    if (type == QtCriticalMsg || type == QtFatalMsg || message.contains("Failed to create") || message.contains("shader compilation failed", Qt::CaseInsensitive)) renderError = true;
}

int main(int argc, char **argv) {
    QCoreApplication::setOrganizationName("MoonphaseWindows");
    QCoreApplication::setApplicationName("Moonphase");
    QCoreApplication::setApplicationVersion("1.0.0");
    // D3D11 is Qt Quick's native Windows backend and avoids WGL desktop issues.
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
    QApplication application(argc, argv);
    application.setQuitOnLastWindowClosed(false);
    QCommandLineParser parser;
    parser.setApplicationDescription("Moonphase live wallpaper for Windows 11");
    parser.addHelpOption(); parser.addVersionOption();
    for (auto option : {"preview", "wallpaper", "settings", "stop", "quit", "reattach", "pause", "resume", "isolated", "no-network", "static", "test-detach", "fullscreen-probe"})
        parser.addOption(QCommandLineOption(option, QString("%1 mode").arg(option)));
    parser.addOption({"capture", "Save a rendered PNG after three seconds", "path"});
    parser.addOption({"report", "Write JSON diagnostics before timed exit", "path"});
    parser.addOption({"test-seconds", "Exit cleanly after a bounded test", "seconds"});
    parser.addOption({"phase", "Simulate lunar phase (0..1)", "phase"});
    parser.addOption({"day", "Simulate day of year (1..365.25)", "day"});
    parser.addOption({"style", "Background: 0 chart, 1 etchings, 2 combined", "style"});
    parser.addOption({"set", "Override setting (repeatable key=value)", "key=value"});
    parser.process(application);
    if (parser.isSet("fullscreen-probe")) {
        QWidget probe;
        probe.setWindowTitle("Moonphase fullscreen pause test");
        probe.setStyleSheet("background: #05070d;");
        probe.showFullScreen();
        QTimer::singleShot(7000, &application, &QApplication::quit);
        return application.exec();
    }
    auto absolute = [](const QString &path) { return QFileInfo(path).absoluteFilePath(); };
    QString configDir = parser.isSet("isolated") ? QDir::current().filePath("test-results/isolated") :
        QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    QDir().mkpath(configDir);
    logPath = configDir + "/moonphase.log";
    qInstallMessageHandler(logMessage);
    qInfo() << "Moonphase starting; Qt" << qVersion() << "D3D11; executable" << application.applicationFilePath();
    QString command = "wallpaper";
    for (const auto &name : {"preview", "settings", "stop", "quit", "reattach", "pause", "resume", "wallpaper", "test-detach"})
        if (parser.isSet(name)) command = name;
    QLocalServer server;
    server.setSocketOptions(QLocalServer::UserAccessOption);
    QString serverName = "MoonphaseWindows-" + qEnvironmentVariable("USERNAME") + (parser.isSet("isolated") ? "-test" : "");
    QString mutexName = "Local\\" + serverName;
    std::unique_ptr<void, decltype(&CloseHandle)> instance(CreateMutexW(nullptr, FALSE, reinterpret_cast<LPCWSTR>(mutexName.utf16())), &CloseHandle);
    bool instanceExists = GetLastError() == ERROR_ALREADY_EXISTS;
    if (!instance) { qCritical() << "Cannot acquire instance mutex"; return 2; }
    QLocalSocket socket;
    socket.connectToServer(serverName);
    if (socket.waitForConnected(2000)) {
        socket.write(command.toUtf8() + '\n'); socket.flush();
        if (!socket.waitForReadyRead(8000) || socket.readLine().trimmed() != "OK") {
            qCritical() << "Running instance did not acknowledge command" << command;
            return 2;
        }
        socket.disconnectFromServer(); return 0;
    }
    if (instanceExists) { qCritical() << "Running instance is busy or unavailable"; return 2; }
    if (command == "quit" || command == "stop" || command == "pause" || command == "resume" || command == "test-detach") return 0;
    if (!server.listen(serverName)) { qCritical() << "Cannot acquire single-instance pipe" << server.errorString(); return 2; }
    App app(configDir + "/settings.ini");
    QObject::connect(&server, &QLocalServer::newConnection, &app, [&] {
        while (server.hasPendingConnections()) {
            auto client = server.nextPendingConnection();
            auto dispatch = [&app, client] {
                if (client->canReadLine()) {
                    QString requested = QString::fromUtf8(client->readLine()).trimmed();
                    client->write("OK\n"); client->flush();
                    app.command(requested);
                }
            };
            QObject::connect(client, &QLocalSocket::readyRead, &app, dispatch);
            QObject::connect(client, &QLocalSocket::disconnected, client, &QObject::deleteLater);
            dispatch();
        }
    });
    if (parser.isSet("no-network")) app.setValue("PrayerUseApi", false, false);
    if (parser.isSet("static")) app.setValue("SeasonalBackgroundAnimate", false, false);
    if (parser.isSet("phase") || parser.isSet("day")) {
        app.setValue("DebugTimeOverrideEnabled", true, false);
        if (parser.isSet("phase")) app.setValue("DebugPhaseValue", qBound(0., parser.value("phase").toDouble(), 1.), false);
        if (parser.isSet("day")) app.setValue("DebugDayOfYearOverride", qBound(1., parser.value("day").toDouble(), 365.25), false);
    }
    if (parser.isSet("style")) app.setValue("SeasonalBackgroundStyle", qBound(0, parser.value("style").toInt(), 2), false);
    for (auto setting : parser.values("set")) {
        auto equals = setting.indexOf('=');
        if (equals < 1) continue;
        auto value = setting.mid(equals+1);
        QVariant typed = value == "true" ? QVariant(true) : value == "false" ? QVariant(false) : QVariant(value);
        app.setValue(setting.left(equals), typed, false);
    }
    app.command(command);
    QString capture = parser.isSet("capture") ? absolute(parser.value("capture")) : QString();
    QString report = parser.isSet("report") ? absolute(parser.value("report")) : QString();
    if (!capture.isEmpty()) QTimer::singleShot(3000, &app, [&app, capture] { app.capture(capture); });
    if (parser.isSet("test-seconds")) {
        int duration = qMax(4, parser.value("test-seconds").toInt());
        QTimer::singleShot(duration * 1000, &app, [&] {
            app.failed = app.failed || renderError;
            if (!report.isEmpty()) app.report(report);
            application.exit(app.failed ? 2 : 0);
        });
    }
    int result = application.exec();
    return result;
}
