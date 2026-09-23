const Gio           = imports.gi.Gio;
const Main          = imports.ui.main;
const Meta          = imports.gi.Meta;
const Panel         = imports.ui.panel;
const SignalManager = imports.misc.signalManager;

/* -------------------------------------------------------
   CONFIGURATION (Left PANEL)
------------------------------------------------------- */

const TARGET_POS         = Panel.PanelLoc.left;  // this module only affects Left panels
const DEFAULT_PANEL_SIZE = 48;                    // fallback height
const MIN_SIZE           = 12;                    // minimal panel height

// slider (0–100) passed from extension.js via setPanelHeight()
let panelHeightPercent = 7;

// GSettings and runtime state
let settings          = null;
let extSettings       = null;  // Ustawienia Twojego rozszerzenia
let originalHeightsMap = {};   // panelId -> original "100%" height (Left panels only)
let panelMonitorMap    = {};   // panelId -> monitor index

// maximized / tiled tracking per monitor
let maximizedMonitors       = new Set();   // monitors that currently have at least one max/tiled window
let maximizedCountByMonitor = {};         // monitor index -> count of max/tiled windows

// signal manager
let _signals = null;

/* -------------------------------------------------------
   PUBLIC API
------------------------------------------------------- */

function init(settingsObject) {
    settings = new Gio.Settings({ schema: "org.cinnamon" });
    
    // Jeśli przekazano instancję ustawień z extension.js, przypisujemy ją
    if (settingsObject) {
        extSettings = settingsObject;
    }
}

function setPanelHeight(value) {
    if (typeof value === "number" && isFinite(value) && value >= 0)
        panelHeightPercent = value;
    else
        panelHeightPercent = 0;
}

function enable() {
    if (_signals) {
        _signals.disconnectAllSignals();
    }
    _signals = new SignalManager.SignalManager(null);

    // read original Left panel heights and assign them to monitors
    readOriginalHeights();
    assignPanelsToMonitors();

    // hook global window manager / screen signals
    hookGlobalSignals();

    // hook all existing windows
    hookExistingWindows();

    // rebuild monitor state and apply heights
    rebuildMaximizedState();
    updatePanelHeights();
}

function disable() {
    if (_signals) {
        _signals.disconnectAllSignals();
        _signals = null;
    }

    // restore original heights of Left panels
    restoreOriginalHeights();

    originalHeightsMap       = {};
    panelMonitorMap          = {};
    maximizedMonitors        = new Set();
    maximizedCountByMonitor  = {};
}

/* -------------------------------------------------------
   GLOBAL SIGNALS / WINDOWS HOOKS
------------------------------------------------------- */

function hookGlobalSignals() {
    // window size changes (MAX / UNMAX / TILE)
    _signals.connect(global.window_manager, "size-change", onSizeChange);

    // generic events that may affect window visibility / workspace layout
    _signals.connect(global.window_manager, "map", (wm, actor) => {
        if (actor && actor.metaWindow) {
            hookWindow(actor.metaWindow);
            updateWindowTracking(actor.metaWindow);
        }
        updatePanelHeights();
    });

    _signals.connect(global.window_manager, "minimize", (wm, actor) => {
        if (actor && actor.metaWindow) {
            updateWindowTracking(actor.metaWindow);
        }
        updatePanelHeights();
    });

    _signals.connect(global.window_manager, "unminimize", (wm, actor) => {
        if (actor && actor.metaWindow) {
            updateWindowTracking(actor.metaWindow);
        }
        updatePanelHeights();
    });

    _signals.connect(global.window_manager, "switch-workspace", () => {
        rebuildMaximizedState();
        updatePanelHeights();
    });

    _signals.connect(global.screen, "window-removed", () => {
        rebuildMaximizedState();
        updatePanelHeights();
    });

    // new windows
    _signals.connect(global.display, "window-created", onWindowCreated);

    // panel configuration in Cinnamon changed
    _signals.connect(settings, "changed::panels-enabled", () => {
        assignPanelsToMonitors();
        updatePanelHeights();
    });
}

