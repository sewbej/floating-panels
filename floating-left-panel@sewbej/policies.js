const Meta = imports.gi.Meta;
const SignalManager = imports.misc.signalManager;
const config = imports.misc.config;

const META_WINDOW_MAXIMIZED = (Meta.MaximizeFlags.VERTICAL | Meta.MaximizeFlags.HORIZONTAL);

function PolicyBase(controller) {
    this._init(controller);
}

PolicyBase.prototype = {
    _init: function(controller) {
        this.controller = controller;
    },
    enable: function() {},
    disable: function() {},
    is_transparent: function(panel) {
        return true;
    }
};

function MaximizedPolicy(controller) {
    this._init(controller);
}

MaximizedPolicy.prototype = {
    __proto__: PolicyBase.prototype,

    _init: function(controller) {
        PolicyBase.prototype._init.call(this, controller);
        this._signals = new SignalManager.SignalManager(null);

        this._settings = null;

        let n_monitors = global.screen.get_n_monitors();
        this.transparent = new Array(n_monitors);
        while (n_monitors--) this.transparent[n_monitors] = true;
    },

    enable: function() {
        this._signals.connect(global.window_manager, "size-change", this._on_window_size_changed, this);
        this._signals.connect(global.window_manager, "unminimize", this._on_window_appeared, this);
        this._signals.connect(global.window_manager, "map", this._on_window_appeared, this);
        this._signals.connect(global.window_manager, "minimize", this._on_window_disappeared, this);
        this._signals.connect(global.screen, "window-removed", this.lookup_all_monitors, this);
        this._signals.connect(global.window_manager, "switch-workspace", this.lookup_all_monitors, this);
        this._set_up_startup_signals();
    },

    disable: function() {
        this._signals.disconnectAllSignals();
        this._signals = null;
        if(this._startup_signals) {
            this._startup_signals.disconnectAllSignals();
            this._startup_signals = null;
        }
        this.controller = null;
    },

    is_transparent: function(panel) {
        return this.transparent[panel.monitorIndex];
    },

    _set_up_startup_signals: function() {
        let windows = global.display.list_windows(0);
        if(windows.length == 0) {
            this._startup_signals = new SignalManager.SignalManager(null);
            this._startup_signals.connect(global.display, "window-created", this._on_window_added_startup, this);
            this._startup_signals.connect(global.display, "notify::focus-window", this._disconnect_startup_signals, this);
        } else {
            for(let i = 0; i < windows.length; i++) this._on_window_added_startup(global.display, windows[i]);
        }
        this.controller.on_state_change(-1);
    },

    _disconnect_startup_signals: function() {
        this._startup_signals.disconnectAllSignals();
        this._startup_signals = null;
    },

    _on_window_added_startup: function(display, win) {
        if(win.get_window_type() === Meta.WindowType.DESKTOP) {
            this._signals.connect(win, "focus", this._on_desktop_focused, this);
        } else if(this._is_window_maximized(win)) {
            let monitor = win.get_monitor();
            if(this.transparent[monitor]) {
                this.transparent[monitor] = false;
                this.controller.on_state_change(monitor);
            }
        }
    },

_is_window_maximized: function(win) {
    if (!this._settings && this.controller && this.controller.settings)
        this._settings = this.controller.settings;

    if (!this._settings)
        return false;

    if (win.minimized || win.get_window_type() === Meta.WindowType.DESKTOP)
        return false;

    let useWindows = this._settings.getValue("window-maximized");

    if (!useWindows)
        return false;

    let maximized = win.get_maximized() !== 0;

    let tiled = false;
    if (typeof win.get_tiled_edges === 'function') {
        try {
            tiled = win.get_tiled_edges() !== 0;
        } catch(e) {
            tiled = false;
        }
    }

    return maximized || tiled;
},


    _on_window_appeared: function(wm, win) {
        let metawin = win.get_meta_window();
        let monitor = metawin.get_monitor();
        if(this._is_window_maximized(metawin) && this.transparent[monitor]) {
            this.transparent[monitor] = false;
            this.controller.on_state_change(monitor);
        }
    },

    _on_window_disappeared: function(wm, win) {
        if(win.get_meta_window) win = win.get_meta_window();
        this.lookup_windows_state(win.get_monitor());
    },

    _on_window_size_changed: function(wm, win, change) {
        if(change === Meta.SizeChange.MAXIMIZE || change === Meta.SizeChange.TILE) {
            this._on_window_appeared(wm, win);
        } else if(change === Meta.SizeChange.UNMAXIMIZE) {
            this._on_window_disappeared(wm, win);
        }
    },

    _on_desktop_focused: function(desktop) {
        if(desktop.get_window_type() !== Meta.WindowType.DESKTOP) return;
        let monitor = desktop.get_monitor();
        this.transparent[monitor] = true;
        this.controller.on_state_change(monitor);

        const focus_lost = (display) => {
            let focused = display.get_focus_window();
            if(!focused || desktop === focused || focused.get_monitor() !== monitor) return;
            this._signals.disconnect("notify::focus-window", display, focus_lost);
            this.lookup_all_monitors();
        };
        this._signals.connect(global.display, "notify::focus-window", focus_lost);
    },

    _any_maximized_window: function(monitor) {
        let workspace = global.screen.get_active_workspace();
        let windows = workspace.list_windows();
        for(let i = 0; i < windows.length; i++) {
            let win = windows[i];
            if(this._is_window_maximized(win) && win.get_monitor() == monitor) return true;
        }
        return false;
    },

    lookup_windows_state: function(monitor) {
        let maximized = this._any_maximized_window(monitor);
        if(maximized === this.transparent[monitor]) {
            this.transparent[monitor] = !maximized;
            this.controller.on_state_change(monitor);
        }
    },

    lookup_all_monitors: function() {
        let monitors = global.screen.get_n_monitors();
        for(let i = 0; i < monitors; i++) this.lookup_windows_state(i);
    }
};

