// SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
// SPDX-License-Identifier: GPL-2.0-or-later
#include "app.h"
#include <QApplication>
#include <QScreen>
#include <QQmlContext>
#include <QQuickItem>
#include <QXmlStreamReader>
#include <QFile>
#include <QDir>
#include <QMenu>
#include <QPainter>
#include <QFormLayout>
#include <QVBoxLayout>
#include <QScrollArea>
#include <QCheckBox>
#include <QDoubleSpinBox>
#include <QSpinBox>
#include <QLineEdit>
#include <QComboBox>
#include <QPushButton>
#include <QDialogButtonBox>
#include <QColorDialog>
#include <QLabel>
#include <QMessageBox>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
#include <QStandardPaths>
#include <QJSValue>
#include <QTimeZone>
#include <limits>
#include <QScopedValueRollback>
#include <wtsapi32.h>
#include <cmath>

static QIcon moonIcon() {
    QPixmap pix(64, 64); pix.fill(Qt::transparent);
    QPainter p(&pix); p.setRenderHint(QPainter::Antialiasing);
    p.setPen(QPen(QColor("#c8a86c"), 2)); p.setBrush(QColor("#101b2b")); p.drawEllipse(3, 3, 58, 58);
    p.setPen(Qt::NoPen); p.setBrush(QColor("#e4e8ee")); p.drawEllipse(13, 12, 37, 39);
    p.setBrush(QColor("#101b2b")); p.drawEllipse(25, 7, 30, 40);
    return QIcon(pix);
}

App::App(const QString &ini, QObject *parent) : QObject(parent), prefs_(ini, QSettings::IniFormat) {
    QApplication::setWindowIcon(moonIcon());
    loadSchema(); createTray();
    receiver_ = new QWidget;
    receiver_->setWindowTitle("Moonphase shell notification receiver");
    receiver_->setAttribute(Qt::WA_DontShowOnScreen);
    receiver_->winId();
    WTSRegisterSessionNotification(reinterpret_cast<HWND>(receiver_->winId()), NOTIFY_FOR_THIS_SESSION);
    qApp->installNativeEventFilter(this);
    connect(&poll_, &QTimer::timeout, this, &App::poll);
    poll_.start(2000);
    connect(qApp, &QGuiApplication::screenAdded, this, [this] { if (wallpaperRequested_) start(); });
    connect(qApp, &QGuiApplication::screenRemoved, this, [this] {
        QTimer::singleShot(100, this, [this] { if (wallpaperRequested_) start(); });
    });
    for (auto screen : QGuiApplication::screens())
        connect(screen, &QScreen::geometryChanged, this, [this] { if (wallpaperRequested_) start(); });
}

App::~App() {
    poll_.stop(); tray_.hide();
    if (preview_) delete preview_;
    if (settings_) delete settings_;
    wallpapers_.clear();
    WTSUnRegisterSessionNotification(reinterpret_cast<HWND>(receiver_->winId()));
    delete receiver_;
    qApp->removeNativeEventFilter(this);
    prefs_.sync();
    qInfo() << "Clean shutdown: wallpaper windows destroyed";
}

void App::loadSchema() {
    QFile file(":/wallpaper/contents/config/main.xml");
    if (!file.open(QIODevice::ReadOnly)) qFatal("Missing embedded settings schema");
    QXmlStreamReader xml(&file);
    while (!xml.atEnd()) {
        xml.readNext();
        if (!xml.isStartElement() || xml.name() != u"entry") continue;
        SettingSpec spec;
        spec.key = xml.attributes().value("name").toString();
        spec.type = xml.attributes().value("type").toString();
        spec.minimum = 0; spec.maximum = 100;
        QString initial;
        while (xml.readNextStartElement()) {
            auto tag = xml.name().toString();
            auto value = xml.readElementText();
            if (tag == "label") spec.label = value;
            if (tag == "default") initial = value;
            if (tag == "min") spec.minimum = value.toDouble();
            if (tag == "max") spec.maximum = value.toDouble();
        }
        if (spec.type == "Bool") spec.initial = initial == "true";
        else if (spec.type == "Double") spec.initial = initial.toDouble();
        else if (spec.type == "Int") spec.initial = initial.toInt();
        else spec.initial = QColor(initial);
        specs_.append(spec);
        auto value = prefs_.value(spec.key, spec.initial);
        if (spec.type == "Color") value = QColor(value.toString());
        config_.insert(spec.key, value);
    }
    config_.insert("ObserverTimeZone", prefs_.value("ObserverTimeZone", "Africa/Cairo"));
}

