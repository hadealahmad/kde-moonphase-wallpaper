// SPDX-License-Identifier: GPL-2.0-or-later
// macOS host, ported from the Windows host by Muhannad Al-Ahmad.
#include "app.h"
#include "desktop.h"
#include <QApplication>
#include <QScreen>
#include <QQmlContext>
#include <QQuickItem>
#include <QXmlStreamReader>
#include <QFile>
#include <QMenu>
#include <QAction>
#include <QSignalBlocker>
#include <QPainter>
#include <QPainterPath>
#include <QFormLayout>
#include <QVBoxLayout>
#include <QScrollArea>
#include <QCheckBox>
#include <QDoubleSpinBox>
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
#include <QJSValue>
#include <QTimeZone>
#include <QScopedValueRollback>
#include <limits>

namespace {
struct City { const char *name; double lat, lon; const char *zone; };
const City cities[] = {{"Custom coordinates",0,0,""},{"Stockholm",59.3293,18.0686,"Europe/Stockholm"},
    {"Makkah",21.4,39.8,"Asia/Riyadh"},{"Madinah",24.5,39.6,"Asia/Riyadh"},{"Cairo",30,31.2,"Africa/Cairo"},
    {"Jerusalem",31.8,35.2,"Asia/Jerusalem"},{"Amman",32,35.9,"Asia/Amman"},{"Damascus",33.5,36.3,"Asia/Damascus"},
    {"Baghdad",33.3,44.4,"Asia/Baghdad"},{"Riyadh",24.7,46.7,"Asia/Riyadh"},{"Dubai",25.2,55.3,"Asia/Dubai"},
    {"Doha",25.3,51.5,"Asia/Qatar"},{"Kuwait",29.4,47.98,"Asia/Kuwait"},{"Istanbul",41,28.98,"Europe/Istanbul"},
    {"Karachi",24.9,67,"Asia/Karachi"},{"Jakarta",-6.2,106.8,"Asia/Jakarta"},{"Kuala Lumpur",3.1,101.7,"Asia/Kuala_Lumpur"},
    {"London",51.5,-0.1,"Europe/London"},{"Paris",48.9,2.35,"Europe/Paris"},{"Berlin",52.5,13.4,"Europe/Berlin"},
    {"New York",40.7,-74,"America/New_York"},{"Los Angeles",34,-118.2,"America/Los_Angeles"},
    {"Sydney",-33.9,151.2,"Australia/Sydney"},{"Cape Town",-33.9,18.4,"Africa/Johannesburg"},
    {"Buenos Aires",-34.6,-58.4,"America/Argentina/Buenos_Aires"}};

// Monochrome crescent for the menu bar; macOS tints template images itself.
QIcon menuBarIcon() {
    QIcon icon;
    for (int size : {18, 36}) {
        QPixmap pix(size, size); pix.fill(Qt::transparent);
        QPainter p(&pix); p.setRenderHint(QPainter::Antialiasing);
        const qreal s = size / 18.0;
        QPainterPath moon; moon.addEllipse(QRectF(2*s, 2*s, 14*s, 14*s));
        QPainterPath bite; bite.addEllipse(QRectF(6.5*s, 0.5*s, 12*s, 12*s));
        p.fillPath(moon.subtracted(bite), Qt::black);
        p.end();
        pix.setDevicePixelRatio(size / 18.0);
        icon.addPixmap(pix);
    }
    icon.setIsMask(true);
    return icon;
}
}

