// SPDX-License-Identifier: GPL-2.0-or-later
// macOS host, ported from the Windows host by Muhannad Al-Ahmad.
#include "app.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QFile>
#include <QFileInfo>
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
    QCoreApplication::setOrganizationName("MoonphaseMac");
    QCoreApplication::setApplicationName("Moonphase");
    QCoreApplication::setApplicationVersion("1.0.0");
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Metal);
    QApplication application(argc, argv);
    application.setQuitOnLastWindowClosed(false);
    QCommandLineParser parser;
    parser.setApplicationDescription("Moonphase live wallpaper for macOS");
    parser.addHelpOption(); parser.addVersionOption();
    for (auto option : {"preview", "wallpaper", "settings", "stop", "quit", "reattach", "pause", "resume", "isolated", "no-network", "static"})
        parser.addOption(QCommandLineOption(option, QString("%1 mode").arg(option)));
    parser.addOption({"capture", "Save a rendered PNG after three seconds", "path"});
    parser.addOption({"report", "Write JSON diagnostics before timed exit", "path"});
    parser.addOption({"test-seconds", "Exit cleanly after a bounded test", "seconds"});
    parser.addOption({"phase", "Simulate lunar phase (0..1)", "phase"});
    parser.addOption({"day", "Simulate day of year (1..365.25)", "day"});
    parser.addOption({"style", "Background: 0 chart, 1 etchings, 2 combined", "style"});
    parser.addOption({"set", "Override setting (repeatable key=value)", "key=value"});
    parser.process(application);
    auto absolute = [](const QString &path) { return QFileInfo(path).absoluteFilePath(); };
    QString configDir = parser.isSet("isolated") ? QDir::current().filePath("test-results/isolated") :
        QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(configDir);
    logPath = configDir + "/moonphase.log";
    qInstallMessageHandler(logMessage);
    qInfo() << "Moonphase starting; Qt" << qVersion() << "Metal; executable" << application.applicationFilePath();
    QString command = "wallpaper";
    for (const auto &name : {"preview", "settings", "stop", "quit", "reattach", "pause", "resume", "wallpaper"})
        if (parser.isSet(name)) command = name;

    // Single instance per user: later launches hand their command over.
    QString serverName = "MoonphaseMac-" + qEnvironmentVariable("USER") + (parser.isSet("isolated") ? "-test" : "");
    QLocalSocket socket;
    socket.connectToServer(serverName);
    if (socket.waitForConnected(1000)) {
        socket.write(command.toUtf8() + '\n'); socket.flush();
        if (!socket.waitForReadyRead(8000) || socket.readLine().trimmed() != "OK") {
            qCritical() << "Running instance did not acknowledge command" << command;
            return 2;
        }
        socket.disconnectFromServer(); return 0;
    }
    if (command == "quit" || command == "stop" || command == "pause" || command == "resume") return 0;
    QLocalServer server;
    server.setSocketOptions(QLocalServer::UserAccessOption);
    QLocalServer::removeServer(serverName);   // Stale socket file from a crash.
    if (!server.listen(serverName)) { qCritical() << "Cannot listen for commands" << server.errorString(); return 2; }

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
    for (const auto &setting : parser.values("set")) {
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
    return application.exec();
}