QString App::timeZoneId() const { return config_.value("ObserverTimeZone").toString(); }
double App::utcOffset(double utcMs) const {
    QTimeZone zone(timeZoneId().toUtf8());
    if (!zone.isValid()) return std::numeric_limits<double>::quiet_NaN();
    return zone.offsetFromUtc(QDateTime::fromMSecsSinceEpoch(qint64(utcMs), QTimeZone::UTC)) / 60.0;
}

void App::setValue(const QString &key, const QVariant &value, bool persist) {
    config_.insert(key, value);
    if (persist) { prefs_.setValue(key, value); prefs_.sync(); }
    emit settingsChanged();
}

QQuickView *App::makeView(bool desktop) {
    auto view = new QQuickView;
    view->setTitle(desktop ? "Moonphase desktop wallpaper" : "Moonphase — Desktop preview");
    view->setResizeMode(QQuickView::SizeRootObjectToView);
    view->setColor(QColor("#05070d"));
    view->rootContext()->setContextProperty("AppConfig", &config_);
    view->rootContext()->setContextProperty("Host", this);
    if (desktop) view->setFlags(Qt::Tool | Qt::FramelessWindowHint | Qt::WindowDoesNotAcceptFocus);
    view->resize(1280, 720);
    view->setSource(QUrl("qrc:/wallpaper/contents/ui/main.qml"));
    if (view->status() == QQuickView::Error) {
        failed = true;
        for (const auto &error : view->errors()) qCritical() << error;
        delete view; return nullptr;
    }
    return view;
}

void App::preview() {
    if (!preview_) {
        preview_ = makeView(false);
        if (!preview_) return;
        connect(preview_, &QWindow::visibleChanged, this, [this](bool visible) {
            if (!visible && !wallpaperRequested_ && !QSystemTrayIcon::isSystemTrayAvailable()) qApp->quit();
        });
    }
    preview_->show(); preview_->raise(); preview_->requestActivate();
}

void App::start() {
    if (changing_) { QTimer::singleShot(200, this, &App::start); return; }
    QScopedValueRollback<bool> changing(changing_, true);
    wallpaperRequested_ = true;
    wallpapers_.clear();
    layer_ = Desktop::discover();
    if (!layer_.host) {
        qWarning() << "Shell host unavailable; using preview, retrying every 2 seconds";
        if (!preview_ || !preview_->isVisible()) preview();
        return;
    }
    for (auto screen : QGuiApplication::screens()) {
        std::unique_ptr<QQuickView> view(makeView(true));
        if (!view) continue;
        view->setScreen(screen);
        view->resize(screen->size());
        view->create();
        QString error;
        if (!Desktop::attach(reinterpret_cast<HWND>(view->winId()), layer_, screen, error)) {
            qWarning() << error; failed = true; continue;
        }
        view->show();
        // Qt's show can adjust top-level styles; reassert the native child placement.
        if (!Desktop::attach(reinterpret_cast<HWND>(view->winId()), layer_, screen, error)) {
            qWarning() << error; failed = true; continue;
        }
        wallpapers_.push_back(std::move(view));
    }
    if (wallpapers_.empty()) { if (!preview_ || !preview_->isVisible()) preview(); }
    else if (preview_) preview_->hide();
}

void App::stop() {
    if (changing_) { QTimer::singleShot(200, this, &App::stop); return; }
    wallpaperRequested_ = false;
    wallpapers_.clear(); layer_ = {};
    qInfo() << "Wallpaper stopped; Windows wallpaper restored";
}

void App::setUserPaused(bool value) { userPaused_ = value; poll(); }