function hookExistingWindows() {
    try {
        global.get_window_actors().forEach(actor => {
            if (actor && actor.metaWindow) {
                hookWindow(actor.metaWindow);
                updateWindowTracking(actor.metaWindow);
            }
        });
    } catch (e) {
        // ignore
    }
}

function onWindowCreated(display, win) {
    if (!win) return;
    hookWindow(win);
    updateWindowTracking(win);
    updatePanelHeights();
}

/* -------------------------------------------------------
   WINDOW-SPECIFIC SIGNALS & TRACKING
------------------------------------------------------- */

function onSizeChange(wm, actor, change) {
    if (!actor || !actor.metaWindow) {
        rebuildMaximizedState();
        updatePanelHeights();
        return;
    }

    const win = actor.metaWindow;

    if (change === Meta.SizeChange.TILE) {
        updateWindowTracking(win);
        updatePanelHeights();

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            updateWindowTracking(win);
            updatePanelHeights();
            return false;
        });
        return;
    }

    if (change === Meta.SizeChange.MAXIMIZE ||
        change === Meta.SizeChange.UNMAXIMIZE) {
        updateWindowTracking(win);
        updatePanelHeights();
        return;
    }

    updateWindowTracking(win);
    updatePanelHeights();
}

function hookWindow(win) {
    try {
        if (!win || win._fbpTrackedLeft) return;
        win._fbpTrackedLeft = true;

        _signals.connect(win, "notify::maximized-horizontally", () => {
            updateWindowTracking(win);
            updatePanelHeights();
        });

        _signals.connect(win, "notify::maximized-vertically", () => {
            updateWindowTracking(win);
            updatePanelHeights();
        });

        _signals.connect(win, "notify::tile-type", () => {
            updateWindowTracking(win);
            updatePanelHeights();
        });

        _signals.connect(win, "notify::minimized", () => {
            updateWindowTracking(win);
            updatePanelHeights();
        });

        _signals.connect(win, "workspace-changed", () => {
            updateWindowTracking(win);
            updatePanelHeights();
        });

        _signals.connect(win, "unmanaged", () => {
            clearWindowTracking(win);
            updatePanelHeights();
        });

        updateWindowTracking(win);

    } catch (e) {
        // ignore
    }
}

/* -------------------------------------------------------
   MAXIMIZED / TILED STATE TRACKING
------------------------------------------------------- */

function isWindowMaximizedOrTiled(win) {
    try {
        if (!win || win.minimized) return false;
        if (win.get_window_type &&
            win.get_window_type() === Meta.WindowType.DESKTOP)
            return false;

        let max = false;
        if (typeof win.get_maximized === "function") {
            max = win.get_maximized() !== 0;
        } else {
            max = !!(win.maximized_horizontally || win.maximized_vertically);
        }

        let tiled = false;
        if (typeof win.get_tiled_edges === "function") {
            try {
                tiled = win.get_tiled_edges() !== 0;
            } catch (e) {
                tiled = false;
            }
        } else if (typeof win.tile_type !== "undefined" &&
                   win.tile_type !== Meta.TileType.NONE) {
            tiled = true;
        }

        return max || tiled;
    } catch (e) {
        return false;
    }
}

function getWindowMonitor(win) {
    try {
        if (typeof win.get_monitor === "function") {
            const mon = win.get_monitor();
            if (mon >= 0) return mon;
        }
    } catch (e) {}

    let frame = null;
    try {
        frame = win.get_frame_rect ? win.get_frame_rect() : null;
    } catch (e) {}

    if (!frame) {
        try {
            frame = {
                x: win.get_x(),
                y: win.get_y(),
                width: win.get_width(),
                height: win.get_height()
            };
        } catch (e) {
            return -1;
        }
    }

    const monitors = getMonitors();
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;

    for (let i = 0; i < monitors.length; i++) {
        const m = monitors[i];
        if (cx >= m.x && cx < m.x + m.width &&
            cy >= m.y && cy < m.y + m.height)
            return i;
    }

    return -1;
}

function incMonitor(mon) {
    if (mon < 0) return;
    maximizedCountByMonitor[mon] = (maximizedCountByMonitor[mon] || 0) + 1;
    if (maximizedCountByMonitor[mon] > 0)
        maximizedMonitors.add(mon);
}

