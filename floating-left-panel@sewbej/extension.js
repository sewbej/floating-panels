const UUID = "floating-left-panel@sewbej";

const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Panel = imports.ui.panel;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const SignalManager = imports.misc.signalManager;

// ==== Load modules ====
let Filter, Policies, PanelSize;
if (typeof require !== "undefined") {
    Filter = require("./filter");
    Policies = require("./policies");
    PanelSize = require("./panel-size");
} else {
    const Self = imports.ui.extensionSystem.extensions[UUID];
    Filter = Self.filter;
    Policies = Self.policies;
    PanelSize = Self["panel-size"];
}

// ==== Translation ====
function _(str) {
    let custom = Gettext.dgettext(UUID, str);
    return custom !== str ? custom : Gettext.gettext(str);
}

// ======================================================
//                    Main Extension Class
// ======================================================

function MyExtension(meta) {
    this._init(meta);
}

MyExtension.prototype = {

    // --------------------------------------------------
    // Init
    // --------------------------------------------------
    _init: function (meta) {
        this.meta = meta;
        this._signals = new SignalManager.SignalManager(null);

        // status transparency per panel
        this._panel_status = Array(Main.panelManager.panelCount).fill(false);

        // core objects
        this._filter = new Filter.PanelFilter();
        this.policy = new Policies.MaximizedPolicy(this);
        this.settings = new Settings.ExtensionSettings(this, meta.uuid);

        // settings bindings
        this.settings.bind("panel-style", "panel_style", this.on_settings_changed);
        this.settings.bind("transparency-level", "transparency_level", this.on_settings_changed);
        this.settings.bind("panel-theme", "panel_theme", this.on_settings_changed);
        this.settings.bind("rounded-corners", "rounded_corners", this.on_settings_changed);

        this.settings.bind("window-maximized", "enablePanelSize",
            this.on_window_maximized_changed.bind(this)
        );

        this.settings.bind("panel-height", "panel_height",
            this.on_panel_height_changed.bind(this)
        );

        // monitor changes
        this._signals.connect(Main.layoutManager, "monitors-changed",
            this.on_monitors_changed, this
        );

        // build CSS class name
        this._classname = this.panel_style + this.transparency_level +
                          this.panel_theme + this.rounded_corners;

        Gettext.bindtextdomain(meta.uuid,
            GLib.get_home_dir() + "/.local/share/locale"
        );

        // panel size backend
        PanelSize.init(this.settings);
    },

    // --------------------------------------------------
    // Enable / Disable
    // --------------------------------------------------
    enable: function () {
        this._update_filter();
        this.policy.enable();

        if (PanelSize && PanelSize.setPanelHeight)
            PanelSize.setPanelHeight(this.panel_height);

        if (this.enablePanelSize && PanelSize.enable)
            PanelSize.enable();

        if (this.settings.getValue("first-launch")) {
            this.settings.setValue("first-launch", false);
            this._show_startup_notification();
        }
    },

    disable: function () {
        this.policy.disable();
        PanelSize.disable();

        if (this.settings) {
            this.settings.finalize();
            this.settings = null;
        }

        this._signals.disconnectAllSignals();
        this._signals = null;

        Main.getPanels().forEach(p => this.make_transparent(p, false));
    },

    // --------------------------------------------------
    // Transparency Logic
    // --------------------------------------------------
    on_state_change: function (monitor) {
        this._filter.for_each_panel(panel => {
            this.make_transparent(panel, this.policy.is_transparent(panel));
        }, monitor);
    },

    make_transparent: function (panel, transparent) {
        let id = panel.panelId - 1;
        if (transparent === this._panel_status[id])
            return;

        if (transparent) {
            if (this.opacify) this._set_background_opacity(panel, 0);
            panel.actor.add_style_class_name(this._classname);
        } else {
            if (this.opacify) this._set_background_opacity(panel, 255);
            panel.actor.remove_style_class_name(this._classname);
        }

        this._panel_status[id] = transparent;
    },

    _update_filter: function () {
        this._filter.remove(Panel.PanelLoc.top);
        this._filter.remove(Panel.PanelLoc.right);
        this._filter.remove(Panel.PanelLoc.bottom);
        this._filter.add(Panel.PanelLoc.left);
    },

    // --------------------------------------------------
    // Settings change callbacks
    // --------------------------------------------------

    // UI appearance settings
    on_settings_changed: function () {
        Main.getPanels().forEach(p => this.make_transparent(p, false));

        this._classname = this.panel_style +
                          this.transparency_level +
                          this.panel_theme +
                          this.rounded_corners;

        this._update_filter();
        this.on_state_change(-1);
    },

    // Slider changed → reload extension
    on_panel_height_changed: function () {
        global.log(`floating-left-panel: panel-height = ${this.panel_height}`);

        Util.spawnCommandLine(
            `cinnamon-dbus-command ReloadXlet ${this.meta.uuid} EXTENSION`
        );
    },

    // Switch changed → reload extension
    on_window_maximized_changed: function () {
        global.log(`floating-left-panel: window-maximized = ${this.enablePanelSize}`);

        Util.spawnCommandLine(
            `cinnamon-dbus-command ReloadXlet ${this.meta.uuid} EXTENSION`
        );
    },

    // --------------------------------------------------
    // Monitor changes
    // --------------------------------------------------
    on_monitors_changed: function () {
        Main.getPanels().forEach(p => this.make_transparent(p, false));

        this._panel_status = Array(Main.panelManager.panelCount).fill(false);

        this.policy.disable();
        this.policy = new Policies.MaximizedPolicy(this);
        this.policy.enable();

        this.on_state_change(-1);
    },

    // --------------------------------------------------
    // Notification
    // --------------------------------------------------
    _show_startup_notification: function () {
        let source = new MessageTray.Source(this.meta.name);

        let notification = new MessageTray.Notification(
            source,
            _("%s enabled").format(_(this.meta.name)),
            _("Open the extension settings and customize your panels"),
            {
                icon: new St.Icon({
                    icon_name: "floating-panels",
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: source.ICON_SIZE
                })
            }
        );

        notification.addButton("open-settings", _("Open settings"));
        notification.connect("action-invoked",
            () => this.launch_settngs()
        );

        Main.messageTray.add(source);
        source.notify(notification);
    },

    launch_settngs: function () {
        Util.spawnCommandLine("xlet-settings extension " + this.meta.uuid);
    }

};

// ======================================================
//                         System Hooks
// ======================================================

let extension = null;

function init(metadata) {
    extension = new MyExtension(metadata);
}

function enable() {
    try { extension.enable(); }
    catch (e) {
        extension.disable();
        throw e;
    }
}

function disable() {
    try { extension.disable(); }
    catch (e) { global.logError(e); }
    finally { extension = null; }
}