void App::poll() {
    bool pause = userPaused_ || locked_ || sleeping_ ||
        (wallpaperRequested_ && prefs_.value("PauseFullscreen", true).toBool() && Desktop::isFullscreen());
    if (pause != paused_) {
        paused_ = pause; qInfo() << "Rendering paused:" << pause; emit pausedChanged();
    }
    if (!wallpaperRequested_ || changing_) return;
    bool recover = !IsWindow(layer_.host) || wallpapers_.size() != size_t(QGuiApplication::screens().size());
    for (auto &view : wallpapers_) {
        HWND hwnd = reinterpret_cast<HWND>(view->winId());
        if (!IsWindow(hwnd) || GetParent(hwnd) != layer_.host) recover = true;
    }
    if (recover) {
        // Avoid reentrant poll/start when Explorer is still absent.
        if (FindWindowW(L"Progman", nullptr)) {
            qInfo() << "Recovering missing or detached wallpaper windows";
            QTimer::singleShot(0, this, [this] { if (wallpaperRequested_) start(); });
        }
    }
}

bool App::nativeEventFilter(const QByteArray &, void *data, qintptr *result) {
    auto msg = static_cast<MSG *>(data);
    if (msg->message == WM_WTSSESSION_CHANGE) {
        if (msg->wParam == WTS_SESSION_LOCK) locked_ = true;
        if (msg->wParam == WTS_SESSION_UNLOCK) locked_ = false;
        poll();
    }
    if (msg->message == WM_POWERBROADCAST) {
        if (msg->wParam == PBT_APMSUSPEND) sleeping_ = true;
        if (msg->wParam == PBT_APMRESUMEAUTOMATIC || msg->wParam == PBT_APMRESUMESUSPEND) sleeping_ = false;
        poll();
    }
    static const UINT taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
    if (msg->message == taskbarCreated && wallpaperRequested_)
        QTimer::singleShot(1000, this, [this] { if (wallpaperRequested_) start(); });
    if (msg->message == WM_NCHITTEST || msg->message == WM_MOUSEACTIVATE) {
        for (const auto &view : wallpapers_) {
            if (msg->hwnd == reinterpret_cast<HWND>(view->winId())) {
                *result = msg->message == WM_NCHITTEST ? HTTRANSPARENT : MA_NOACTIVATE;
                return true;
            }
        }
    }
    return false;
}

void App::setStartup(bool enabled) {
    QSettings run("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", QSettings::NativeFormat);
    if (enabled) run.setValue("MoonphaseWindows", '"' + QDir::toNativeSeparators(QCoreApplication::applicationFilePath()) + "\" --wallpaper");
    else run.remove("MoonphaseWindows");
    run.sync();
    if (run.status() != QSettings::NoError) QMessageBox::warning(nullptr, "Moonphase", "Could not update the Windows startup entry.");
}

void App::createTray() {
    tray_.setIcon(moonIcon()); tray_.setToolTip("Moonphase Windows");
    menu_ = std::make_unique<QMenu>();
    menu_->addAction("Start wallpaper (all monitors)", this, &App::start);
    menu_->addAction("Stop wallpaper", this, &App::stop);
    auto pause = menu_->addAction("Pause animation"); pause->setCheckable(true);
    connect(pause, &QAction::toggled, this, &App::setUserPaused);
    menu_->addAction("Desktop preview", this, &App::preview);
    menu_->addAction("Settings…", this, &App::settings);
    menu_->addSeparator();
    auto startup = menu_->addAction("Start with Windows"); startup->setCheckable(true);
    QSettings run("HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", QSettings::NativeFormat);
    startup->setChecked(run.contains("MoonphaseWindows"));
    connect(startup, &QAction::toggled, this, &App::setStartup);
    auto fullscreen = menu_->addAction("Pause for fullscreen applications"); fullscreen->setCheckable(true);
    fullscreen->setChecked(prefs_.value("PauseFullscreen", true).toBool());
    connect(fullscreen, &QAction::toggled, this, [this](bool value) { prefs_.setValue("PauseFullscreen", value); poll(); });
    menu_->addSeparator(); menu_->addAction("Exit", qApp, &QApplication::quit);
    tray_.setContextMenu(menu_.get());
    connect(&tray_, &QSystemTrayIcon::activated, this, [this](auto reason) {
        if (reason == QSystemTrayIcon::DoubleClick) settings();
    });
    tray_.show();
}