function decMonitor(mon) {
    if (mon < 0) return;
    if (!maximizedCountByMonitor.hasOwnProperty(mon)) return;

    maximizedCountByMonitor[mon] = Math.max(0, maximizedCountByMonitor[mon] - 1);
    if (maximizedCountByMonitor[mon] === 0) {
        delete maximizedCountByMonitor[mon];
        maximizedMonitors.delete(mon);
    }
}

function updateWindowTracking(win) {
    try {
        if (!win) return;

        const prev = win._fbpInfoLeft || { monitor: -1, isMax: false };
        const nowIsMax = isWindowMaximizedOrTiled(win);
        const nowMon   = getWindowMonitor(win);

        if (prev.monitor === nowMon && prev.isMax === nowIsMax)
            return;

        if (prev.isMax && prev.monitor >= 0)
            decMonitor(prev.monitor);

        if (nowIsMax && nowMon >= 0)
            incMonitor(nowMon);

        win._fbpInfoLeft = { monitor: nowMon, isMax: nowIsMax };

    } catch (e) {
        // ignore
    }
}

function clearWindowTracking(win) {
    try {
        if (!win || !win._fbpInfoLeft) return;

        const info = win._fbpInfoLeft;
        if (info.isMax && info.monitor >= 0)
            decMonitor(info.monitor);

        delete win._fbpInfoLeft;
    } catch (e) {
        // ignore
    }
}

function rebuildMaximizedState() {
    maximizedCountByMonitor = {};
    maximizedMonitors       = new Set();

    try {
        const ws = global.screen.get_active_workspace();
        if (!ws) return;

        ws.list_windows().forEach(win => {
            if (!win) return;
            const isMax = isWindowMaximizedOrTiled(win);
            const mon   = getWindowMonitor(win);

            win._fbpInfoLeft = { monitor: mon, isMax };

            if (isMax && mon >= 0)
                incMonitor(mon);
        });
    } catch (e) {
        // ignore
    }
}

/* -------------------------------------------------------
   PANELS / MONITORS / ORIGINAL HEIGHTS
------------------------------------------------------- */

function getMonitors() {
    const count = global.display.get_n_monitors();
    const result = [];

    for (let i = 0; i < count; i++) {
        const g = global.display.get_monitor_geometry(i);
        result.push({ x: g.x, y: g.y, width: g.width, height: g.height });
    }
    return result;
}

function getAllPanels() {
    try {
        if (Main.panelManager && typeof Main.panelManager.getPanels === "function") {
            const p = Main.panelManager.getPanels();
            return Array.isArray(p) ? p : Object.values(p || {});
        } else if (Main.panelManager && Main.panelManager.panels) {
            return Object.values(Main.panelManager.panels || {});
        }
    } catch (e) {}

    return [];
}

function assignPanelsToMonitors() {
    panelMonitorMap = {};

    const monitors = getMonitors();
    const panels   = getAllPanels();

    panels.forEach(p => {
        try {
            if (!p || p.panelPosition !== TARGET_POS) return;

            const id  = String(p.panelId);
            const box = p.actor.get_allocation_box();

            const rect = {
                x: box.x1,
                y: box.y1,
                width: box.x2 - box.x1,
                height: box.y2 - box.y1
            };

            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;

            let mon = -1;
            for (let i = 0; i < monitors.length; i++) {
                const m = monitors[i];
                if (cx >= m.x && cx < m.x + m.width &&
                    cy >= m.y && cy < m.y + m.height) {
                    mon = i;
                    break;
                }
            }
            if (mon < 0 && monitors.length > 0)
                mon = 0;

            panelMonitorMap[id] = mon;
        } catch (e) {
        }
    });
}

