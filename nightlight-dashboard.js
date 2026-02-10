/**
 * Nightlight Dashboard (v3.3.0 - Skylight Edition)
 * A modernize, streamlined Home Assistant card with To-do memory, 
 * User-Specific Views, and Hybrid Controller logic.
 */

import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";

class NightlightDashboard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _activeView: { type: String },
      _calendarMode: { type: String },
      _events: { type: Array },
      _loading: { type: Boolean },
      _referenceDate: { type: Object },
      _selectedEvent: { type: Object },
      _activeCalendars: { type: Array },
      _showAddModal: { type: Boolean },
      _menuOpen: { type: Boolean },
      _todoItems: { type: Array },
      _weatherEntity: { type: String },
      _themeMode: { type: String }
    };
  }

  static getConfigElement() {
    return document.createElement("nightlight-dashboard-editor");
  }

  static getStubConfig() {
    return {
      title: "Family Hub",
      theme: "light",
      entities: [],
      periods: [
        { name: "Morning", start: "06:00", end: "09:00" },
        { name: "Afternoon", start: "09:01", end: "17:00" },
        { name: "Evening", start: "17:01", end: "21:00" }
      ],
      chores: []
    };
  }

  constructor() {
    super();
    this._activeView = 'calendar';
    this._calendarMode = 'month';
    this._referenceDate = new Date();
    this._events = [];
    this._activeCalendars = [];
    this._loading = false;
    this._selectedEvent = null;
    this._showAddModal = false;
    this._menuOpen = false;
    this._lastResetDate = localStorage.getItem('nightlight_reset_date');
    this._themeMode = 'light'; // Default
  }

  setConfig(config) {
    if (!config.entities && !config.chores) {
      throw new Error("Define entities or chores in YAML.");
    }
    this.config = {
      title: "Family Hub",
      theme: "light",
      logo_url: '/',
      ...config
    };
    // Initialize active calendars if not set
    if (this._activeCalendars.length === 0 && config.entities) {
      this._activeCalendars = config.entities.map(e => e.entity);
    }
    if (config.theme) {
      this._themeMode = config.theme;
    }
  }

  updated(changedProps) {
    // 1. Unified Hybrid Mode Handling
    if (changedProps.has('_activeView')) {
      const coreIds = ['calendar', 'meals', 'whiteboard', 'chores'];

      // Handle View Controller Input Select
      if (this.config.view_controller && this.hass) {
        const option = coreIds.includes(this._activeView) ? "Nightlight" : this._activeView;
        const currentState = this.hass.states[this.config.view_controller]?.state;
        if (currentState !== option) {
           this.hass.callService('input_select', 'select_option', {
            entity_id: this.config.view_controller,
            option: option
          });
        }
      }

      if (this._activeView === 'whiteboard') this._fetchNotes(this.config.notes_entity);
      if (this._activeView === 'chores') this._fetchChoreData();
      
      // Force refresh events if switching to agenda to ensure we have 30 days
      if (this._activeView === 'calendar' && this._calendarMode === 'agenda') {
          this._fetchEvents();
      }
    }

    // 2. Data Refresh Logic
    if (changedProps.has('hass')) {
      this._checkDailyReset();
      
      const oldHass = changedProps.get('hass');
      if (oldHass) {
        if (this._activeView === 'whiteboard' && 
            this.hass.states[this.config.notes_entity] !== oldHass.states[this.config.notes_entity]) {
          this._fetchNotes(this.config.notes_entity);
        }
        if (this._activeView === 'chores') {
          this._fetchChoreData();
        }
      }
    }

    if (changedProps.has('hass') || changedProps.has('_activeView') ||
      changedProps.has('_calendarMode') || changedProps.has('_referenceDate')) {
      this._refreshData();
    }
  }

  // --- Data Management ---

  async _fetchChoreData() {
    if (!this.hass || !this.config.chores) return;

    const allItems = [];
    for (const kid of this.config.chores) {
      if (kid.todo_list) {
        try {
          // Fetch items using standard WebSocket (efficient equivalent of todo.get_items)
          const result = await this.hass.callWS({
            type: "todo/item/list",
            entity_id: kid.todo_list,
          });
          
          const taggedItems = (result.items || []).map(item => {
            const newItem = JSON.parse(JSON.stringify(item));
            newItem.list_id = kid.todo_list;
            
            // Logic for 1. 2. 3. prefixes to differentiate Morning/Afternoon/Night
            const summary = newItem.summary || "";
            const match = summary.match(/^([1-3])\.\s*(.*)/);
            if (match) {
                newItem.period_index = parseInt(match[1]); // 1, 2, or 3
                newItem.label = match[2]; // Truncated text (e.g., "Brush Teeth")
            } else {
                newItem.period_index = 0; // No prefix found
                newItem.label = summary;
            }
            
            return newItem;
          });
          allItems.push(...taggedItems);
        } catch (e) {
          console.warn("Chore fetch failed for", kid.todo_list);
        }
      }
    }
    this._todoItems = allItems;
    this.requestUpdate(); 
  }

  async _checkDailyReset() {
    if (!this.hass || !this.config.chores) return;
    const today = new Date().toDateString();

    if (this._lastResetDate !== today) {
      for (const kid of this.config.chores) {
        if (kid.todo_list && this.hass.states[kid.todo_list]) {
          try {
             const result = await this.hass.callWS({
                type: "todo/item/list",
                entity_id: kid.todo_list,
             });
             const items = result.items || [];
             
             for (const item of items) {
                if (item.status === 'completed') {
                  await this.hass.callService('todo', 'update_item', {
                    entity_id: kid.todo_list,
                    item: item.uid || item.summary,
                    status: 'needs_action'
                  });
                }
             }
          } catch(e) {
             console.error("Daily Reset Failed:", e);
          }
        }
      }
      localStorage.setItem('nightlight_reset_date', today);
      this._lastResetDate = today;
    }
  }

  async _toggleTodo(item) {
    if (!item) return;
    const newStatus = item.status === 'completed' ? 'needs_action' : 'completed';
    
    // Optimistic UI update
    const oldStatus = item.status;
    item.status = newStatus;
    this.requestUpdate();

    try {
      await this.hass.callService('todo', 'update_item', {
        entity_id: item.list_id,
        item: item.uid || item.summary, // Use original summary (with prefix) or UID
        status: newStatus
      });
      // Background refresh to ensure sync
      this._fetchChoreData();
    } catch (e) {
      console.error("Todo Toggle Failed:", e);
      // Revert on failure
      item.status = oldStatus;
      this.requestUpdate();
    }
  }

  async _refreshData() {
    if (!this.hass || this._loading) return;
    this._loading = true;
    try {
      if (this._activeView === 'calendar') {
        await this._fetchEvents();
      }
    } finally {
      this._loading = false;
    }
  }

  async _fetchEvents() {
    let start = new Date(this._referenceDate);
    let end = new Date(this._referenceDate);

    // Agenda: Fetch 30 days from today always
    if (this._calendarMode === 'agenda') {
        start = new Date();
        start.setHours(0,0,0,0);
        end = new Date(start);
        end.setDate(start.getDate() + 30);
    } 
    else if (this._calendarMode === 'month') {
      start = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth(), 1);
      end = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth() + 1, 0, 23, 59, 59);
    } else if (this._calendarMode === 'week') {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 7);
    } else {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }

    const startStr = start.toISOString();
    const endStr = end.toISOString();

    const filteredEntities = (this.config.entities || []).filter(e => e.entity.startsWith('calendar'));
    const promises = filteredEntities.map(ent => {
      return this.hass.callApi('GET', `calendars/${ent.entity}?start=${startStr}&end=${endStr}`)
        .then(evs => evs.map(e => {
          const stateObj = this.hass.states[ent.entity];
          return {
            ...e,
            color: ent.color || '#7b61ff',
            origin: ent.entity,
            friendly_name: (stateObj && stateObj.attributes) ? stateObj.attributes.friendly_name : ent.entity,
            icon: (stateObj && stateObj.attributes) ? stateObj.attributes.icon : null
          };
        }))
        .catch(() => []);
    });
    const results = await Promise.all(promises);
    this._events = results.flat();
  }

  async _fetchNotes(entityId) {
    if (!entityId || !this.hass) return;
    try {
      const result = await this.hass.callWS({
        type: "todo/item/list",
        entity_id: entityId,
      });
      this._todoItems = (result.items || []).filter(item => item.status === 'needs_action');
      this.requestUpdate();
    } catch (e) {
      console.error("Failed to fetch notes:", e);
    }
  }

  // --- Interaction & Utils ---

  _navigate(dir) {
    const d = new Date(this._referenceDate);
    if (this._calendarMode === 'month') d.setMonth(d.getMonth() + dir);
    else if (this._calendarMode === 'week') d.setDate(d.getDate() + (dir * 7));
    else d.setDate(d.getDate() + dir);
    this._referenceDate = d;
  }

  _togglePersona(id) {
    this._activeCalendars = this._activeCalendars.includes(id) ?
      this._activeCalendars.filter(i => i !== id) : [...this._activeCalendars, id];
  }

  _handleMonthDayClick(dayNum, evsCount) {
    if (!dayNum) return;
    const newDate = new Date(this._referenceDate);
    newDate.setDate(dayNum);
    this._referenceDate = newDate;
    // Always switch to day view on day click, regardless of events
    this._calendarMode = 'day';
  }

  _toggleTheme() {
      this._themeMode = this._themeMode === 'dark' ? 'light' : 'dark';
      this.requestUpdate();
  }

  async _submitEvent() {
    const root = this.shadowRoot;
    const summary = root.getElementById('new_summary').value;
    const calendar = root.getElementById('new_calendar').value;
    const dateStart = root.getElementById('new_date_start').value;
    const timeStart = root.getElementById('new_start_time').value;
    const dateEnd = root.getElementById('new_date_end').value;
    const timeEnd = root.getElementById('new_end_time').value;
    const location = root.getElementById('new_location').value;
    const description = root.getElementById('new_description').value;

    if (!summary || !dateStart || !calendar) {
      alert("Please provide at least a title, start date, and target calendar.");
      return;
    }

    try {
      await this.hass.callService('calendar', 'create_event', {
        entity_id: calendar,
        summary: summary,
        location: location,
        description: description,
        start_date_time: `${dateStart}T${timeStart}:00`,
        end_date_time: `${dateEnd}T${timeEnd}:00`,
      });
      this._showAddModal = false;
      this._refreshData();
    } catch (e) {
      console.error("Failed to create event:", e);
    }
  }

  _isPast(event) {
    const end = new Date(event.end.dateTime || event.end.date);
    return new Date() > end;
  }

  _sanitize(text) {
    const div = document.createElement('div');
    div.textContent = text || 'No details provided.';
    return div.innerHTML;
  }

  _getTimeStyles(e) {
    const s = new Date(e.start.dateTime);
    const end = new Date(e.end.dateTime);
    // Calculation: 60px height per hour = 1px per minute.
    const top = (s.getHours() * 60 + s.getMinutes()) * 1; 
    const durationMinutes = (end - s) / 60000;
    const height = Math.max(durationMinutes * 1, 30);
    return `top:${top}px;height:${height}px`;
  }

  _fragmentEvents(events, startRange = null, endRange = null) {
    const fragmented = [];
    events.forEach(event => {
      const start = new Date(event.start.dateTime || event.start.date);
      const end = new Date(event.end.dateTime || event.end.date);
      if (start.toDateString() === end.toDateString()) {
        const ev = JSON.parse(JSON.stringify(event));
        ev.displayDate = start.toDateString();
        fragmented.push(ev);
      } else {
        let current = new Date(start);
        while (current <= end) {
          if ((!startRange || current >= startRange) && (!endRange || current <= endRange)) {
            const ev = JSON.parse(JSON.stringify(event));
            ev.isFragment = true;
            ev.displayDate = current.toDateString();
            ev.isAllDay = true;
            fragmented.push(ev);
          }
          current.setDate(current.getDate() + 1);
        }
      }
    });
    return fragmented;
  }

  _isToday(n) {
    const t = new Date();
    return n === t.getDate() &&
      this._referenceDate.getMonth() === t.getMonth() &&
      this._referenceDate.getFullYear() === t.getFullYear();
  }

  // --- RENDERERS ---

  render() {
    if (!this.hass) return html``;

    const coreNav = [
      { id: 'calendar', name: 'Calendar', icon: 'mdi:calendar-month' },
      { id: 'meals', name: 'Dinner', icon: 'mdi:silverware-fork-knife' },
      { id: 'whiteboard', name: 'Notes', icon: 'mdi:note-edit' },
      { id: 'chores', name: 'Chores', icon: 'mdi:check-all' }
    ];

    let headerTitle = this.config.title || "Family Hub";
    if (this._activeView === 'calendar') {
        headerTitle = this._referenceDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    } else {
        const core = coreNav.find(n => n.id === this._activeView);
        if (core) headerTitle = core.name;
        else {
            const custom = (this.config.navigation || []).find(n => n.name === this._activeView);
            if (custom) headerTitle = custom.name;
        }
    }

    const customNav = this.config.navigation || [];
    const notesState = this.hass.states[this.config.notes_entity];
    const hasNewNotes = notesState ? (new Date() - new Date(notesState.last_changed)) < (60 * 60 * 1000) : false;
    
    // Explicit theme handling
    const activeTheme = this._themeMode === 'dark' ? 'dark' : 'light';

    return html`
      <div class="nightlight-hub ${activeTheme} ${this._menuOpen ? 'menu-open' : ''}">
        
        <!-- SIDEBAR -->
        <nav class="sidebar">
          <div class="sidebar-top">
             <button class="mobile-close" @click="${() => this._menuOpen = false}">✕</button>
             <a href="${this.config.logo_url || '/'}" class="logo">
               <ha-icon icon="mdi:home-assistant"></ha-icon>
             </a>
          </div>

          <div class="nav-group">
            ${coreNav.map(nav => html`
              <button class="nav-item ${this._activeView === nav.id ? 'active' : ''}"
                      @click="${() => this._switchView(nav.id)}">
                 <div class="nav-icon-container">
                   <ha-icon icon="${nav.icon}"></ha-icon>
                   ${nav.id === 'whiteboard' && hasNewNotes ? html`<div class="badge"></div>` : ''}
                 </div>
                 <span>${nav.name}</span>
              </button>
            `)}
          </div>

          ${customNav.length > 0 ? html`<div class="nav-divider"></div>` : ''}

          <div class="nav-group">
            ${customNav.map(nav => html`
              <button class="nav-item ${this._activeView === nav.name ? 'active' : ''}"
                      @click="${() => this._switchView(nav.name, true)}">
                 <div class="nav-icon-container"><ha-icon icon="${nav.icon}"></ha-icon></div>
                 <span>${nav.name}</span>
              </button>
            `)}
          </div>

          <div class="sidebar-spacer" style="flex: 1"></div>
          
          <!-- Calendar Controls moved to Sidebar Bottom -->
          ${this._activeView === 'calendar' ? html`
            <div class="sidebar-controls">
                <div class="control-group">
                  <div class="control-label">View</div>
                  <div class="view-toggles sidebar-mode">
                    ${['month', 'week', 'day', 'agenda'].map(m => html`
                      <button class="${this._calendarMode === m ? 'active' : ''}" 
                              @click="${() => { this._calendarMode = m; this._menuOpen = false; }}">
                        ${m}
                      </button>
                    `)}
                  </div>
                  <button class="today-btn full" @click="${() => { this._referenceDate = new Date(); this._menuOpen = false; }}">Jump to Today</button>
                </div>

                <div class="control-group">
                  <div class="control-label">Calendars</div>
                  <div class="persona-stack sidebar-mode">
                    ${(this.config.entities || []).filter(e => e.entity.startsWith('calendar')).map(ent => {
                        const cal = this._events.find(ev => ev.origin === ent.entity) || {};
                        const icon = ent.icon || cal.icon;
                        const initial = ent.name ? ent.name[0] : (cal.friendly_name ? cal.friendly_name[0] : 'C');
                        
                        return html`
                        <div class="persona-dot ${this._activeCalendars.includes(ent.entity) ? 'active' : 'inactive'}" 
                             style="background: ${ent.color}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;" 
                             title="${ent.entity}"
                             @click="${() => this._togglePersona(ent.entity)}">
                          ${ent.picture ? html`<img src="${ent.picture}">` : 
                             (icon ? html`<ha-icon icon="${icon}" style="--mdc-icon-size: 16px;"></ha-icon>` : initial)}
                        </div>
                      `})}
                  </div>
                </div>
            </div>
          ` : ''}
        </nav>

        <ha-icon-button class="mobile-toggle" @click="${() => this._menuOpen = true}">
          <ha-icon icon="mdi:menu"></ha-icon>
        </ha-icon-button>

        <!-- MAIN CONTENT AREA -->
        <main class="stage">
          <header class="stage-header">
            <div class="header-left">
              <div class="header-titles">
                <h1>${headerTitle}</h1>
                <div class="subtitle">
                   <span class="clock">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                   ${this._activeView === 'calendar' ? html`
                     <div class="nav-controls">
                       <button @click="${() => this._navigate(-1)}"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
                       <button @click="${() => this._navigate(1)}"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
                     </div>
                   `: ''}
                </div>
              </div>
            </div>

            <div class="header-right">
              <div class="theme-switch" @click="${this._toggleTheme}" title="Toggle Theme">
                   <div class="switch-knob">
                      <ha-icon icon="${this._themeMode === 'dark' ? 'mdi:weather-night' : 'mdi:weather-sunny'}" style="--mdc-icon-size: 14px;"></ha-icon>
                   </div>
              </div>
            </div>
          </header>

          <section class="content-body">
            ${this._renderActiveModule()}
          </section>

          <!-- Floating Action Button -->
          ${this._activeView === 'calendar' ? html`
             <button class="fab" @click="${() => { this._showAddModal = true; this.requestUpdate(); }}">
               <ha-icon icon="mdi:plus"></ha-icon>
             </button>
          ` : ''}
        </main>

        ${this._selectedEvent ? this._renderModal() : ''}
        ${this._showAddModal ? this._renderAddModal() : ''}
      </div>
    `;
  }

  _switchView(viewId, isCustom = false) {
    this._activeView = viewId;
    this._menuOpen = false;
    
    // Trigger HA Input Select for external dashboard control
    if (this.config.view_controller) {
      const option = isCustom ? viewId : "Nightlight";
      this.hass.callService('input_select', 'select_option', {
        entity_id: this.config.view_controller,
        option: option
      });
    }
  }

  _renderActiveModule() {
    switch (this._activeView) {
      case 'meals': return this._renderMealPlanner();
      case 'whiteboard': return this._renderWhiteboard();
      case 'chores': return this._renderChoreDashboard();
      case 'calendar': 
         if (this._calendarMode === 'month') return this._renderMonthGrid();
         if (this._calendarMode === 'agenda') return this._renderAgenda();
         return this._renderTimeGrid(this._calendarMode === 'week' ? 7 : 1);
      default: return html`<div class="placeholder-view"></div>`;
    }
  }

  _renderMealPlanner() {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const entities = this.config.meal_entities || {};

    return html`
      <div class="meals-container">
        ${days.map(day => {
          const entityId = entities[day];
          const stateObj = this.hass.states[entityId];
          let displayValue = "";
          
          if (stateObj && stateObj.state && stateObj.state !== "unknown") {
            const parts = stateObj.state.split(' | ');
            const timestamp = parts[1];
            // Clear if older than 5 days
            if (timestamp && (new Date() - new Date(timestamp)) > (432000000)) { // 5 days ms
               this._saveMeal(day, "");
            } else {
               displayValue = parts[0];
            }
          }

          return html`
            <div class="meal-card">
              <div class="meal-header">${day}</div>
              <textarea 
                class="meal-input"
                placeholder="Add meal..." 
                .value="${displayValue}" 
                @change="${(e) => this._saveMeal(day, e.target.value)}">
              </textarea>
            </div>`;
        })}
      </div>`;
  }

  async _saveMeal(day, value) {
    const mealEntities = this.config.meal_entities;
    const entityId = mealEntities ? mealEntities[day] : null;
    if (!entityId) return;

    const timestamp = new Date().toISOString();
    const payload = value ? value + " | " + timestamp : "";
    await this.hass.callService('input_text', 'set_value', { entity_id: entityId, value: payload });
  }

  _renderWhiteboard() {
    const entityId = this.config.notes_entity;
    const items = this._todoItems || [];

    return html`
      <div class="whiteboard-board">
        <div class="whiteboard-tools">
          <button class="btn-primary" @click="${() => this._showAddNotePrompt(entityId)}">
            <ha-icon icon="mdi:sticker-plus-outline"></ha-icon> Add Note
          </button>
        </div>
        <div class="notes-grid">
          ${items.length === 0 ? html`<div class="empty-state">No notes posted.</div>` : 
            items.map(item => {
               const parts = item.summary.split('--');
               const formatted = parts.map((l, i) => i === 0 ? l : html`<br>• ${l.trim()}`);
               return html`
                 <div class="note-card">
                   <button class="note-close" @click="${() => this._deleteNote(entityId, item.uid || item.summary)}">✕</button>
                   <div class="note-body">${formatted}</div>
                 </div>
               `;
            })
          }
        </div>
      </div>`;
  }

  async _showAddNotePrompt(entityId) {
    const note = prompt("Type your note:");
    if (note) {
      await this.hass.callService('todo', 'add_item', { entity_id: entityId, item: note });
      await this._fetchNotes(entityId);
    }
  }

  async _deleteNote(entityId, identifier) {
    if (confirm("Archive this note?")) {
       await this.hass.callService('todo', 'update_item', { 
         entity_id: entityId, 
         item: identifier, 
         status: 'completed' 
       });
       await this._fetchNotes(entityId);
    }
  }

  _renderChoreDashboard() {
    if (!this.config.chores || !this.config.periods) return html`<div class="empty-state">Chores not configured.</div>`;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const currentUser = this.hass.user ? this.hass.user.name : null;
    const isAdmin = this.hass.user ? this.hass.user.is_admin : false;

    // Determine Active Period based on config.periods array order
    let activePeriodIndex = -1;
    const activePeriod = this.config.periods.find((p, index) => {
      const [sh, sm] = p.start.split(':').map(Number);
      const [eh, em] = p.end.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      if (currentMins >= start && currentMins <= end) {
          activePeriodIndex = index;
          return true;
      }
      return false;
    });

    if (!activePeriod) return html`
      <div class="chore-center-message">
        <ha-icon icon="mdi:sleep" style="font-size: 64px; opacity: 0.5;"></ha-icon>
        <h2>No Active Chore Period</h2>
        <p>Check back later.</p>
      </div>`;

    // Map 1st period -> Prefix "1.", 2nd -> "2.", etc.
    const targetPrefix = activePeriodIndex + 1; 

    const visibleKids = this.config.chores.filter(kid => 
      isAdmin || !kid.assigned_user || kid.assigned_user === currentUser
    );

    return html`
      <div class="chore-dashboard">
        <div class="period-badge">Current: ${activePeriod.name}</div>
        <div class="chore-grid">
          ${visibleKids.map(kid => {
             // Filter tasks matching kid's list ID AND current period prefix (1., 2., 3.)
             const tasks = (this._todoItems || []).filter(i => 
                 i.list_id === kid.todo_list && 
                 (i.period_index === targetPrefix)
             );
             
             if (tasks.length === 0) return '';
             
             return html`
               <div class="kid-card">
                 <div class="kid-hero" style="background-image: url('${kid.image || ''}')">
                   <div class="hero-overlay">
                     <h3>${kid.name}</h3>
                   </div>
                 </div>
                 <div class="task-list">
                   ${tasks.map(item => {
                      const isDone = item.status === 'completed';
                      return html`
                        <div class="task-row ${isDone ? 'completed' : ''}"
                             @click="${() => this._toggleTodo(item)}">
                          <ha-icon icon="${isDone ? 'mdi:checkbox-marked-circle' : 'mdi:checkbox-blank-circle-outline'}"></ha-icon>
                          <span>${item.label}</span>
                        </div>
                      `;
                   })}
                 </div>
               </div>
             `;
          })}
        </div>
      </div>`;
  }

  _renderMonthGrid() {
    const start = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth(), 1);
    const end = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth() + 1, 0);
    const startDay = (start.getDay() + 6) % 7; // Mon start
    const days = [];
    
    // Pad start
    for (let i = 0; i < startDay; i++) days.push({ date: null });
    // Fill month
    for (let i = 1; i <= end.getDate(); i++) days.push({ date: i, fullDate: new Date(start.getFullYear(), start.getMonth(), i) });

    return html`
      <div class="calendar-month">
        <div class="cal-header-row">
           ${['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d => html`<div>${d}</div>`)}
        </div>
        <div class="cal-grid no-scrollbar">
           ${days.map(d => {
              if (!d.date) return html`<div class="cal-day empty"></div>`;
              
              const dateStr = d.fullDate.toDateString();
              const isToday = this._isToday(d.date);
              const events = this._events.filter(e => {
                 if (!this._activeCalendars.includes(e.origin)) return false;
                 const eStart = new Date(e.start.dateTime || e.start.date);
                 return eStart.toDateString() === dateStr;
              }); // Limit in rendering, not filter

              return html`
                <div class="cal-day ${isToday ? 'today' : ''}" @click="${() => this._handleMonthDayClick(d.date, events.length)}">
                   <span class="day-number">${d.date}</span>
                   <div class="day-events-list">
                     ${events.slice(0, 4).map(e => html`
                       <div class="evt-pill" style="background-color: ${e.color}" title="${e.summary}"
                            @click="${(ev) => { ev.stopPropagation(); this._selectedEvent = e; }}">
                         ${e.summary}
                       </div>
                     `)}
                     ${events.length > 4 ? html`<div class="evt-more">+${events.length - 4}</div>` : ''}
                   </div>
                </div>
              `;
           })}
        </div>
      </div>
    `;
  }

  _renderAgenda() {
    const today = new Date();
    today.setHours(0,0,0,0);
    const endWindow = new Date(today);
    endWindow.setDate(today.getDate() + 30);

    const relevantEvents = this._events.filter(e => this._activeCalendars.includes(e.origin));
    let feedItems = [];

    relevantEvents.forEach(e => {
       const start = new Date(e.start.dateTime || e.start.date);
       const end = new Date(e.end.dateTime || e.end.date);
       // Normalize multi-day check
       const isMultiDay = (end.getTime() - start.getTime()) > 86400000;
       
       if (end < today || start > endWindow) return; // Out of range

       // 1. Start Entry
       if (start >= today) {
          feedItems.push({
             type: 'start',
             date: start,
             event: e,
             isMultiDay
          });
       }

       // 2. End Entry for MultiDay
       if (isMultiDay && end <= endWindow && end >= today) {
          feedItems.push({
             type: 'end',
             date: end,
             event: e
          });
       }
    });

    feedItems.sort((a,b) => a.date - b.date);

    return html`
      <div class="agenda-feed no-scrollbar">
        ${feedItems.map(item => {
           const d = item.date;
           const e = item.event;
           const isStart = item.type === 'start';
           const label = isStart ? (item.isMultiDay ? 'Starts: ' + e.summary : e.summary) : 'Ends: ' + e.summary;
           
           return html`
             <div class="feed-item ${!isStart ? 'feed-end' : ''}" @click="${() => this._selectedEvent = e}">
                <div class="feed-date">
                   <span class="fd-day">${d.getDate()}</span>
                   <span class="fd-mon">${d.toLocaleDateString('default', {month:'short'})}</span>
                </div>
                <div class="feed-content-wrapper" style="border-left: 4px solid ${e.color};">
                   <div class="feed-content">
                      <div class="feed-title">${label}</div>
                      <div class="feed-time">
                        ${e.isAllDay ? 'All Day' : d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                        ${!isStart ? ' (Finish)' : ''}
                      </div>
                   </div>
                   ${item.isMultiDay && isStart ? html`<div class="connector-line" style="background: ${e.color}"></div>` : ''}
                </div>
             </div>
           `;
        })}
        ${feedItems.length === 0 ? html`<div class="empty-state">No upcoming events in next 30 days.</div>` : ''}
      </div>
    `;
  }

  _renderTimeGrid(daysCount) {
     const start = new Date(this._referenceDate);
     if (daysCount === 7) {
        const day = start.getDay();
        start.setDate(start.getDate() - day + (day === 0 ? -6 : 1));
     }
     
     const hours = Array.from({length:24},(_,i)=>i);
     const frags = this._fragmentEvents(this._events, start);

     return html`
       <div class="time-grid no-scrollbar">
         <!-- Header -->
         <div class="tg-header">
           <div class="tg-gutter"></div>
           ${Array.from({length:daysCount}).map((_,i) => {
              const d = new Date(start); d.setDate(start.getDate() + i);
              return html`<div class="tg-col-head">${d.toLocaleDateString('default', {weekday:'short', day:'numeric'})}</div>`;
           })}
         </div>
         <!-- All Day -->
         <div class="tg-allday">
            <div class="tg-gutter-label">ALL DAY</div>
            <div class="tg-allday-cols" style="grid-template-columns: repeat(${daysCount}, 1fr)">
               ${Array.from({length:daysCount}).map((_,i) => {
                  const d = new Date(start); d.setDate(start.getDate() + i);
                  const evs = frags.filter(e => this._activeCalendars.includes(e.origin) && e.displayDate === d.toDateString() && (e.isAllDay || e.isFragment));
                  return html`
                    <div class="tg-ad-cell">
                      ${evs.map(e => html`<div class="ad-pill" style="background:${e.color}">${e.summary}</div>`)}
                    </div>`;
               })}
            </div>
         </div>
         <!-- Scrollable Body -->
         <div class="tg-body no-scrollbar">
            <div class="tg-time-axis">
               ${hours.map(h => html`<div class="tg-hour-marker"><span>${h}:00</span></div>`)}
            </div>
            <div class="tg-cols" style="grid-template-columns: repeat(${daysCount}, 1fr)">
               ${Array.from({length:daysCount}).map((_,i) => {
                  const d = new Date(start); d.setDate(start.getDate() + i);
                  const evs = frags.filter(e => this._activeCalendars.includes(e.origin) && e.displayDate === d.toDateString() && !e.isAllDay && !e.isFragment);
                  return html`
                    <div class="tg-day-col">
                       ${hours.map(() => html`<div class="tg-grid-line"></div>`)}
                       ${evs.map(e => html`
                          <div class="tg-event ${this._isPast(e) ? 'past' : ''}" 
                               style="${this._getTimeStyles(e)}; background-color: ${e.color}"
                               @click="${() => this._selectedEvent = e}">
                            ${e.summary}
                          </div>
                       `)}
                    </div>`;
               })}
            </div>
         </div>
       </div>`;
  }

  _renderModal() {
    if (!this._selectedEvent) return '';
    const start = new Date(this._selectedEvent.start.dateTime || this._selectedEvent.start.date);
    const end = new Date(this._selectedEvent.end.dateTime || this._selectedEvent.end.date);
    const timeStr = this._selectedEvent.isAllDay 
        ? 'All Day' 
        : `${start.toLocaleString()} - ${end.toLocaleTimeString()}`;

    return html`
      <div class="modal-overlay" @click="${() => this._selectedEvent = null}">
        <div class="modal-card" @click="${e => e.stopPropagation()}">
           <div class="modal-header" style="background: ${this._selectedEvent.color}">
             <h2>${this._selectedEvent.summary}</h2>
             <button @click="${() => this._selectedEvent = null}">✕</button>
           </div>
           <div class="modal-content">
             <div class="meta-row">
               <ha-icon icon="mdi:clock-outline"></ha-icon>
               <span>${timeStr}</span>
             </div>
             ${this._selectedEvent.location ? html`
             <div class="meta-row">
               <ha-icon icon="mdi:map-marker"></ha-icon>
               <span>${this._selectedEvent.location}</span>
             </div>` : ''}
             <div class="meta-row">
               <ha-icon icon="mdi:calendar-blank"></ha-icon>
               <span>${this._selectedEvent.friendly_name}</span>
             </div>
             ${this._selectedEvent.description ? html`
               <div class="desc-box" .innerHTML="${this._sanitize(this._selectedEvent.description)}"></div>
             ` : ''}
           </div>
        </div>
      </div>`;
  }

  _renderAddModal() {
    const now = new Date().toISOString().split('T')[0];
    return html`
      <div class="modal-overlay" @click="${() => this._showAddModal = false}">
         <div class="modal-card create-modal" @click="${e => e.stopPropagation()}">
            <div class="modal-header">
               <h2>Create Event</h2>
               <button @click="${() => this._showAddModal = false}">✕</button>
            </div>
            <div class="modal-content form-layout">
               <input type="text" id="new_summary" placeholder="Event Title" class="input-field primary">
               <div class="row">
                  <input type="date" id="new_date_start" value="${now}" class="input-field">
                  <input type="time" id="new_start_time" value="12:00" class="input-field">
               </div>
               <div class="row">
                  <input type="date" id="new_date_end" value="${now}" class="input-field">
                  <input type="time" id="new_end_time" value="13:00" class="input-field">
               </div>
               <input type="text" id="new_location" placeholder="Location" class="input-field">
               <textarea id="new_description" placeholder="Notes" rows="3" class="input-field"></textarea>
               <select id="new_calendar" class="input-field">
                  ${(this.config.entities || []).filter(e => e.entity.startsWith('calendar')).map(ent => html`<option value="${ent.entity}">${ent.entity}</option>`)}
               </select>
            </div>
            <div class="modal-footer">
               <button class="btn-primary full" @click="${this._submitEvent}">Create Event</button>
            </div>
         </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      :host {
        /* SKYLIGHT LIGHT THEME */
        --nl-bg: #FFFFFF;
        --nl-surface: #F3F4F6;
        --nl-fg: #111827;
        --nl-fg-sec: #6B7280;
        --nl-border: #E5E7EB;
        --nl-accent: #3B82F6;
        --nl-sidebar-w: 240px;
        --nl-radius: 12px;
        --nl-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
        
        display: flex;
        flex-direction: column;
        height: calc(100vh - 56px); /* Fix for height collapsing */
        min-height: 600px;
        width: 100%;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        background: var(--primary-background-color);
        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        overflow: hidden;
      }
      
      * { box-sizing: border-box; }

      /* SKYLIGHT DARK THEME */
      .nightlight-hub.dark {
        --nl-bg: #111827;
        --nl-surface: #1F2937;
        --nl-fg: #F9FAFB;
        --nl-fg-sec: #9CA3AF;
        --nl-border: #374151;
        --nl-accent: #60A5FA;
        --nl-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
      }

      /* Unified Mode Styling */
      .nightlight-hub {
        display: flex;
        height: 100%;
        width: 100%;
        color: var(--nl-fg);
        background: var(--nl-bg);
        transition: background 0.3s, color 0.3s;
      }

      /* Sidebar - Persistent on Desktop */
      .sidebar {
        width: var(--nl-sidebar-w);
        background: var(--nl-surface);
        border-right: 1px solid var(--nl-border);
        display: flex;
        flex-direction: column;
        padding: 24px 16px;
        gap: 12px;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 100;
        flex-shrink: 0;
      }
      .sidebar-top {
        display: flex;
        align-items: center;
        margin-bottom: 32px;
        justify-content: space-between;
        padding-left: 12px;
      }
      .logo ha-icon { color: var(--nl-accent); --mdc-icon-size: 36px; }
      .mobile-close { background: none; border: none; font-size: 24px; color: var(--nl-fg); display: none; cursor: pointer;}
      
      .nav-group { display: flex; flex-direction: column; gap: 6px; }
      .nav-divider { height: 1px; background: var(--nl-border); margin: 16px 8px; }
      
      .nav-item {
        background: none;
        border: none;
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        border-radius: var(--nl-radius);
        color: var(--nl-fg-sec);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
        font-size: 1rem;
      }
      .nav-item:hover { background: rgba(125,125,125,0.05); color: var(--nl-fg); }
      .nav-item.active { background: var(--nl-bg); color: var(--nl-accent); font-weight: 700; box-shadow: var(--nl-shadow); }
      .nav-icon-container { position: relative; display: flex; align-items: center;}
      .badge { position: absolute; top: -2px; right: -2px; width: 8px; height: 8px; background: #EF4444; border-radius: 50%; }

      .mobile-toggle { display: none; position: absolute; top: 16px; left: 16px; z-index: 50; color: var(--nl-fg); }
      
      /* Sidebar Controls (New) */
      .sidebar-controls { margin-top: auto; padding-top: 20px; border-top: 1px solid var(--nl-border); display: flex; flex-direction: column; gap: 16px; }
      .control-label { font-size: 0.75rem; text-transform: uppercase; color: var(--nl-fg-sec); font-weight: 700; letter-spacing: 0.5px; margin-bottom: 8px; }
      .view-toggles.sidebar-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border: none; background: none; padding: 0; }
      .view-toggles.sidebar-mode button { background: var(--nl-surface); border: 1px solid var(--nl-border); color: var(--nl-fg); text-align: center; justify-content: center; padding: 10px; border-radius: 8px; cursor: pointer; }
      .view-toggles.sidebar-mode button.active { background: var(--nl-accent); color: #fff; border-color: var(--nl-accent); }
      .today-btn.full { width: 100%; margin: 8px 0 0 0; text-align: center; background: var(--nl-surface); border: 1px solid var(--nl-border); padding: 8px 16px; border-radius: 8px; cursor: pointer; color: var(--nl-fg); font-weight: 600; }
      .persona-stack.sidebar-mode { flex-wrap: wrap; margin: 0; gap: 8px; display: flex; }

      /* Main Stage */
      .stage { flex: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; background: var(--nl-bg); }
      .stage-header {
        padding: 24px 32px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      .header-left { display: flex; align-items: center; gap: 24px; }
      .header-titles h1 { margin: 0; font-size: 2rem; font-weight: 700; color: var(--nl-fg); letter-spacing: -0.5px; }
      
      /* Subtitle Fix for Mobile */
      .subtitle { 
        display: flex; 
        align-items: center; 
        gap: 12px; 
        color: var(--nl-fg-sec); 
        font-size: 1.1rem; 
        margin-top: 4px; 
        white-space: nowrap; 
      }
      .clock { font-feature-settings: "tnum"; font-variant-numeric: tabular-nums; font-weight: 500; }
      
      .nav-controls { display: flex; gap: 8px; }
      .nav-controls button { background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: 8px; cursor: pointer; color: var(--nl-fg); padding: 4px 8px; transition: background 0.2s; }
      .nav-controls button:hover { background: var(--nl-border); }
      
      .header-right { display: flex; align-items: center; gap: 20px; }
      .calendar-controls { display: flex; align-items: center; gap: 16px; }

      /* Theme Switch Styling */
      .theme-switch {
        width: 68px;
        height: 38px;
        background: var(--nl-surface);
        border: 1px solid var(--nl-border);
        border-radius: 24px;
        position: relative;
        cursor: pointer;
        transition: background 0.3s;
      }
      .switch-knob {
        width: 30px;
        height: 30px;
        background: var(--nl-fg);
        border-radius: 50%;
        position: absolute;
        top: 3px;
        left: 4px;
        transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--nl-bg);
      }
      .dark .switch-knob { transform: translateX(30px); background: var(--nl-accent); color: #fff; }

      .persona-dot { width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--nl-bg); cursor: pointer; transition: transform 0.2s, opacity 0.2s; opacity: 0.4; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .persona-dot.active { opacity: 1; transform: scale(1.1); z-index: 10; border-color: var(--nl-accent); }
      .persona-dot img { width: 100%; height: 100%; object-fit: cover; }

      .content-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 0 32px 32px 32px; box-sizing: border-box; }
      
      /* Scrollbar hiding */
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

      /* Calendar Grid - Skylight Style */
      .calendar-month { height: 100%; display: flex; flex-direction: column; background: var(--nl-bg); border-radius: var(--nl-radius); border: 1px solid var(--nl-border); overflow: hidden; box-shadow: var(--nl-shadow); }
      .cal-header-row { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; padding: 16px 0; border-bottom: 1px solid var(--nl-border); font-weight: 600; color: var(--nl-fg-sec); font-size: 0.9rem; letter-spacing: 1px; background: var(--nl-surface); }
      .cal-grid { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 1fr; overflow-y: auto; -ms-overflow-style: none; scrollbar-width: none; }
      .cal-grid::-webkit-scrollbar { display: none; }
      
      .cal-day { border-right: 1px solid var(--nl-border); border-bottom: 1px solid var(--nl-border); padding: 8px; cursor: pointer; transition: background 0.1s; display: flex; flex-direction: column; gap: 6px; overflow: hidden; position: relative; }
      .cal-day:hover { background: var(--nl-surface); }
      .cal-day.today { background: rgba(59, 130, 246, 0.05); }
      .cal-day.today .day-number { color: var(--nl-accent); font-weight: 800; transform: scale(1.1); }
      .day-number { font-size: 1rem; color: var(--nl-fg); padding: 4px; font-weight: 500; align-self: flex-start; }
      .day-events-list { display: flex; flex-direction: column; gap: 3px; flex: 1; }
      .evt-pill { font-size: 11px; padding: 3px 6px; border-radius: 4px; color: #fff; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1.3; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,0.1); transition: transform 0.1s; }
      .evt-pill:hover { transform: scale(1.02); z-index: 2; }
      .evt-more { font-size: 10px; color: var(--nl-fg-sec); font-weight: 600; padding-left: 6px; }

      /* Time Grid */
      .time-grid { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--nl-border); border-radius: var(--nl-radius); background: var(--nl-bg); overflow: hidden; box-shadow: var(--nl-shadow); }
      
      .tg-header { display: flex; border-bottom: 1px solid var(--nl-border); background: var(--nl-surface); }
      .tg-gutter { width: 60px; flex-shrink: 0; border-right: 1px solid var(--nl-border); }
      .tg-col-head { flex: 1; text-align: center; padding: 12px; font-weight: 600; font-size: 1rem; border-right: 1px solid var(--nl-border); color: var(--nl-fg); }
      .tg-allday { display: flex; border-bottom: 2px solid var(--nl-border); min-height: 40px; background: var(--nl-bg); }
      .tg-gutter-label { width: 60px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: var(--nl-fg-sec); border-right: 1px solid var(--nl-border); font-weight: 700; letter-spacing: 0.5px; }
      .tg-allday-cols { flex: 1; display: grid; }
      .tg-ad-cell { border-right: 1px solid var(--nl-border); padding: 4px; display: flex; flex-direction: column; gap: 2px; }
      .ad-pill { font-size: 0.8rem; padding: 4px 8px; border-radius: 4px; color: #fff; white-space: nowrap; overflow: hidden; font-weight: 600; }
      .tg-body { flex: 1; overflow-y: auto; display: flex; position: relative; }
      .tg-time-axis { width: 60px; flex-shrink: 0; border-right: 1px solid var(--nl-border); background: var(--nl-surface); }
      .tg-hour-marker { height: 60px; border-bottom: 1px solid transparent; position: relative; }
      .tg-hour-marker span { position: absolute; top: -8px; right: 8px; font-size: 0.8rem; color: var(--nl-fg-sec); font-weight: 500; }
      .tg-cols { flex: 1; display: grid; }
      .tg-day-col { border-right: 1px solid var(--nl-border); position: relative; height: 1440px; background: var(--nl-bg); } /* 24 * 60 */
      .tg-grid-line { height: 60px; border-bottom: 1px solid var(--nl-border); box-sizing: border-box; }
      .tg-event { position: absolute; left: 4px; right: 4px; padding: 6px; border-radius: 6px; font-size: 0.85rem; color: #fff; overflow: hidden; cursor: pointer; z-index: 10; border: 1px solid rgba(255,255,255,0.2); font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.15); }

      /* Agenda Feed */
      .agenda-feed { display: flex; flex-direction: column; gap: 24px; padding: 0 16px; overflow-y: auto; height: 100%; }
      .feed-item { display: flex; gap: 24px; align-items: stretch; cursor: pointer; group: true; }
      .feed-date { display: flex; flex-direction: column; align-items: center; min-width: 60px; padding-top: 8px; }
      .fd-day { font-size: 2rem; font-weight: 700; color: var(--nl-fg); line-height: 1; letter-spacing: -1px; }
      .fd-mon { font-size: 0.9rem; text-transform: uppercase; color: var(--nl-accent); font-weight: 700; margin-top: 4px; }
      .feed-content-wrapper { flex: 1; background: var(--nl-surface); border-radius: 12px; border: 1px solid var(--nl-border); padding: 16px; position: relative; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; }
      .feed-item:hover .feed-content-wrapper { transform: translateY(-2px); box-shadow: var(--nl-shadow); background: var(--nl-bg); }
      .feed-content { display: flex; justify-content: space-between; align-items: center; }
      .feed-title { font-weight: 600; font-size: 1.1rem; color: var(--nl-fg); }
      .feed-time { font-size: 0.9rem; color: var(--nl-fg-sec); font-weight: 500; }
      .feed-end .feed-date { opacity: 0.5; }
      .feed-end .feed-title { color: var(--nl-fg-sec); font-style: italic; }
      .connector-line { position: absolute; left: -29px; top: 40px; bottom: -40px; width: 4px; opacity: 0.3; z-index: 0; border-radius: 2px; }

      /* Modules: Chores, Meals, Notes */
      .chore-dashboard { height: 100%; display: flex; flex-direction: column; }
      .period-badge { align-self: flex-end; background: var(--nl-accent); color: #fff; padding: 6px 16px; border-radius: 20px; font-size: 0.9rem; font-weight: 700; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .chore-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
      .kid-card { background: var(--nl-surface); border-radius: 20px; overflow: hidden; border: 1px solid var(--nl-border); display: flex; flex-direction: column; box-shadow: var(--nl-shadow); }
      .kid-hero { height: 120px; background-size: cover; background-position: center; position: relative; }
      .hero-overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 16px; background: linear-gradient(transparent, rgba(0,0,0,0.8)); color: #fff; }
      .hero-overlay h3 { margin: 0; font-size: 1.4rem; font-weight: 700; }
      .task-list { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
      .task-row { display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--nl-bg); border-radius: 12px; cursor: pointer; transition: all 0.2s; border: 1px solid var(--nl-border); }
      .task-row:hover { transform: translateX(4px); border-color: var(--nl-accent); }
      .task-row.completed { opacity: 0.6; text-decoration: line-through; background: transparent; border-style: dashed; }
      .task-row.completed ha-icon { color: #10B981; }
      
      .meals-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }
      .meal-card { background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: 20px; padding: 20px; display: flex; flex-direction: column; box-shadow: var(--nl-shadow); transition: transform 0.2s; }
      .meal-card:hover { transform: translateY(-4px); }
      .meal-header { font-weight: 800; color: var(--nl-accent); margin-bottom: 12px; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 1px; }
      .meal-input { border: none; background: transparent; resize: none; width: 100%; font-family: inherit; font-size: 1.1rem; color: var(--nl-fg); outline: none; flex: 1; line-height: 1.5; }

      .whiteboard-board { display: flex; flex-direction: column; height: 100%; }
      .whiteboard-tools { margin-bottom: 24px; display: flex; justify-content: flex-end; }
      .notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px; }
      .note-card { background: #FEF3C7; padding: 24px; border-radius: 2px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); position: relative; min-height: 160px; color: #333; transform: rotate(-1deg); transition: transform 0.2s; border-top: 1px solid rgba(0,0,0,0.05); }
      .note-card:hover { transform: scale(1.02) rotate(0deg); z-index: 5; box-shadow: 0 10px 15px rgba(0,0,0,0.1); }
      .note-close { position: absolute; top: 8px; right: 8px; background: none; border: none; cursor: pointer; opacity: 0.4; font-weight: bold; font-size: 1.2rem; transition: opacity 0.2s; }
      .note-close:hover { opacity: 1; }
      .note-body { font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif; font-size: 1.2rem; line-height: 1.5; color: #4B5563; }

      /* Modals */
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 2000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); }
      .modal-card { background: var(--nl-bg); width: 90%; max-width: 450px; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); border: 1px solid var(--nl-border); }
      @keyframes slideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .modal-header { padding: 24px; display: flex; justify-content: space-between; align-items: flex-start; color: #fff; }
      .modal-header h2 { margin: 0; font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
      .modal-header button { background: rgba(0,0,0,0.2); border: none; color: #fff; font-size: 1.2rem; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
      .modal-content { padding: 32px; display: flex; flex-direction: column; gap: 20px; }
      .meta-row { display: flex; align-items: center; gap: 16px; color: var(--nl-fg); font-size: 1.1rem; }
      .meta-row ha-icon { color: var(--nl-fg-sec); }
      .desc-box { background: var(--nl-surface); padding: 16px; border-radius: 12px; color: var(--nl-fg-sec); line-height: 1.6; }
      
      .input-field { width: 100%; padding: 14px; border-radius: 12px; border: 1px solid var(--nl-border); background: var(--nl-surface); color: var(--nl-fg); box-sizing: border-box; font-family: inherit; font-size: 1rem; transition: border-color 0.2s; }
      .input-field:focus { border-color: var(--nl-accent); outline: none; }
      .row { display: flex; gap: 16px; }
      .btn-primary { background: var(--nl-accent); color: #fff; border: none; padding: 14px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 10px; font-size: 1rem; transition: transform 0.1s, opacity 0.2s; }
      .btn-primary:hover { opacity: 0.9; }
      .btn-primary:active { transform: scale(0.98); }
      .btn-primary.full { width: 100%; justify-content: center; }
      
      .fab { position: fixed; bottom: 40px; right: 40px; width: 64px; height: 64px; border-radius: 50%; background: var(--nl-accent); color: #fff; border: none; font-size: 28px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; z-index: 100; }
      .fab:hover { transform: scale(1.1); }

      /* Editor Styles */
      .editor-container {
        padding: 16px;
        font-family: var(--paper-font-body1_-_font-family);
        color: var(--primary-text-color);
      }
      .editor-section {
        background: var(--card-background-color);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 16px;
      }
      .editor-section h3 {
        margin-top: 0;
        margin-bottom: 16px;
        font-weight: 500;
        color: var(--primary-color);
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 16px;
      }
      .full-width {
        grid-column: 1 / -1;
      }
      .info-box {
        background: rgba(var(--rgb-primary-color), 0.1);
        padding: 12px;
        border-radius: 4px;
        font-size: 0.9em;
        margin-top: 8px;
        color: var(--primary-text-color);
      }

      /* Responsive */
      @media (max-width: 768px) {
        .sidebar { position: fixed; inset: 0; width: 85%; max-width: 320px; transform: translateX(-100%); z-index: 2000; box-shadow: 10px 0 25px rgba(0,0,0,0.5); }
        .menu-open .sidebar { transform: translateX(0); }
        .mobile-toggle { display: block; }
        .mobile-close { display: block; }
        .desktop-toggle { display: none; }
        .stage-header { padding-left: 60px; padding-right: 16px; }
        .header-titles h1 { font-size: 1.2rem; }
        .subtitle { font-size: 0.9rem; }
        .tg-col-head { font-size: 0.8rem; text-overflow: ellipsis; overflow: hidden; padding: 8px 2px; }
        .content-body { padding: 0 16px 16px 16px; }
      }
    `;
  }
}

