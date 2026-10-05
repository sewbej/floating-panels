const UUID = "floating-right-panel@sewbej";

const Gettext = imports.gettext;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Panel = imports.ui.panel;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Util = imports.misc.util;
const SignalManager = imports.misc.signalManager;

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

function _(str) {
	let custom = Gettext.dgettext(UUID, str);
	return custom !== str ? custom : Gettext.gettext(str);
}

function MyExtension(meta) {
	this._init(meta);
}

MyExtension.prototype = {
	_init: function(meta) {
		this.meta = meta;

		this._signals = new SignalManager.SignalManager(null);
		
		this._panel_status = new Map();
		
		this._panel_original_style = new Map();
		
		this._filter = new Filter.PanelFilter();
		this.policy = new Policies.MaximizedPolicy(this);
		this.settings = new Settings.ExtensionSettings(this, meta.uuid);

		this.settings.bind(
			"panel-style",
			"panel_style",
			this.on_settings_changed.bind(this)
		);
		
		this.settings.bind(
			"background-gradient-start",
			"background_gradient_start",
			this.on_settings_changed_color.bind(this)
		);
		
		this.settings.bind(
			"background-gradient-end",
			"background_gradient_end",
			this.on_settings_changed_color.bind(this)
		);
		
		this.settings.bind(
			"border-color",
			"border_color",
			this.on_settings_changed_color.bind(this)
		);
		
		this.settings.bind(
			"opacity-level",
			"opacity_level",
			this.on_settings_changed_opacity.bind(this)
		);
		
		this.settings.bind(
			"panel-theme",
			"panel_theme",
			this.on_settings_changed.bind(this)
		);
		
		this.settings.bind(
			"panel-theme-predefined",
			"panel_theme_predefined",
			this.on_settings_changed.bind(this)
		);
		
		this.settings.bind(
			"border-radius",
			"border_radius",
			this.on_settings_changed_radius.bind(this)
		);
		
		this.settings.bind(
			"border-thickness",
			"border_thickness",
			this.on_settings_changed_thickness.bind(this)
		);
		
		this.settings.bind(
			"panel-shadow",
			"panel_shadow",
			this.on_settings_changed_shadow.bind(this)
		);
		
		this.settings.bind(
			"gap-size",
			"gapSize",
			this.on_settings_changed.bind(this)
		);
		
		this.settings.bind(
			"window-maximized",
			"enablePanelSize",
			this.on_window_maximized_changed.bind(this)
		);
		
		this.settings.bind(
			"panel-height",
			"panel_height",
			this.on_panel_height_changed.bind(this)
		);
		
		this._classname = this._build_classname();
		
		Gettext.bindtextdomain(
			meta.uuid,
			GLib.get_home_dir() + "/.local/share/locale"
		);

		PanelSize.init(this.settings);
	},
	
	_build_classname: function() {
		let isCustomTheme =
			this.panel_theme &&
			this.panel_theme.includes("-custom");
		
		if (isCustomTheme) {
			return this.panel_style + this.panel_theme + "-fully";
		} else {
			return this.panel_style + this.panel_theme_predefined + "-fully";
		}
	},
	
	// --------------------------------------------------
	// Enable / Disable / Destroy
	// --------------------------------------------------
	enable: function() {
		this._update_filter();
		
		if (this.policy)
			this.policy.enable();
		
		if (PanelSize && PanelSize.setPanelHeight)
			PanelSize.setPanelHeight(this.panel_height);
		
		if (this.enablePanelSize && PanelSize && PanelSize.enable)
			PanelSize.enable();

		if (this._signals) {
			this._signals.disconnectAllSignals();
			
			this._signals.connect(
				Main.layoutManager,
				"monitors-changed",
				this.on_monitors_changed,
				this
			);
		}
	},
	
	disable: function() {
		Main.getPanels().forEach(p => {
			this.make_transparent(p, false);
		});
		
		this._panel_status.clear();
		this._panel_original_style.clear();
		
		if (this.policy)
			this.policy.disable();
		
		if (PanelSize && PanelSize.disable)
			PanelSize.disable();
		
		if (this._signals)
			this._signals.disconnectAllSignals();
	},
	
	destroy: function() {
		this.disable();
		
		if (this.settings) {
			this.settings.finalize();
			this.settings = null;
		}
		
		if (this._signals) {
			this._signals.disconnectAllSignals();
			this._signals = null;
		}
		
		this._panel_status.clear();
		this._panel_original_style.clear();
		
		this.policy = null;
		this._filter = null;
	},
	
	// --------------------------------------------------
	// opacity Logic
	// --------------------------------------------------
	on_state_change: function(monitor) {
		this._filter.for_each_panel(panel => {
			this.make_transparent(
				panel,
				this.policy.is_transparent(panel)
			);
		}, monitor);
	},
	
	make_transparent: function(panel, transparent) {
		const id = panel.panelId;
		
		const currentStatus =
			this._panel_status.get(id) === true;
		
		const hasOriginalStyle =
			this._panel_original_style.has(id);
		
		if (!transparent && !currentStatus && !hasOriginalStyle)
			return;

		if (transparent) {
			if (!this._panel_original_style.has(id)) {
				this._panel_original_style.set(
					id,
					panel.actor.get_style()
				);
			}
			
			panel.actor.add_style_class_name(this._classname);
			
			let gap = this.gapSize;
			
			panel.actor.set_style(
				`padding: ${gap}px ${gap}px ${gap}px 0px;`
			);
			
			this._panel_status.set(id, true);
			return;
		}

		panel.actor.remove_style_class_name(this._classname);
		
		if (this._panel_original_style.has(id)) {
			const originalStyle =
				this._panel_original_style.get(id);
			
			panel.actor.set_style(
				originalStyle !== undefined ? originalStyle : null
			);
			
			this._panel_original_style.delete(id);
		} else {
			panel.actor.set_style(null);
		}
		
		this._panel_status.set(id, false);
	},
	
	_update_filter: function() {
		this._filter.remove(Panel.PanelLoc.top);
		this._filter.add(Panel.PanelLoc.right);
		this._filter.remove(Panel.PanelLoc.bottom);
		this._filter.remove(Panel.PanelLoc.left);
	},
	
	// --------------------------------------------------
	// Settings change callbacks
	// --------------------------------------------------
	on_settings_changed: function() {
		Main.getPanels().forEach(p => {
			this.make_transparent(p, false);
		});
		
		this._classname = this._build_classname();
		
		this._update_filter();
		this.on_state_change(-1);
	},
	
	on_settings_changed_color: function() {
		this.runPythonScriptColor();
	},
	
	on_settings_changed_radius: function() {
		this.runPythonScriptRadius();
	},
	
	on_settings_changed_thickness: function() {
		this.runPythonScriptThickness();
	},
	
	on_settings_changed_shadow: function() {
		this.runPythonScriptShadow();
	},
	
	on_settings_changed_opacity: function() {
		this.runPythonScriptOpacity();
	},
	
	on_panel_height_changed: function() {
		global.log(
			`floating-right-panel: panel-height = ${this.panel_height}`
		);
		
		Util.spawnCommandLine(
			`cinnamon-dbus-command ReloadXlet ${this.meta.uuid} EXTENSION`
		);
	},
	
	on_window_maximized_changed: function() {
		global.log(
			`floating-right-panel: window-maximized = ${this.enablePanelSize}`
		);
		
		Util.spawnCommandLine(
			`cinnamon-dbus-command ReloadXlet ${this.meta.uuid} EXTENSION`
		);
	},
	
	// --------------------------------------------------
	// Generic Python runner
	// --------------------------------------------------
	_runPythonScript: function(scriptName, args = []) {
		try {
			const homeDir = GLib.get_home_dir();
			
			const scriptPath =
				`${homeDir}/.local/share/cinnamon/extensions/` +
				`${UUID}/${scriptName}`;
			
			const scriptFile =
				Gio.File.new_for_path(scriptPath);
			
			if (!scriptFile.query_exists(null)) {
				Main.notifyError(
					"Floating Panels",
					`Script not found:\n${scriptPath}`
				);
				return;
			}
			
			const proc = Gio.Subprocess.new(
				[
					"/usr/bin/python3",
					scriptPath,
					...args
				],
				Gio.SubprocessFlags.STDOUT_SILENCE |
				Gio.SubprocessFlags.STDERR_SILENCE
			);
			
			proc.wait_check_async(null, (proc, res) => {
				try {
					proc.wait_check_finish(res);
				} catch (e) {
					global.logError(
						`[FLOATING PANEL] ` +
						`${scriptName}: ${e.message}`
					);
				}
			});
			
		} catch (e) {
			global.logError(
				`[FLOATING PANEL] ` +
				`Failed to run ${scriptName}: ${e.message}`
			);
		}
	},
	
	// --------------------------------------------------
	// Python scripts
	// --------------------------------------------------
	runPythonScriptColor: function() {
		const colors = [
			this.background_gradient_start ??
			"rgba(255,255,255,1.0)",
			
			this.background_gradient_end ??
			"rgba(255,255,255,1.0)",
			
			this.border_color ??
			"rgba(255,255,255,1.0)"
		];
		
		this._runPythonScript(
			"run_apply_custom_color.py",
			colors
		);
	},
	
	runPythonScriptShadow: function() {
		const args = [
			this.panel_shadow ??
			"rgba(255,255,255,1.0)"
		];
		
		this._runPythonScript(
			"run_apply_shadow_color.py",
			args
		);
	},
	
	runPythonScriptOpacity: function() {
		let val =
			this.opacity_level ?? "8);";
		
		if (
			typeof val === "number" ||
			(
				typeof val === "string" &&
				!val.endsWith(");")
			)
		) {
			val = `${val});`;
		}
		
		this._runPythonScript(
			"run_apply_opacity.py",
			[val]
		);
	},
	
	runPythonScriptRadius: function() {
		let val =
			this.border_radius ?? "8px";
		
		if (
			typeof val === "number" ||
			(
				typeof val === "string" &&
				!val.endsWith("px")
			)
		) {
			val = `${val}px`;
		}
		
		this._runPythonScript(
			"run_apply_radius.py",
			[val]
		);
	},
	
	runPythonScriptThickness: function() {
		let val =
			this.border_thickness ?? "8px";
		
		if (
			typeof val === "number" ||
			(
				typeof val === "string" &&
				!val.endsWith("px")
			)
		) {
			val = `${val}px`;
		}

		this._runPythonScript(
			"run_apply_thickness.py",
			[val]
		);
	},
	
	// --------------------------------------------------
	// Monitor changes
	// --------------------------------------------------
	on_monitors_changed: function() {
		Main.getPanels().forEach(p => {
			this.make_transparent(p, false);
		});
		
		this._panel_status.clear();
		this._panel_original_style.clear();
		
		if (this.policy) {
			this.policy.disable();
			
			this.policy =
				new Policies.MaximizedPolicy(this);
			
			this.policy.enable();
		}
		
		this.on_state_change(-1);
	},
	
	launch_settings: function() {
		Util.spawnCommandLine(
			"xlet-settings extension " + this.meta.uuid
		);
	}
};


// ======================================================
//                  System Hooks
// ======================================================

var Callbacks = {
	btn_website_pressed: function() {
		Gio.app_info_launch_default_for_uri(
			"https://www.opendesktop.org/p/2225956",
			null
		);
	},
	
	btn_issue_pressed: function() {
		Gio.app_info_launch_default_for_uri(
			"https://github.com/sewbej/floating-panels/issues",
			null
		);
	},
	
	btn_donate_pressed: function() {
		Gio.app_info_launch_default_for_uri(
			"https://ko-fi.com/sewbej", null,
			null
		);
	},
};


let extension = null;

function init(metadata) {
	extension = new MyExtension(metadata);
}

function enable() {
	if (!extension)
		return;
	
	extension.enable();
	
	let boundCallbacks = {};
	
	Object.keys(Callbacks).forEach(k => {
		boundCallbacks[k] =
			Callbacks[k].bind(extension);
	});
	
	return boundCallbacks;
}

function disable() {
	if (extension) {
		extension.disable();
	}
}