function readOriginalHeights() {
    if (Object.keys(originalHeightsMap).length > 0) return;

    let arr = [];
    try {
        arr = settings.get_strv("panels-height") || [];
    } catch (e) {
        arr = [];
    }

    const storedMap = {};
    arr.forEach(entry => {
        const parts = entry.split(":");
        if (parts.length !== 2) return;
        const id = parts[0];
        const v  = parseInt(parts[1], 10);
        if (!isNaN(v))
            storedMap[id] = v;
    });

    const panels = getAllPanels();
    panels.forEach(p => {
        try {
            if (!p || p.panelPosition !== TARGET_POS) return;

            const id   = String(p.panelId);
            const orig = storedMap.hasOwnProperty(id)
                ? storedMap[id]
                : Math.round(p.actor.height || DEFAULT_PANEL_SIZE);

            originalHeightsMap[id] = orig;
        } catch (e) {
            // ignore
        }
    });
}

function restoreOriginalHeights() {
    let arr = [];
    try {
        arr = settings.get_strv("panels-height") || [];
    } catch (e) {
        arr = [];
    }

    const map   = {};
    const order = [];

    arr.forEach(entry => {
        const parts = entry.split(":");
        if (parts.length !== 2) return;
        const id = parts[0];
        const v  = parseInt(parts[1], 10);
        map[id]  = isNaN(v) ? 0 : v;
        order.push(id);
    });

    const panels = getAllPanels();
    panels.forEach(p => {
        if (!p) return;
        const id = String(p.panelId);
        if (!map.hasOwnProperty(id)) {
            map[id] = Math.round(p.actor.height || DEFAULT_PANEL_SIZE);
            order.push(id);
        }
    });

    for (let id in originalHeightsMap) {
        if (!originalHeightsMap.hasOwnProperty(id))
            continue;
        map[id] = originalHeightsMap[id];
        if (order.indexOf(id) === -1)
            order.push(id);
    }

    const result = order.map(id => `${id}:${map[id]}`);
    settings.set_strv("panels-height", result);
}

/* -------------------------------------------------------
   PANEL HEIGHT CALCULATION
------------------------------------------------------- */

function getGapValue() {
    let gap = 8;

    if (extSettings) {
        try {
            if (typeof extSettings.get_int === "function") {
                gap = extSettings.get_int("gap-size");
            } else {
                let v = extSettings.getValue("gap-size");
                if (v) gap = typeof v.get_int32 === "function" ? v.get_int32() : parseInt(v, 10);
            }
            if (!isNaN(gap)) return gap;
        } catch (e) {}
    }

    if (typeof global.gapSize === "number" && !isNaN(global.gapSize)) {
        return global.gapSize;
    }

    return 8;
}

function updatePanelHeights() {
    if (!originalHeightsMap || !Object.keys(originalHeightsMap).length)
        return;

    assignPanelsToMonitors();

    let arr = [];
    try {
        arr = settings.get_strv("panels-height") || [];
    } catch (e) {
        arr = [];
    }

    const map   = {};
    const order = [];

    // current GSettings (all panels)
    arr.forEach(entry => {
        const parts = entry.split(":");
        if (parts.length !== 2) return;
        const id = parts[0];
        const v  = parseInt(parts[1], 10);
        map[id]  = isNaN(v) ? 0 : v;
        order.push(id);
    });

    // ensure all panels exist
    const panels = getAllPanels();
    panels.forEach(p => {
        if (!p) return;
        const id = String(p.panelId);
        if (!map.hasOwnProperty(id)) {
            map[id] = Math.round(p.actor.height || DEFAULT_PANEL_SIZE);
            order.push(id);
        }
    });

    const gap = getGapValue();

    // adjust only Left panels we manage
    for (let id in originalHeightsMap) {
        if (!originalHeightsMap.hasOwnProperty(id)) continue;

        const mon = panelMonitorMap[id];
        let target;

        if (mon !== undefined && maximizedMonitors.has(mon)) {
            const orig = originalHeightsMap[id];

            // 0% = ~20px (after correction), 100% = orig
            const minH = 21 + gap;
            const maxH = orig;

            const t = minH + (maxH - minH) * (panelHeightPercent / 100) - (gap + 1);
            target   = Math.max(MIN_SIZE, Math.round(t));
        } else {
            target = originalHeightsMap[id];
        }

        map[id] = target;
        if (order.indexOf(id) === -1)
            order.push(id);
    }

    const finalArr = order.map(id => `${id}:${map[id]}`);
    settings.set_strv("panels-height", finalArr);
}