class NightlightCardEditor extends LitElement {
  static get properties() { return { hass: {}, _config: {} }; }

  setConfig(config) {
    this._config = config;
    this.requestUpdate();
  }

  _updateConfig(changes) {
    this.dispatchEvent(new CustomEvent("config-changed", { 
      detail: { config: { ...this._config, ...changes } },
      bubbles: true, 
      composed: true 
    }));
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) return;
    const target = ev.target;
    const field = target.configValue; 
    const value = target.value;
    if (field) this._updateConfig({ [field]: value });
  }

  static get styles() {
      return css`
      .editor-container { padding: 16px; font-family: var(--paper-font-body1_-_font-family); }
      .editor-section { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
      .editor-section h3 { margin-top: 0; margin-bottom: 16px; font-weight: 500; color: var(--primary-color); border-bottom: 1px solid var(--divider-color); padding-bottom: 8px; }
      .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
      .full-width { grid-column: 1 / -1; }
      .info-box { background: var(--secondary-background-color); padding: 12px; border-radius: 4px; font-size: 0.9em; margin-top: 16px; border-left: 4px solid var(--primary-color); }
      `;
  }

  render() {
    if (!this.hass || !this._config) return html``;
    return html`
      <div class="editor-container">
        <div class="editor-section">
            <h3>General Settings</h3>
            <div class="form-grid">
                <ha-textfield label="Dashboard Title" .value="${this._config.title}" .configValue="${'title'}" @input="${this._valueChanged}"></ha-textfield>
                <ha-textfield label="Logo URL" .value="${this._config.logo_url}" .configValue="${'logo_url'}" @input="${this._valueChanged}"></ha-textfield>
                
                <div style="display: flex; flex-direction: column; gap: 8px;">
                   <label>Theme</label>
                   <select .value="${this._config.theme || 'light'}" @change="${(e) => this._updateConfig({theme: e.target.value})}" style="padding: 10px; border-radius: 4px; border: 1px solid var(--divider-color);">
                     <option value="light">Light Mode</option>
                     <option value="dark">Dark Mode</option>
                   </select>
                </div>
            </div>
        </div>

        <div class="editor-section">
            <h3>Integrations</h3>
            <div class="form-grid">
                <ha-entity-picker 
                    .hass="${this.hass}" 
                    label="View Controller" 
                    .value="${this._config.view_controller}" 
                    .configValue="${'view_controller'}" 
                    .includeDomains="${['input_select']}" 
                    @value-changed="${(e) => this._updateConfig({view_controller: e.detail.value})}">
                </ha-entity-picker>
                
                <ha-entity-picker 
                    .hass="${this.hass}" 
                    label="Family Notes List" 
                    .value="${this._config.notes_entity}" 
                    .configValue="${'notes_entity'}" 
                    .includeDomains="${['todo']}"
                    @value-changed="${(e) => this._updateConfig({notes_entity: e.detail.value})}">
                </ha-entity-picker>
            </div>
        </div>

        <div class="info-box">
           <strong>Advanced Configuration:</strong> Entities, Chores, Meal Plans, and Custom Navigation must be configured via YAML code editor. 
           See documentation for structure.
        </div>
      </div>
    `;
  }
}

customElements.define("nightlight-dashboard-card", NightlightDashboard);
customElements.define("nightlight-dashboard-editor", NightlightCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "nightlight-dashboard-card",
  name: "Nightlight Dashboard",
  description: "Advanced Family Hub with Calendar, Chores & Meals"
});
