const Main = imports.ui.main;

function PanelFilter() {
	this._init();
}
PanelFilter.prototype = {
	_init: function() {
		this.panels = [];
		this.filter = [true, true, true, true];
		// for..of doesn't work here because panel[0] is undefined
		Main.getPanels().forEach(panel => this.panels.push(panel));
	},
	for_each_panel: function(callback, monitor) {
		for(let i = 0; i < this.panels.length; i++) {
			let panel = this.panels[i];
			if(panel.monitorIndex === monitor || monitor < 0) callback(panel, monitor);
		}
	},
	add: function(loc) {
		if(this.filter[loc]) return;
		Main.getPanels().forEach(panel => {
			if(panel.panelPosition === loc) this.panels.push(panel);
		});
		this.filter[loc] = true;
	},
	remove: function(loc) {
		if(!this.filter[loc]) return;
		for(let i = this.panels.length - 1; i >= 0; i--)
			if(this.panels[i].panelPosition === loc) this.panels.splice(i, 1);
		this.filter[loc] = false;
	}
};