App::App(const QString &ini, QObject *parent) : QObject(parent), prefs_(ini, QSettings::IniFormat) {
    launched_.start();
    loadSchema();
    createMenus();
    Desktop::observe([this](Desktop::Event event) {
        switch (event) {
        case Desktop::Event::Sleep: sleeping_ = true; break;
        case Desktop::Event::Wake: sleeping_ = false; break;
        case Desktop::Event::DisplaySleep: displayAsleep_ = true; break;
        case Desktop::Event::DisplayWake: displayAsleep_ = false; break;
        case Desktop::Event::Lock: locked_ = true; break;
        case Desktop::Event::Unlock: locked_ = false; break;
        case Desktop::Event::SpaceChanged: break;
        }
        // Occlusion settles a moment after a Space or wake transition.
        poll();
        QTimer::singleShot(600, this, &App::poll);
    });
    Desktop::onReopen([this] { reopened(); });
    connect(&poll_, &QTimer::timeout, this, &App::poll);
    poll_.start(2000);
    auto restart = [this] { QTimer::singleShot(300, this, [this] { if (wallpaperRequested_) start(); }); };
    auto watch = [this, restart](QScreen *screen) { connect(screen, &QScreen::geometryChanged, this, restart); };
    for (auto screen : QGuiApplication::screens()) watch(screen);
    connect(qApp, &QGuiApplication::screenAdded, this, [watch, restart](QScreen *screen) { watch(screen); restart(); });
    connect(qApp, &QGuiApplication::screenRemoved, this, restart);
    connect(qApp, &QGuiApplication::primaryScreenChanged, this, restart);
}

App::~App() {
    poll_.stop(); tray_.hide();
    if (preview_) delete preview_;
    if (settings_) delete settings_;
    wallpapers_.clear();
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
        // QSettings returns strings from INI files; give QML the schema's type.
        else if (spec.type == "Bool") value = value.toString() == "true" || value.toBool();
        else if (spec.type == "Double") value = value.toDouble();
        else if (spec.type == "Int") value = value.toInt();
        config_.insert(spec.key, value);
    }
    config_.insert("ObserverTimeZone", prefs_.value("ObserverTimeZone", "Africa/Cairo"));
    chooseInitialLocation();
}

void App::chooseInitialLocation() {
    // First launch: start from the preset city in this Mac's timezone, if any,
    // instead of the shared Cairo default.
    if (prefs_.contains("ObserverLatitude") || prefs_.contains("ObserverTimeZone")) return;
    const QString system = QString::fromUtf8(QTimeZone::systemTimeZoneId());
    for (const auto &city : cities) {
        if (system != QLatin1String(city.zone)) continue;
        setValue("ObserverLatitude", city.lat);
        setValue("ObserverLongitude", city.lon);
        setValue("SouthernHemisphereFlip", city.lat < 0);
        setValue("ObserverTimeZone", system);
        qInfo() << "Initial location from system timezone:" << city.name;
        return;
    }
    qInfo() << "System timezone" << system << "has no preset city; keeping Cairo until set in Settings";
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
    view->setTitle(desktop ? "Moonphase desktop wallpaper" : "Moonphase — Preview");
    view->setResizeMode(QQuickView::SizeRootObjectToView);
    view->setColor(QColor("#05070d"));
    view->rootContext()->setContextProperty("AppConfig", &config_);
    view->rootContext()->setContextProperty("Host", this);
    // Not Qt::Tool: that makes an NSPanel, which hides when the app is inactive.
    if (desktop) view->setFlags(Qt::Window | Qt::FramelessWindowHint | Qt::WindowDoesNotAcceptFocus
                                | Qt::WindowTransparentForInput);
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
    if (!preview_) preview_ = makeView(false);
    if (!preview_) return;
    preview_->show(); preview_->raise(); preview_->requestActivate();
    Desktop::activate();
}

void App::start() {
    if (changing_) { QTimer::singleShot(200, this, &App::start); return; }
    QScopedValueRollback<bool> changing(changing_, true);
    wallpaperRequested_ = true;
    wallpapers_.clear();
    for (auto screen : QGuiApplication::screens()) {
        std::unique_ptr<QQuickView> view(makeView(true));
        if (!view) continue;
        view->setScreen(screen);
        view->setGeometry(screen->geometry());
        view->show();
        QString error;
        if (!Desktop::attach(view.get(), screen, error)) { qWarning() << error; failed = true; continue; }
        wallpapers_.push_back(std::move(view));
    }
    if (wallpapers_.empty()) { if (!preview_ || !preview_->isVisible()) preview(); }
    else if (preview_) preview_->hide();
    hidden_ = false;
}