void App::settings() {
    if (settings_) { settings_->show(); settings_->raise(); settings_->activateWindow(); return; }
    auto dialog = new QDialog;
    settings_ = dialog; dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle("Moonphase — Settings"); dialog->resize(760, 820);
    auto layout = new QVBoxLayout(dialog);
    auto intro = new QLabel("Changes are saved immediately. Tray menu: start, stop, preview and exit.\nSelect the observer’s timezone for accurate local prayer times and daylight saving.", dialog);
    intro->setWordWrap(true); layout->addWidget(intro);
    auto scroll = new QScrollArea; scroll->setWidgetResizable(true);
    auto page = new QWidget; auto form = new QFormLayout(page);
    form->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
    auto cities = new QComboBox;
    struct City { const char *name; double lat, lon; };
    const City presets[] = {{"Custom coordinates",0,0},{"Stockholm",59.3293,18.0686},{"Makkah",21.4,39.8},
        {"Madinah",24.5,39.6},{"Cairo",30,31.2},{"Jerusalem",31.8,35.2},{"Amman",32,35.9},{"Damascus",33.5,36.3},
        {"Baghdad",33.3,44.4},{"Riyadh",24.7,46.7},{"Dubai",25.2,55.3},{"Doha",25.3,51.5},{"Kuwait",29.4,47.98},
        {"Istanbul",41,28.98},{"Karachi",24.9,67},{"Jakarta",-6.2,106.8},{"Kuala Lumpur",3.1,101.7},
        {"London",51.5,-0.1},{"Paris",48.9,2.35},{"Berlin",52.5,13.4},{"New York",40.7,-74},{"Los Angeles",34,-118.2},
        {"Sydney",-33.9,151.2},{"Cape Town",-33.9,18.4},{"Buenos Aires",-34.6,-58.4}};
    for (auto city : presets) cities->addItem(QString::fromUtf8(city.name), QVariantList{city.lat, city.lon});
    form->addRow("City preset", cities);
    auto zones = new QComboBox;
    zones->addItem("Automatic (original system/longitude fallback)", "");
    for (auto id : QTimeZone::availableTimeZoneIds()) zones->addItem(QString::fromUtf8(id), QString::fromUtf8(id));
    zones->setCurrentIndex(qMax(0, zones->findData(timeZoneId())));
    form->addRow("Observer timezone", zones);
    connect(zones, &QComboBox::currentIndexChanged, this, [this, zones] { setValue("ObserverTimeZone", zones->currentData()); });
    QHash<QString, QWidget *> controls;
    const QHash<QString, QString> titles{
        {"UpdateIntervalMinutes","Moon update interval (minutes)"}, {"MoonScale","Moon size (fraction of screen height)"},
        {"BackgroundColor","Background color"}, {"EarthshineIntensity","Dark-side glow"}, {"CraterReliefStrength","Crater relief strength"},
        {"SouthernHemisphereFlip","Southern hemisphere orientation"}, {"ShowTelemetryOverlay","Show curved information captions"},
        {"DebugTimeOverrideEnabled","Simulate date and Moon phase"}, {"DebugPhaseValue","Simulated Moon phase (0–1)"},
        {"ShowOrbitWidget","Show orbit and seasons"}, {"ShowEarthWidget","Show Earth globe"},
        {"ShowPrayerClockWidget","Show prayer clock"}, {"PrayerCalculationMethod","Prayer calculation method"},
        {"PrayerAsrSchool","Asr school"}, {"PrayerUseApi","Use AlAdhan (with offline fallback)"},
        {"CornerWidgetSize","Instrument size (pixels)"}, {"CornerMargin","Screen margin (pixels)"},
        {"ObserverLatitude","Latitude (degrees north)"}, {"ObserverLongitude","Longitude (degrees east)"},
        {"ShowObserverPin","Show observer pin"}, {"ShowSeasonalGhostEarths","Show seasonal orbit markers"},
        {"DebugDayOfYearOverride","Simulated day of year"}, {"DebugUTCHourOverride","Simulated UTC hour"},
        {"SeasonalBackgroundMode","Background season"}, {"SeasonalBackgroundStyle","Background style"},
        {"SeasonalBackgroundAnimate","Animate background"}, {"SeasonalBackgroundIntensity","Background intensity"},
        {"SeasonalBackgroundFps","Background frames per second"}};
    for (const auto &spec : specs_) {
        QWidget *control = nullptr;
        auto value = config_.value(spec.key);
        if (spec.type == "Bool") {
            auto check = new QCheckBox; check->setChecked(value.toBool()); control = check;
            connect(check, &QCheckBox::toggled, this, [this, key=spec.key](bool checked) { setValue(key, checked); });
        } else if (spec.key == "BackgroundColor") {
            auto button = new QPushButton(value.value<QColor>().name()); control = button;
            connect(button, &QPushButton::clicked, dialog, [this, button] {
                QColor color = QColorDialog::getColor(config_.value("BackgroundColor").value<QColor>(), button, "Background color");
                if (color.isValid()) { setValue("BackgroundColor", color); button->setText(color.name()); }
            });
        } else if (spec.key == "PrayerCalculationMethod" || spec.key == "PrayerAsrSchool" ||
                   spec.key == "SeasonalBackgroundMode" || spec.key == "SeasonalBackgroundStyle") {
            auto combo = new QComboBox; control = combo;
            if (spec.key == "PrayerCalculationMethod") {
                const int ids[] = {3,4,5,2,13,1,7};
                QStringList names{"MWL","Umm al-Qura","Egyptian","ISNA","Diyanet","Karachi","Tehran"};
                for (int i=0;i<7;++i) combo->addItem(names[i], ids[i]);
            } else {
                QStringList names = spec.key == "PrayerAsrSchool" ? QStringList{"Standard / Shafi", "Hanafi"} :
                    spec.key == "SeasonalBackgroundMode" ? QStringList{"Automatic", "Spring", "Summer", "Autumn", "Winter", "Solid color"} :
                    QStringList{"Star chart", "Seasonal etchings", "Combined"};
                for (int i=0;i<names.size();++i) combo->addItem(names[i], i);
            }
            combo->setCurrentIndex(combo->findData(value.toInt()));
            connect(combo, &QComboBox::currentIndexChanged, this, [this, combo, key=spec.key] { setValue(key, combo->currentData()); });
        } else {
            auto spin = new QDoubleSpinBox; control = spin;
            spin->setRange(spec.minimum, spec.maximum);
            spin->setDecimals(spec.type == "Int" ? 0 : spec.key == "EarthshineIntensity" ? 3 : 4);
            spin->setSingleStep(spec.type == "Int" ? 1 : 0.01);
            spin->setValue(value.toDouble());
            spin->setKeyboardTracking(false);
            connect(spin, &QDoubleSpinBox::valueChanged, this, [this, key=spec.key, type=spec.type](double number) {
                setValue(key, type == "Int" ? QVariant(int(number)) : QVariant(number));
            });
        }
        control->setAccessibleName(spec.label); control->setToolTip(spec.key);
        controls.insert(spec.key, control);
        auto label = new QLabel(titles.value(spec.key, spec.key)); label->setToolTip(spec.label);
        form->addRow(label, control);
    }
    connect(cities, &QComboBox::currentIndexChanged, dialog, [cities, zones, controls](int index) {
        if (index == 0) return;
        auto coords = cities->currentData().toList();
        static_cast<QDoubleSpinBox *>(controls.value("ObserverLatitude"))->setValue(coords[0].toDouble());
        static_cast<QDoubleSpinBox *>(controls.value("ObserverLongitude"))->setValue(coords[1].toDouble());
        static_cast<QCheckBox *>(controls.value("SouthernHemisphereFlip"))->setChecked(coords[0].toDouble() < 0);
        const char *cityZones[] = {"", "Europe/Stockholm", "Asia/Riyadh", "Asia/Riyadh", "Africa/Cairo", "Asia/Jerusalem",
            "Asia/Amman", "Asia/Damascus", "Asia/Baghdad", "Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait",
            "Europe/Istanbul", "Asia/Karachi", "Asia/Jakarta", "Asia/Kuala_Lumpur", "Europe/London", "Europe/Paris",
            "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "Africa/Johannesburg", "America/Argentina/Buenos_Aires"};
        zones->setCurrentIndex(qMax(0, zones->findData(QString::fromLatin1(cityZones[index]))));
    });
    scroll->setWidget(page); layout->addWidget(scroll);
    auto buttons = new QDialogButtonBox(QDialogButtonBox::Close);
    auto live = buttons->addButton("Return to live time", QDialogButtonBox::ActionRole);
    connect(live, &QPushButton::clicked, dialog, [controls] {
        static_cast<QCheckBox *>(controls.value("DebugTimeOverrideEnabled"))->setChecked(false);
    });
    connect(buttons, &QDialogButtonBox::rejected, dialog, &QDialog::close);
    layout->addWidget(buttons); dialog->show();
}

void App::command(const QString &text) {
    if (changing_) { QTimer::singleShot(200, this, [this, text] { command(text); }); return; }
    qInfo() << "Command:" << text;
    if (text == "quit") qApp->quit();
    else if (text == "stop") stop();
    else if (text == "preview") preview();
    else if (text == "settings") settings();
    else if (text == "pause") setUserPaused(true);
    else if (text == "resume") setUserPaused(false);
    else if (text == "test-detach" && !wallpapers_.empty()) {
        // Exercise automatic recovery without interrupting the user's Explorer.
        wallpapers_.front()->hide();
        SetParent(reinterpret_cast<HWND>(wallpapers_.front()->winId()), nullptr);
        qInfo() << "Test: detached an owned wallpaper window";
    }
    else if (text == "wallpaper" || text == "reattach") start();
}

void App::capture(const QString &file) {
    if (settings_ && wallpapers_.empty() && !preview_) {
        if (!settings_->grab().save(file)) failed = true;
        return;
    }
    QQuickView *view = !wallpapers_.empty() ? wallpapers_.front().get() : preview_.data();
    if (!view) { qCritical() << "No window to capture"; failed = true; return; }
    QImage image = view->grabWindow();
    bool saved = !image.isNull() && image.save(file);
    qInfo() << "Capture" << file << image.size() << saved;
    if (!saved) failed = true;
}

void App::report(const QString &file) {
    QJsonArray windows;
    for (auto &view : wallpapers_) {
        HWND hwnd = reinterpret_cast<HWND>(view->winId());
        RECT rect{}; GetWindowRect(hwnd, &rect);
        windows.append(QJsonObject{{"screen", view->screen()->name()}, {"hwnd", QString::number(quintptr(hwnd))},
            {"valid", bool(IsWindow(hwnd))}, {"parentMatches", GetParent(hwnd) == layer_.host},
            {"childStyle", bool(GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_CHILD)},
            {"noActivate", bool(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_NOACTIVATE)},
            {"x",int(rect.left)},{"y",int(rect.top)},{"width",int(rect.right-rect.left)},{"height",int(rect.bottom-rect.top)}});
    }
    QQuickView *view = !wallpapers_.empty() ? wallpapers_.front().get() : preview_.data();
    QJsonObject scene;
    if (view && view->rootObject()) {
        for (auto key : {"debugActive", "observerLat", "observerLon", "prayerLocalTimeHours", "prayerMethodName", "prayerSource", "prayerTzHours", "activeSeasonIndex", "hijriDayLabel", "hijriMonthYearLabel", "moonTexLoaded", "moonCacheLocked"})
            scene.insert(key, QJsonValue::fromVariant(view->rootObject()->property(key)));
        auto moon = view->rootObject()->property("moonState").value<QJSValue>();
        scene.insert("moon", QJsonValue::fromVariant(moon.toVariant()));
    }
    QJsonObject report{{"timestamp",QDateTime::currentDateTimeUtc().toString(Qt::ISODate)},
        {"qt",qVersion()}, {"failed",failed}, {"paused",paused_}, {"wallpaperRequested",wallpaperRequested_},
        {"hostMethod",layer_.method}, {"hostClass",Desktop::className(layer_.host)},
        {"iconsValid",bool(IsWindow(layer_.icons))}, {"windows",windows}, {"scene",scene}};
    QFile output(file);
    if (output.open(QIODevice::WriteOnly)) output.write(QJsonDocument(report).toJson());
    else { qCritical() << "Cannot write report" << file; failed = true; }
}
