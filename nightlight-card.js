/**
 * Nightlight Dashboard (v2.0.0 - Refined)
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
      _weatherEntity: { type: String }
    };
  }

  static getConfigElement() {
    return document.createElement("nightlight-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Family Hub",
      theme: "light",
      entities: [],
      chore_start: "06:00",
      chore_end: "09:00"
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
  }

  updated(changedProps) {
    // 1. Unified Hybrid Mode Handling
    if (changedProps.has('_activeView')) {
      const coreIds = ['calendar', 'meals', 'whiteboard', 'chores'];

      // Control host sizing via attribute for interaction fix
      if (coreIds.includes(this._activeView)) {
        this.setAttribute('mode', 'core');
      } else {
        this.setAttribute('mode', 'section');
      }

      // Handle View Controller Input Select
      if (this.config.view_controller && this.hass) {
        const option = coreIds.includes(this._activeView) ? "Nightlight" : this._activeView;
        // Check current state to avoid loop
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
          // Optional: intelligent refresh only if chores entities change
          // For now, keeping it simple as per original
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
          const result = await this.hass.callWS({
            type: "todo/item/list",
            entity_id: kid.todo_list,
          });
          const taggedItems = (result.items || []).map(item => {
            const newItem = JSON.parse(JSON.stringify(item));
            newItem.list_id = kid.todo_list;
            return newItem;
          });
          allItems.push(...taggedItems);
        } catch (e) {
          console.warn("Chore fetch failed for", kid.todo_list);
        }
      }
    }
    this._todoItems = allItems;
    this.requestUpdate(); // Force render
  }

  async _checkDailyReset() {
    if (!this.hass || !this.config.chores) return;
    const today = new Date().toDateString();

    if (this._lastResetDate !== today) {
      for (const kid of this.config.chores) {
        if (kid.todo_list && this.hass.states[kid.todo_list]) {
          // Fetch current items to see what is completed
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

  _getTodoStatus(entityId, taskLabel) {
    if (!this._todoItems) return false;
    const item = this._todoItems.find(i =>
      i.list_id === entityId &&
      i.summary.trim().toLowerCase() === taskLabel.trim().toLowerCase()
    );
    return item ? item.status === 'completed' : false;
  }

  async _toggleTodo(entityId, taskLabel, isDone) {
    if (!entityId) return;
    // Find the item to get its UID if possible, otherwise use summary
    const existingItem = this._todoItems.find(i => 
      i.list_id === entityId && 
      i.summary.trim().toLowerCase() === taskLabel.trim().toLowerCase()
    );

    const identifier = existingItem && existingItem.uid ? existingItem.uid : taskLabel;
    const newStatus = isDone ? 'needs_action' : 'completed';

    try {
      // Optimistic update
      this.requestUpdate(); 
      
      await this.hass.callService('todo', 'update_item', {
        entity_id: entityId,
        item: identifier,
        status: newStatus
      });
      await this._fetchChoreData();
    } catch (e) {
      console.error("Todo Toggle Failed:", e);
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

    if (this._calendarMode === 'month') {
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
            friendly_name: (stateObj && stateObj.attributes) ? stateObj.attributes.friendly_name : ent.entity
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
    if (evsCount > 2) this._calendarMode = 'day';
    else this._calendarMode = 'agenda';
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

  // --- Utility Functions ---

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
    const top = (s.getHours() * 60 + s.getMinutes()) * 1.666;
    const height = Math.max(((end - s) / 60000) * 1.666, 30);
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

    const coreIds = ['calendar', 'meals', 'whiteboard', 'chores'];
    const isCoreMode = coreIds.includes(this._activeView);
    const headerTitle = (this._activeView === 'calendar') ?
      this._referenceDate.toLocaleString('default', { month: 'long', year: 'numeric' }) :
      (this.config.title || "Family Hub");

    const coreNav = [
      { id: 'calendar', name: 'Calendar', icon: 'mdi:calendar-month' },
      { id: 'meals', name: 'Dinner', icon: 'mdi:silverware-fork-knife' },
      { id: 'whiteboard', name: 'Notes', icon: 'mdi:note-edit' },
      { id: 'chores', name: 'Chores', icon: 'mdi:check-all' }
    ];

    const customNav = this.config.navigation || [];
    const notesState = this.hass.states[this.config.notes_entity];
    const hasNewNotes = notesState ? (new Date() - new Date(notesState.last_changed)) < (60 * 60 * 1000) : false;

    return html`
      <div class="nightlight-hub ${this.config.theme} ${isCoreMode ? 'mode-core' : 'mode-section'} ${this._menuOpen ? 'menu-open' : ''}">
        
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
        </nav>

        <ha-icon-button class="mobile-toggle" @click="${() => this._menuOpen = true}">
          <ha-icon icon="mdi:menu"></ha-icon>
        </ha-icon-button>

        <!-- MAIN CONTENT AREA -->
        <main class="stage">
          <header class="stage-header">
            <div class="header-left">
              <ha-icon-button class="desktop-toggle" @click="${() => this._menuOpen = !this._menuOpen}">
                 <ha-icon icon="mdi:menu"></ha-icon>
              </ha-icon-button>
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
              ${this._activeView === 'calendar' ? html`
                  <div class="calendar-controls">
                    <div class="view-toggles">
                      ${['month', 'week', 'day', 'agenda'].map(m => html`
                        <button class="${this._calendarMode === m ? 'active' : ''}" 
                                @click="${() => { this._calendarMode = m; }}">
                          ${m}
                        </button>
                      `)}
                    </div>
                    <button class="today-btn" @click="${() => { this._referenceDate = new Date(); }}">Today</button>
                    <div class="persona-stack">
                      ${(this.config.entities || []).filter(e => e.entity.startsWith('calendar')).map(ent => html`
                        <div class="persona-dot ${this._activeCalendars.includes(ent.entity) ? 'active' : 'inactive'}" 
                             style="background: ${ent.color}" 
                             title="${ent.entity}"
                             @click="${() => this._togglePersona(ent.entity)}">
                          ${ent.picture ? html`<img src="${ent.picture}">` : ''}
                        </div>
                      `)}
                    </div>
                  </div>
              ` : ''}
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
      default: return html`<div class="placeholder-view">View: ${this._activeView} active</div>`;
    }
  }

  // --- Sub-Renderers ---

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

    // Determine Active Period
    const activePeriod = this.config.periods.find(p => {
      const [sh, sm] = p.start.split(':').map(Number);
      const [eh, em] = p.end.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      return currentMins >= start && currentMins <= end;
    });

    if (!activePeriod) return html`
      <div class="chore-center-message">
        <ha-icon icon="mdi:sleep" style="font-size: 64px; opacity: 0.5;"></ha-icon>
        <h2>No Active Chore Period</h2>
        <p>Check back later.</p>
      </div>`;

    const visibleKids = this.config.chores.filter(kid => 
      isAdmin || !kid.assigned_user || kid.assigned_user === currentUser
    );

    return html`
      <div class="chore-dashboard">
        <div class="period-badge">Current: ${activePeriod.name}</div>
        <div class="chore-grid">
          ${visibleKids.map(kid => {
             const tasks = (kid.items || []).filter(i => i.period === activePeriod.name);
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
                      const isDone = this._getTodoStatus(kid.todo_list, item.label);
                      return html`
                        <div class="task-row ${isDone ? 'completed' : ''}"
                             @click="${() => this._toggleTodo(kid.todo_list, item.label, isDone)}">
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
        <div class="cal-grid">
           ${days.map(d => {
              if (!d.date) return html`<div class="cal-day empty"></div>`;
              
              const dateStr = d.fullDate.toDateString();
              const isToday = this._isToday(d.date);
              const events = this._events.filter(e => {
                 if (!this._activeCalendars.includes(e.origin)) return false;
                 // Simple day check (not accurate for multi-day in month view for brevity, but functional)
                 const eStart = new Date(e.start.dateTime || e.start.date);
                 return eStart.toDateString() === dateStr;
              }).slice(0, 4);

              return html`
                <div class="cal-day ${isToday ? 'today' : ''}" @click="${() => this._handleMonthDayClick(d.date, events.length)}">
                   <span class="day-number">${d.date}</span>
                   <div class="day-events">
                     ${events.map(e => html`
                       <div class="evt-dot" style="background-color: ${e.color}" title="${e.summary}"></div>
                     `)}
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
    const frags = this._fragmentEvents(this._events);
    const list = frags.filter(e => this._activeCalendars.includes(e.origin) && new Date(e.displayDate) >= today)
      .sort((a,b) => new Date(a.displayDate) - new Date(b.displayDate));

    return html`
      <div class="agenda-list">
        ${list.map(e => {
           const d = new Date(e.displayDate);
           return html`
             <div class="agenda-item" @click="${() => this._selectedEvent = e}">
               <div class="agenda-date-box">
                 <span class="d-day">${d.getDate()}</span>
                 <span class="d-mon">${d.toLocaleDateString('default', {month:'short'})}</span>
               </div>
               <div class="agenda-details" style="border-left-color: ${e.color}">
                 <div class="ag-title">${e.summary}</div>
                 <div class="ag-sub">${e.friendly_name} • ${e.isAllDay ? 'All Day' : new Date(e.start.dateTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
               </div>
             </div>
           `;
        })}
      </div>`;
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
       <div class="time-grid">
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
         <div class="tg-body">
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
               <span>${new Date(this._selectedEvent.start.dateTime || this._selectedEvent.start.date).toLocaleString()}</span>
             </div>
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
        /* CSS Variables for Modern Theme */
        --nl-bg: var(--card-background-color, #fff);
        --nl-fg: var(--primary-text-color, #333);
        --nl-fg-sec: var(--secondary-text-color, #777);
        --nl-border: var(--divider-color, #e0e0e0);
        --nl-accent: var(--primary-color, #03a9f4);
        --nl-sidebar-w: 220px;
        --nl-radius: 12px;
        --nl-shadow: 0 2px 8px rgba(0,0,0,0.05);
        
        display: block;
        height: calc(100vh - 56px);
        background: var(--primary-background-color);
        font-family: var(--paper-font-body1_-_font-family);
        overflow: hidden;
      }

      /* Hybrid Mode Styling */
      :host([mode="section"]) { 
        height: auto; 
        background: transparent;
      }
      :host([mode="section"]) .sidebar,
      :host([mode="section"]) .desktop-toggle,
      :host([mode="section"]) .mobile-toggle { display: none !important; }
      :host([mode="section"]) .stage { padding: 0; }
      :host([mode="section"]) .nightlight-hub { display: block; }
      
      .nightlight-hub {
        display: flex;
        height: 100%;
        width: 100%;
      }

      /* Sidebar */
      .sidebar {
        width: var(--nl-sidebar-w);
        background: var(--nl-bg);
        border-right: 1px solid var(--nl-border);
        display: flex;
        flex-direction: column;
        padding: 16px;
        gap: 8px;
        transition: transform 0.3s ease;
        z-index: 100;
      }
      .sidebar-top {
        display: flex;
        align-items: center;
        margin-bottom: 24px;
        justify-content: space-between;
      }
      .logo ha-icon { color: var(--nl-accent); --mdc-icon-size: 32px; }
      .mobile-close { background: none; border: none; font-size: 24px; color: var(--nl-fg); display: none; cursor: pointer;}
      
      .nav-group { display: flex; flex-direction: column; gap: 4px; }
      .nav-divider { height: 1px; background: var(--nl-border); margin: 12px 0; }
      
      .nav-item {
        background: none;
        border: none;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        color: var(--nl-fg-sec);
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
        text-align: left;
        font-size: 0.95rem;
      }
      .nav-item:hover { background: rgba(0,0,0,0.03); color: var(--nl-fg); }
      .nav-item.active { background: rgba(var(--rgb-primary-color), 0.1); color: var(--nl-accent); font-weight: 600; }
      .nav-icon-container { position: relative; display: flex; align-items: center;}
      .badge { position: absolute; top: -2px; right: -2px; width: 8px; height: 8px; background: #f44336; border-radius: 50%; }

      .mobile-toggle { display: none; position: absolute; top: 10px; left: 10px; z-index: 50; }

      /* Main Stage */
      .stage { flex: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; background: var(--primary-background-color); }
      .stage-header {
        padding: 16px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--nl-bg);
        border-bottom: 1px solid var(--nl-border);
        flex-shrink: 0;
      }
      .header-left { display: flex; align-items: center; gap: 16px; }
      .desktop-toggle { margin-left: -8px; }
      .header-titles h1 { margin: 0; font-size: 1.5rem; font-weight: 600; color: var(--nl-fg); }
      .subtitle { display: flex; align-items: center; gap: 12px; color: var(--nl-fg-sec); font-size: 0.9rem; margin-top: 4px; }
      .clock { font-feature-settings: "tnum"; font-variant-numeric: tabular-nums; }
      .nav-controls button { background: none; border: 1px solid var(--nl-border); border-radius: 4px; cursor: pointer; color: var(--nl-fg); padding: 2px; }
      
      .view-toggles { background: var(--secondary-background-color); padding: 4px; border-radius: 8px; display: flex; gap: 2px; }
      .view-toggles button {
        border: none; background: none; padding: 6px 12px; border-radius: 6px; 
        font-size: 0.8rem; font-weight: 500; color: var(--nl-fg-sec); cursor: pointer; text-transform: uppercase;
      }
      .view-toggles button.active { background: var(--nl-bg); color: var(--nl-fg); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      .today-btn { background: none; border: 1px solid var(--nl-border); padding: 6px 12px; border-radius: 6px; cursor: pointer; color: var(--nl-fg); font-weight: 600; font-size: 0.8rem; margin: 0 12px; }
      
      .persona-stack { display: flex; gap: -4px; }
      .persona-dot { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--nl-bg); cursor: pointer; transition: transform 0.2s; opacity: 0.5; overflow: hidden; }
      .persona-dot.active { opacity: 1; transform: scale(1.1); z-index: 10; }
      .persona-dot img { width: 100%; height: 100%; object-fit: cover; }

      .content-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 24px; box-sizing: border-box; }

      /* Calendar Grid */
      .calendar-month { height: 100%; display: flex; flex-direction: column; background: var(--nl-bg); border-radius: var(--nl-radius); border: 1px solid var(--nl-border); overflow: hidden; }
      .cal-header-row { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; padding: 12px 0; border-bottom: 1px solid var(--nl-border); font-weight: 600; color: var(--nl-fg-sec); font-size: 0.8rem; }
      .cal-grid { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 1fr; }
      .cal-day { border-right: 1px solid var(--nl-border); border-bottom: 1px solid var(--nl-border); padding: 8px; cursor: pointer; transition: background 0.1s; display: flex; flex-direction: column; gap: 4px; }
      .cal-day:hover { background: rgba(0,0,0,0.02); }
      .cal-day.today { background: rgba(var(--rgb-primary-color), 0.05); }
      .cal-day.today .day-number { color: var(--nl-accent); font-weight: 800; }
      .day-number { font-size: 0.9rem; color: var(--nl-fg); }
      .day-events { display: flex; flex-wrap: wrap; gap: 4px; }
      .evt-dot { width: 8px; height: 8px; border-radius: 50%; }

      /* Time Grid */
      .time-grid { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--nl-border); border-radius: var(--nl-radius); background: var(--nl-bg); }
      .tg-header { display: flex; border-bottom: 1px solid var(--nl-border); }
      .tg-gutter { width: 50px; flex-shrink: 0; border-right: 1px solid var(--nl-border); }
      .tg-col-head { flex: 1; text-align: center; padding: 8px; font-weight: 600; font-size: 0.9rem; border-right: 1px solid var(--nl-border); }
      .tg-allday { display: flex; border-bottom: 2px solid var(--nl-border); min-height: 30px; }
      .tg-gutter-label { width: 50px; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; color: var(--nl-fg-sec); border-right: 1px solid var(--nl-border); }
      .tg-allday-cols { flex: 1; display: grid; }
      .tg-ad-cell { border-right: 1px solid var(--nl-border); padding: 2px; }
      .ad-pill { font-size: 0.7rem; padding: 2px 4px; border-radius: 4px; color: #fff; margin-bottom: 2px; white-space: nowrap; overflow: hidden; }
      .tg-body { flex: 1; overflow-y: auto; display: flex; position: relative; }
      .tg-time-axis { width: 50px; flex-shrink: 0; border-right: 1px solid var(--nl-border); }
      .tg-hour-marker { height: 60px; border-bottom: 1px solid transparent; position: relative; }
      .tg-hour-marker span { position: absolute; top: -6px; right: 4px; font-size: 0.7rem; color: var(--nl-fg-sec); }
      .tg-cols { flex: 1; display: grid; }
      .tg-day-col { border-right: 1px solid var(--nl-border); position: relative; height: 1440px; } /* 24 * 60 */
      .tg-grid-line { height: 60px; border-bottom: 1px solid var(--nl-border); box-sizing: border-box; }
      .tg-event { position: absolute; left: 2px; right: 2px; padding: 4px; border-radius: 4px; font-size: 0.75rem; color: #fff; overflow: hidden; cursor: pointer; z-index: 10; border: 1px solid rgba(255,255,255,0.3); }

      /* Agenda */
      .agenda-list { display: flex; flex-direction: column; gap: 8px; }
      .agenda-item { display: flex; background: var(--nl-bg); padding: 12px; border-radius: var(--nl-radius); border: 1px solid var(--nl-border); cursor: pointer; align-items: center; gap: 16px; }
      .agenda-date-box { display: flex; flex-direction: column; align-items: center; min-width: 40px; }
      .d-day { font-size: 1.4rem; font-weight: 700; color: var(--nl-fg); line-height: 1; }
      .d-mon { font-size: 0.7rem; text-transform: uppercase; color: var(--nl-fg-sec); font-weight: 600; }
      .agenda-details { border-left: 4px solid transparent; padding-left: 12px; flex: 1; }
      .ag-title { font-weight: 600; font-size: 1rem; color: var(--nl-fg); }
      .ag-sub { font-size: 0.8rem; color: var(--nl-fg-sec); margin-top: 2px; }

      /* Modules: Chores, Meals, Notes */
      .chore-dashboard { height: 100%; display: flex; flex-direction: column; }
      .period-badge { align-self: flex-end; background: var(--nl-accent); color: #fff; padding: 4px 12px; border-radius: 16px; font-size: 0.8rem; font-weight: 600; margin-bottom: 12px; }
      .chore-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
      .kid-card { background: var(--nl-bg); border-radius: 16px; overflow: hidden; border: 1px solid var(--nl-border); display: flex; flex-direction: column; }
      .kid-hero { height: 100px; background-size: cover; background-position: center; position: relative; }
      .hero-overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 12px; background: linear-gradient(transparent, rgba(0,0,0,0.7)); color: #fff; }
      .hero-overlay h3 { margin: 0; font-size: 1.2rem; }
      .task-list { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .task-row { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--secondary-background-color); border-radius: 8px; cursor: pointer; transition: all 0.2s; }
      .task-row.completed { opacity: 0.6; text-decoration: line-through; }
      .task-row.completed ha-icon { color: var(--success-color, green); }
      
      .meals-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
      .meal-card { background: var(--nl-bg); border: 1px solid var(--nl-border); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; }
      .meal-header { font-weight: 700; color: var(--nl-accent); margin-bottom: 8px; text-transform: uppercase; font-size: 0.8rem; }
      .meal-input { border: none; background: transparent; resize: none; width: 100%; font-family: inherit; font-size: 1rem; color: var(--nl-fg); outline: none; flex: 1; }

      .whiteboard-board { display: flex; flex-direction: column; height: 100%; }
      .whiteboard-tools { margin-bottom: 16px; }
      .notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
      .note-card { background: #fff9c4; padding: 16px; border-radius: 4px; box-shadow: 2px 2px 8px rgba(0,0,0,0.1); position: relative; min-height: 120px; color: #333; transform: rotate(-1deg); transition: transform 0.2s; }
      .note-card:hover { transform: scale(1.02) rotate(0deg); z-index: 5; }
      .note-close { position: absolute; top: 4px; right: 4px; background: none; border: none; cursor: pointer; opacity: 0.5; font-weight: bold; }
      .note-body { font-family: 'Comic Sans MS', cursive, sans-serif; font-size: 1.1rem; line-height: 1.4; }

      /* Modals */
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 2000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
      .modal-card { background: var(--nl-bg); width: 90%; max-width: 400px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.3); animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
      @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .modal-header { padding: 16px; display: flex; justify-content: space-between; align-items: center; color: #fff; }
      .modal-header h2 { margin: 0; font-size: 1.2rem; }
      .modal-header button { background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer; }
      .modal-content { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
      .meta-row { display: flex; align-items: center; gap: 12px; color: var(--nl-fg); }
      .input-field { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--nl-border); background: var(--secondary-background-color); color: var(--nl-fg); box-sizing: border-box; font-family: inherit; }
      .row { display: flex; gap: 12px; }
      .btn-primary { background: var(--nl-accent); color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; }
      .btn-primary.full { width: 100%; justify-content: center; }
      .fab { position: fixed; bottom: 32px; right: 32px; width: 56px; height: 56px; border-radius: 50%; background: var(--nl-accent); color: #fff; border: none; font-size: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; z-index: 100; }
      .fab:hover { transform: scale(1.1); }

      /* Responsive */
      @media (max-width: 768px) {
        .sidebar { position: fixed; inset: 0; width: 80%; max-width: 300px; transform: translateX(-100%); z-index: 2000; box-shadow: 2px 0 10px rgba(0,0,0,0.5); }
        .menu-open .sidebar { transform: translateX(0); }
        .mobile-toggle { display: block; }
        .mobile-close { display: block; }
        .desktop-toggle { display: none; }
        .stage-header { padding-left: 50px; }
        .tg-col-head { font-size: 0.7rem; text-overflow: ellipsis; overflow: hidden; }
        :host([mode="core"]) .sidebar { display: flex !important; } /* Ensure sidebar works in core mode on mobile */
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
    const field = target.configValue; // Use configValue property on standard elements
    const value = target.value;
    if (field) this._updateConfig({ [field]: value });
  }

  render() {
    if (!this.hass || !this._config) return html``;
    // Basic editor implementation for brevity - fully functional based on original logic
    return html`
      <div class="card-config">
        <h3>Dashboard Settings</h3>
        <ha-textfield label="Title" .value="${this._config.title}" .configValue="${'title'}" @input="${this._valueChanged}"></ha-textfield>
        <ha-textfield label="Logo URL" .value="${this._config.logo_url}" .configValue="${'logo_url'}" @input="${this._valueChanged}"></ha-textfield>
        
        <h3>Navigation & Control</h3>
        <ha-entity-picker .hass="${this.hass}" label="View Controller (input_select)" .value="${this._config.view_controller}" .configValue="${'view_controller'}" .includeDomains="${['input_select']}" @value-changed="${(e) => this._updateConfig({view_controller: e.detail.value})}"></ha-entity-picker>
        
        <h3>Modules</h3>
        <ha-entity-picker .hass="${this.hass}" label="Notes List (todo)" .value="${this._config.notes_entity}" @value-changed="${(e) => this._updateConfig({notes_entity: e.detail.value})}"></ha-entity-picker>
        
        <p><em>Edit YAML for advanced Kid/Chore/Meal configuration.</em></p>
      </div>
    `;
  }
}

customElements.define("nightlight-dashboard", NightlightDashboard);
customElements.define("nightlight-dashboard-editor", NightlightCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "nightlight-dashboard",
  name: "Nightlight Dashboard",
  description: "Advanced Family Hub with Calendar, Chores & Meals"
});