void App::stop() {
    if (changing_) { QTimer::singleShot(200, this, &App::stop); return; }
    wallpaperRequested_ = false;
    wallpapers_.clear();
    qInfo() << "Wallpaper stopped; macOS wallpaper visible again";
}

void App::setUserPaused(bool value) {
    userPaused_ = value;
    if (pauseAction_ && pauseAction_->isChecked() != value) pauseAction_->setChecked(value);
    poll();
}

void App::poll() {
    if (wallpaperRequested_ && !wallpapers_.empty()) {
        bool anyVisible = false;
        for (auto &view : wallpapers_) anyVisible = anyVisible || Desktop::isVisible(view.get());
        hidden_ = !anyVisible;
    }
    bool pause = userPaused_ || locked_ || sleeping_ || displayAsleep_ ||
        (prefs_.value("PauseLowPower", true).toBool() && Desktop::lowPowerMode()) ||
        (wallpaperRequested_ && prefs_.value("PauseHidden", true).toBool() && hidden_);
    if (pause != paused_) {
        paused_ = pause; qInfo() << "Rendering paused:" << pause; emit pausedChanged();
    }
    if (!wallpaperRequested_ || changing_ || sleeping_ || displayAsleep_) return;
    bool recover = wallpapers_.size() != size_t(QGuiApplication::screens().size());
    for (auto &view : wallpapers_) recover = recover || !Desktop::isAttached(view.get());
    if (recover) {
        qInfo() << "Recovering missing or moved wallpaper windows";
        QTimer::singleShot(0, this, [this] { if (wallpaperRequested_) start(); });
    }
}

void App::reopened() {
    // The Dock icon was clicked. Ignore the launch itself.
    if (launched_.elapsed() < 1500) return;
    bool windowOpen = (settings_ && settings_->isVisible()) || (preview_ && preview_->isVisible());
    if (!windowOpen) settings();
}

void App::populate(QMenu *menu) {
    menu->addAction("Start Wallpaper", this, &App::start);
    menu->addAction("Stop Wallpaper", this, &App::stop);
    menu->addAction(pauseAction_);
    menu->addSeparator();
    menu->addAction("Preview Window", this, &App::preview);
    menu->addAction("Settings…", this, &App::settings);
    menu->addSeparator();
    menu->addAction(loginAction_);
}

void App::createMenus() {
    pauseAction_ = new QAction("Pause Animation", this);
    pauseAction_->setCheckable(true);
    connect(pauseAction_, &QAction::toggled, this, [this](bool value) { if (value != userPaused_) setUserPaused(value); });
    loginAction_ = new QAction("Open at Login", this);
    loginAction_->setCheckable(true);
    loginAction_->setChecked(Desktop::loginItemEnabled());
    connect(loginAction_, &QAction::triggered, this, [this](bool enabled) {
        QString error;
        if (!Desktop::setLoginItem(enabled, error)) {
            QMessageBox::warning(nullptr, "Moonphase", "Could not change Open at Login.\n" + error);
        }
        QSignalBlocker block(loginAction_);
        loginAction_->setChecked(Desktop::loginItemEnabled());
    });

    trayMenu_ = std::make_unique<QMenu>();
    populate(trayMenu_.get());
    auto hidden = trayMenu_->addAction("Pause When Desktop Is Covered"); hidden->setCheckable(true);
    hidden->setChecked(prefs_.value("PauseHidden", true).toBool());
    connect(hidden, &QAction::toggled, this, [this](bool value) { prefs_.setValue("PauseHidden", value); poll(); });
    auto power = trayMenu_->addAction("Pause in Low Power Mode"); power->setCheckable(true);
    power->setChecked(prefs_.value("PauseLowPower", true).toBool());
    connect(power, &QAction::toggled, this, [this](bool value) { prefs_.setValue("PauseLowPower", value); poll(); });
    trayMenu_->addSeparator();
    trayMenu_->addAction("Quit Moonphase", qApp, &QApplication::quit);
    // Refresh the login item state; it can change in System Settings.
    connect(trayMenu_.get(), &QMenu::aboutToShow, this, [this] {
        QSignalBlocker block(loginAction_); loginAction_->setChecked(Desktop::loginItemEnabled());
    });
    tray_.setIcon(menuBarIcon()); tray_.setToolTip("Moonphase");
    tray_.setContextMenu(trayMenu_.get());
    tray_.show();

    dockMenu_ = std::make_unique<QMenu>();
    populate(dockMenu_.get());
    dockMenu_->setAsDockMenu();
}

void App::settings() {
    Desktop::activate();
    if (settings_) { settings_->show(); settings_->raise(); settings_->activateWindow(); return; }
    auto dialog = new QDialog;
    settings_ = dialog; dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setWindowTitle("Moonphase Settings"); dialog->resize(640, 760);
    auto layout = new QVBoxLayout(dialog);
    auto intro = new QLabel("Changes apply right away. Start, stop and pause from the menu bar or the Dock.\n"
                            "Set the observer’s timezone for accurate local prayer times and daylight saving.", dialog);
    intro->setWordWrap(true); layout->addWidget(intro);
    auto scroll = new QScrollArea; scroll->setWidgetResizable(true);
    auto page = new QWidget; auto form = new QFormLayout(page);
    form->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
    auto cityBox = new QComboBox;
    for (const auto &city : cities) cityBox->addItem(QString::fromUtf8(city.name));
    form->addRow("City preset", cityBox);
    auto zones = new QComboBox;
    zones->addItem("Automatic (system/longitude estimate)", "");
    for (const auto &id : QTimeZone::availableTimeZoneIds()) zones->addItem(QString::fromUtf8(id), QString::fromUtf8(id));
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
    connect(cityBox, &QComboBox::currentIndexChanged, dialog, [zones, controls](int index) {
        if (index <= 0) return;
        const auto &city = cities[index];
        static_cast<QDoubleSpinBox *>(controls.value("ObserverLatitude"))->setValue(city.lat);
        static_cast<QDoubleSpinBox *>(controls.value("ObserverLongitude"))->setValue(city.lon);
        static_cast<QCheckBox *>(controls.value("SouthernHemisphereFlip"))->setChecked(city.lat < 0);
        zones->setCurrentIndex(qMax(0, zones->findData(QString::fromLatin1(city.zone))));
    });
    scroll->setWidget(page); layout->addWidget(scroll);
    auto buttons = new QDialogButtonBox(QDialogButtonBox::Close);
    auto live = buttons->addButton("Return to Live Time", QDialogButtonBox::ActionRole);
    connect(live, &QPushButton::clicked, dialog, [controls] {
        static_cast<QCheckBox *>(controls.value("DebugTimeOverrideEnabled"))->setChecked(false);
    });
    connect(buttons, &QDialogButtonBox::rejected, dialog, &QDialog::close);
    layout->addWidget(buttons); dialog->show(); dialog->raise();
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
        const QRect g = view->geometry();
        windows.append(QJsonObject{{"screen", view->screen()->name()}, {"attached", Desktop::isAttached(view.get())},
            {"visible", Desktop::isVisible(view.get())},
            {"x", g.x()}, {"y", g.y()}, {"width", g.width()}, {"height", g.height()}});
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
        {"qt",qVersion()}, {"failed",failed}, {"paused",paused_}, {"hidden",hidden_},
        {"wallpaperRequested",wallpaperRequested_}, {"windows",windows}, {"scene",scene}};
    QFile output(file);
    if (output.open(QIODevice::WriteOnly)) output.write(QJsonDocument(report).toJson());
    else { qCritical() << "Cannot write report" << file; failed = true; }
}
