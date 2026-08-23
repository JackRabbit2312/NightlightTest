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
      _themeMode: { type: String },
      _recipeSearchQuery: { type: String },
      _recipeCategoryFilter: { type: String },
      _recipePickerDate: { type: String },
      _directRecipes: { type: Array },
      _directRecipesLoading: { type: Boolean }
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
    this._optimisticShoppingUpdates = new Map();
    this._cachedShoppingDocs = [];
    this._cachedMealDocs = [];
    this._cachedRecipeDocs = [];
    this._recipeSearchQuery = '';
    this._recipeCategoryFilter = 'ALL';
    this._recipePickerDate = null;
    this._directRecipes = [];
    this._directRecipesLoading = false;
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this.config = {
      title: "Family Hub",
      theme: "light",
      logo_url: '/',
      entities: [],
      periods: [
        { name: "Morning", start: "06:00", end: "09:00" },
        { name: "Afternoon", start: "09:01", end: "17:00" },
        { name: "Evening", start: "17:01", end: "21:00" }
      ],
      chores: [],
      ...config
    };
    // Initialize active calendars if not set
    if (this._activeCalendars.length === 0 && this.config.entities && Array.isArray(this.config.entities)) {
      this._activeCalendars = this.config.entities.map(e => (typeof e === 'string' ? e : e?.entity)).filter(Boolean);
    }
    if (this.config.theme) {
      this._themeMode = this.config.theme;
    }
  }

  updated(changedProps) {
    // 1. Unified Hybrid Mode Handling
    if (changedProps.has('_activeView')) {
      const coreIds = ['calendar', 'meals', 'shopping', 'whiteboard', 'chores'];

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
      { id: 'meals', name: 'Meals', icon: 'mdi:silverware-fork-knife' },
      { id: 'shopping', name: 'Shopping', icon: 'mdi:cart-outline' },
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
        ${this._recipePickerDate ? this._renderRecipePickerModal() : ''}
      </div>
    `;
  }

  _switchView(viewId, isCustom = false) {
    const customNav = (this.config.navigation || []).find(n => n.name === viewId || n.id === viewId);
    if (customNav && customNav.path) {
      // Home Assistant internal Lovelace routing
      window.history.pushState(null, '', customNav.path);
      window.dispatchEvent(new CustomEvent('location-changed'));
      this._menuOpen = false;
      return;
    }
    if (customNav && customNav.external_url) {
      window.open(customNav.external_url, '_blank');
      this._menuOpen = false;
      return;
    }

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
      case 'shopping': return this._renderShoppingList();
      case 'whiteboard': return this._renderWhiteboard();
      case 'chores': return this._renderChoreDashboard();
      case 'calendar': 
         if (this._calendarMode === 'month') return this._renderMonthGrid();
         if (this._calendarMode === 'agenda') return this._renderAgenda();
         return this._renderTimeGrid(this._calendarMode === 'week' ? 7 : 1);
      default: {
        const customNav = (this.config.navigation || []).find(n => n.name === this._activeView || n.id === this._activeView);
        if (customNav && (customNav.url || customNav.iframe)) {
          return html`
            <div class="custom-iframe-container">
              <iframe src="${customNav.url || customNav.iframe}" class="custom-view-iframe" frameborder="0" allowfullscreen></iframe>
            </div>
          `;
        }
        return html`<div class="custom-view-container"></div>`;
      }
    }
  }

  _extractRawList(sensorObj) {
    if (!sensorObj) return [];
    const attr = sensorObj.attributes || {};
    if (Array.isArray(attr.documents)) return attr.documents;
    if (Array.isArray(attr.items)) return attr.items;
    if (Array.isArray(attr.meals)) return attr.meals;
    if (Array.isArray(attr.recipes)) return attr.recipes;
    if (Array.isArray(attr.shopping_list)) return attr.shopping_list;
    if (Array.isArray(attr.data)) return attr.data;
    if (typeof sensorObj.state === 'string') {
      try {
        const parsed = JSON.parse(sensorObj.state);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.documents)) return parsed.documents;
        if (parsed && Array.isArray(parsed.items)) return parsed.items;
      } catch (_) {}
    }
    return [];
  }

  _parseMealDoc(doc) {
    if (!doc) return null;
    // Format 1: Firestore REST structure
    if (doc.fields) {
      const f = doc.fields;
      const date = f.date?.stringValue || f.id?.stringValue || "";
      const recipeId = f.recipeId?.stringValue || f.recipe_id?.stringValue || "";
      let recipeTitle = f.recipe_title?.stringValue || "";
      let macros = null;
      let url = f.url?.stringValue || "";
      
      if (f.recipe && f.recipe.mapValue && f.recipe.mapValue.fields) {
        const rf = f.recipe.mapValue.fields;
        recipeTitle = rf.title?.stringValue || recipeTitle;
        url = rf.url?.stringValue || rf.sourceUrl?.stringValue || url;
        if (rf.macros && rf.macros.mapValue && rf.macros.mapValue.fields) {
          const mf = rf.macros.mapValue.fields;
          macros = {
            cal: mf.calories?.integerValue || mf.calories?.doubleValue || 0,
            pro: mf.protein?.integerValue || mf.protein?.doubleValue || 0,
            carbs: mf.carbs?.integerValue || mf.carbs?.doubleValue || 0,
            fat: mf.fat?.integerValue || mf.fat?.doubleValue || 0
          };
        }
      }
      if (!macros && f.macros && f.macros.mapValue && f.macros.mapValue.fields) {
        const mf = f.macros.mapValue.fields;
        macros = {
          cal: mf.calories?.integerValue || mf.calories?.doubleValue || 0,
          pro: mf.protein?.integerValue || mf.protein?.doubleValue || 0,
          carbs: mf.carbs?.integerValue || mf.carbs?.doubleValue || 0,
          fat: mf.fat?.integerValue || mf.fat?.doubleValue || 0
        };
      }
      if (!macros && (f.calories || f.protein || f.carbs || f.fat)) {
        macros = {
          cal: f.calories?.integerValue || f.calories?.doubleValue || 0,
          pro: f.protein?.integerValue || f.protein?.doubleValue || 0,
          carbs: f.carbs?.integerValue || f.carbs?.doubleValue || 0,
          fat: f.fat?.integerValue || f.fat?.doubleValue || 0
        };
      }
      return { id: date, date, recipeId, recipeTitle, macros, url };
    }

    // Format 2: Clean Standard REST JSON
    const date = doc.date || doc.id || "";
    const recipeId = doc.recipeId || doc.recipe_id || "";
    let recipeTitle = doc.recipeTitle || doc.recipe_title || doc.title || (doc.recipe && doc.recipe.title) || "";
    let url = doc.url || doc.link || doc.sourceUrl || (doc.recipe && (doc.recipe.url || doc.recipe.link)) || "";
    let macros = null;
    if (doc.macros) {
      macros = {
        cal: Number(doc.macros.cal || doc.macros.calories || 0),
        pro: Number(doc.macros.pro || doc.macros.protein || 0),
        carbs: Number(doc.macros.carbs || 0),
        fat: Number(doc.macros.fat || 0)
      };
    } else if (doc.calories !== undefined || doc.protein !== undefined) {
      macros = {
        cal: Number(doc.calories || 0),
        pro: Number(doc.protein || 0),
        carbs: Number(doc.carbs || 0),
        fat: Number(doc.fat || 0)
      };
    }
    return { id: date, date, recipeId, recipeTitle, macros, url };
  }

  _parseRecipeDoc(doc) {
    if (!doc) return null;
    if (doc.fields) {
      const f = doc.fields;
      const id = f.id?.stringValue || "";
      const title = f.title?.stringValue || f.name?.stringValue || "Unknown Recipe";
      const url = f.url?.stringValue || f.sourceUrl?.stringValue || f.link?.stringValue || "";
      const prepTime = f.prepTime?.integerValue || f.prep_time?.integerValue || 0;
      const cookTime = f.cookTime?.integerValue || f.cook_time?.integerValue || 0;
      const servings = f.servings?.integerValue || 2;
      let macros = null;
      if (f.macros && f.macros.mapValue && f.macros.mapValue.fields) {
        const mf = f.macros.mapValue.fields;
        macros = {
          calories: mf.calories?.integerValue || 0,
          protein: mf.protein?.integerValue || 0,
          carbs: mf.carbs?.integerValue || 0,
          fat: mf.fat?.integerValue || 0
        };
      }
      return { id, title, url, prepTime, cookTime, servings, macros };
    }
    return {
      id: doc.id || "",
      title: doc.title || doc.name || "Unknown Recipe",
      url: doc.url || doc.link || doc.sourceUrl || "",
      prepTime: Number(doc.prepTime || doc.prep_time || 0),
      cookTime: Number(doc.cookTime || doc.cook_time || 0),
      servings: Number(doc.servings || 2),
      macros: doc.macros || {
        calories: Number(doc.calories || 0),
        protein: Number(doc.protein || 0),
        carbs: Number(doc.carbs || 0),
        fat: Number(doc.fat || 0)
      }
    };
  }

  _renderMealPlanner() {
    const mealSensorId = this.config.meals_sensor || 'sensor.meal_planner_weekly_meals';
    const weeklyMealsSensor = this.hass.states[mealSensorId];
    const rawMeals = this._extractRawList(weeklyMealsSensor);
    if (rawMeals.length > 0) this._cachedMealDocs = rawMeals;

    const mealsByDate = {};
    (this._cachedMealDocs || []).forEach(doc => {
      const parsed = this._parseMealDoc(doc);
      if (parsed && parsed.date) {
        mealsByDate[parsed.date] = parsed;
      }
    });

    const recipeSensorId = this.config.recipes_sensor || 'sensor.meal_planner_recipes';
    const recipesSensor = this.hass.states[recipeSensorId];
    const rawRecipes = this._extractRawList(recipesSensor);
    if (rawRecipes.length > 0) this._cachedRecipeDocs = rawRecipes;

    // Merge sensor recipes with directly synced/fetched browser recipes
    const combinedMap = new Map();
    (this._cachedRecipeDocs || []).forEach(d => {
      const parsed = this._parseRecipeDoc(d);
      if (parsed && parsed.id) combinedMap.set(parsed.id, parsed);
    });
    (this._directRecipes || []).forEach(r => {
      if (r && r.id) combinedMap.set(r.id, r);
    });

    const recipes = Array.from(combinedMap.values()).sort((a, b) => a.title.localeCompare(b.title));

    // Generate current week (Monday to Sunday)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday
    const diffToMonday = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diffToMonday);

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDays.push(d);
    }

    const websiteUrl = this.config.website_url;

    return html`
      <div class="meals-header-bar">
        <div class="meals-sync-info">
          <span class="recipe-count-badge">
            <ha-icon icon="mdi:book-open-page-variant-outline" style="--mdc-icon-size: 16px;"></ha-icon>
            ${recipes.length} Website Recipes Available
          </span>
          ${this._directRecipesLoading ? html`<span class="syncing-indicator"><ha-icon icon="mdi:loading" class="spin-icon"></ha-icon> Syncing recipes...</span>` : ''}
        </div>
        <div class="meals-actions">
          <button class="btn-meals-action" @click="${() => this._syncRecipesFromWebsite()}" title="Trigger Home Assistant to refresh the recipe sensor and catalog">
            <ha-icon icon="mdi:cloud-sync-outline" style="--mdc-icon-size: 18px;"></ha-icon>
            <span>Refresh Catalog</span>
          </button>
          ${websiteUrl ? html`
            <a href="${websiteUrl}" target="_blank" rel="noopener noreferrer" class="btn-meals-action link" title="Open Recipe Website">
              <ha-icon icon="mdi:open-in-new" style="--mdc-icon-size: 18px;"></ha-icon>
              <span>Open Website</span>
            </a>
          ` : ''}
        </div>
      </div>

      <div class="meals-container">
        ${weekDays.map(d => {
          const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          const dayName = d.toLocaleDateString('default', { weekday: 'long' });
          const isToday = d.toDateString() === today.toDateString();
          const meal = mealsByDate[dateStr];
          
          let recipeTitle = meal?.recipeTitle || "";
          let macros = meal?.macros || null;
          let isCustom = meal?.recipeId && meal.recipeId.startsWith('custom_');
          let selectedRecipe = recipes.find(r => r.id === meal?.recipeId);
          
          let recipeUrl = selectedRecipe?.url || meal?.url;
          if (!recipeUrl && meal?.recipeId && !isCustom && this.config.website_url) {
            recipeUrl = `${this.config.website_url.replace(/\/$/, '')}/recipe/${meal.recipeId}`;
          }

          if (selectedRecipe && !recipeTitle) {
            recipeTitle = selectedRecipe.title;
          }
          if (selectedRecipe && !macros && selectedRecipe.macros) {
            macros = {
              cal: selectedRecipe.macros.calories || 0,
              pro: selectedRecipe.macros.protein || 0,
              carbs: selectedRecipe.macros.carbs || 0,
              fat: selectedRecipe.macros.fat || 0
            };
          }

          return html`
            <div class="meal-card ${isToday ? 'today' : ''}">
              <div class="meal-header">
                <span>${dayName}</span>
                <span class="meal-date">${d.toLocaleDateString('default', { month: 'short', day: 'numeric' })}</span>
              </div>
              
              <div class="meal-content">
                <div class="meal-picker-box">
                  <div class="meal-current-display">
                    ${meal && meal.recipeId ? html`
                      <div class="meal-title-row">
                        <span class="meal-active-title" title="${recipeTitle}">${isCustom ? '🍽️ ' : '📖 '}<strong>${recipeTitle}</strong></span>
                        ${recipeUrl ? html`
                          <a href="${recipeUrl}" target="_blank" rel="noopener noreferrer" title="View Recipe on Website" class="meal-link-btn">
                            <ha-icon icon="mdi:open-in-new" style="--mdc-icon-size: 20px;"></ha-icon>
                          </a>
                        ` : ''}
                      </div>
                    ` : html`
                      <span class="meal-empty-title">No meal planned</span>
                    `}
                  </div>

                  <div class="meal-button-row">
                    <button class="btn-meal-search" @click="${() => this._openRecipePicker(dateStr)}" title="Search & Pick from All Recipes">
                      <ha-icon icon="mdi:magnify" style="--mdc-icon-size: 18px;"></ha-icon>
                      <span>${meal && meal.recipeId ? 'Change Meal...' : 'Search All Recipes...'}</span>
                    </button>
                    ${meal && meal.recipeId ? html`
                      <button class="btn-meal-clear" @click="${() => this._scheduleMeal(dateStr, '')}" title="Clear planned meal">
                        <ha-icon icon="mdi:close" style="--mdc-icon-size: 16px;"></ha-icon>
                      </button>
                    ` : ''}
                  </div>
                </div>
                
                ${macros ? html`
                  <div class="meal-macros">
                    <span class="macro cal">${macros.cal} kcal</span>
                    <span class="macro pro">${macros.pro}g P</span>
                    <span class="macro carbs">${macros.carbs}g C</span>
                    <span class="macro fat">${macros.fat}g F</span>
                  </div>
                ` : ''}
              </div>
            </div>`;
        })}
      </div>`;
  }

  _openRecipePicker(dateStr) {
    this._recipePickerDate = dateStr;
    this._recipeSearchQuery = '';
    this._recipeCategoryFilter = 'ALL';
    this.requestUpdate();
  }

  _closeRecipePicker() {
    this._recipePickerDate = null;
    this._recipeSearchQuery = '';
    this.requestUpdate();
  }

  async _syncRecipesFromWebsite() {
    if (this._directRecipesLoading) return;
    this._directRecipesLoading = true;
    this.requestUpdate();

    const recipeSensorId = this.config.recipes_sensor || 'sensor.meal_planner_recipes';

    // Refresh the sensor via Home Assistant server-side (avoids browser CORS completely)
    if (this.hass) {
      try {
        await this.hass.callService('homeassistant', 'update_entity', { entity_id: recipeSensorId });
      } catch (e) {
        console.warn("HA recipe sensor refresh:", e);
      }
    }

    setTimeout(() => {
      this._directRecipesLoading = false;
      this.requestUpdate();
    }, 1200);
  }

  async _scheduleMeal(dateStr, recipeId) {
    const mealSensorId = this.config.meals_sensor || 'sensor.meal_planner_weekly_meals';
    const recipeSensorId = this.config.recipes_sensor || 'sensor.meal_planner_recipes';

    if (recipeId === 'custom') {
      const customName = prompt("Enter custom meal name:");
      if (!customName || !customName.trim()) {
        this.requestUpdate();
        return;
      }
      const customId = 'custom_' + Date.now();
      await this.hass.callService('rest_command', 'meal_planner_upsert_weekly_meal', {
        id: dateStr,
        date: dateStr,
        recipe_id: customId,
        recipe_title: customName.trim(),
        prep_time: 0,
        cook_time: 0,
        servings: 1,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0
      });
    } else if (!recipeId) {
      await this.hass.callService('rest_command', 'meal_planner_delete_weekly_meal', { id: dateStr, date: dateStr });
    } else {
      const recipesSensor = this.hass.states[recipeSensorId];
      const rawRecipes = this._extractRawList(recipesSensor);
      const combinedMap = new Map();
      rawRecipes.map(d => this._parseRecipeDoc(d)).filter(Boolean).forEach(r => combinedMap.set(r.id, r));
      (this._directRecipes || []).forEach(r => combinedMap.set(r.id, r));
      
      const recipe = combinedMap.get(recipeId);
      
      if (recipe) {
        await this.hass.callService('rest_command', 'meal_planner_upsert_weekly_meal', {
          id: dateStr,
          date: dateStr,
          recipe_id: recipeId,
          recipe_title: recipe.title || "",
          prep_time: recipe.prepTime || 0,
          cook_time: recipe.cookTime || 0,
          servings: recipe.servings || 2,
          calories: recipe.macros?.calories || 0,
          protein: recipe.macros?.protein || 0,
          carbs: recipe.macros?.carbs || 0,
          fat: recipe.macros?.fat || 0
        });
      }
    }
    
    setTimeout(() => {
      this.hass.callService('homeassistant', 'update_entity', { entity_id: mealSensorId });
    }, 800);
  }

  _renderRecipePickerModal() {
    if (!this._recipePickerDate) return '';

    const recipeSensorId = this.config.recipes_sensor || 'sensor.meal_planner_recipes';
    const recipesSensor = this.hass.states[recipeSensorId];
    const rawRecipes = this._extractRawList(recipesSensor);

    const combinedMap = new Map();
    rawRecipes.map(d => this._parseRecipeDoc(d)).filter(Boolean).forEach(r => combinedMap.set(r.id, r));
    (this._directRecipes || []).forEach(r => combinedMap.set(r.id, r));

    const allRecipes = Array.from(combinedMap.values()).sort((a, b) => a.title.localeCompare(b.title));

    // Extract categories / tags
    const categoriesSet = new Set(['ALL']);
    allRecipes.forEach(r => {
      if (Array.isArray(r.tags)) {
        r.tags.forEach(t => categoriesSet.add(t));
      }
      if (r.category) categoriesSet.add(r.category);
    });
    const categories = Array.from(categoriesSet);

    const query = (this._recipeSearchQuery || '').toLowerCase().trim();
    const catFilter = this._recipeCategoryFilter || 'ALL';

    const filtered = allRecipes.filter(r => {
      const matchQuery = !query || 
        r.title.toLowerCase().includes(query) ||
        (r.tags && r.tags.some(t => t.toLowerCase().includes(query))) ||
        (r.category && r.category.toLowerCase().includes(query));
      
      const matchCat = catFilter === 'ALL' ||
        (r.tags && r.tags.includes(catFilter)) ||
        r.category === catFilter;

      return matchQuery && matchCat;
    });

    const targetDate = new Date(this._recipePickerDate + 'T00:00:00');
    const formattedDate = targetDate.toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' });

    return html`
      <div class="modal-overlay" @click="${() => this._closeRecipePicker()}">
        <div class="modal-card recipe-search-modal" @click="${e => e.stopPropagation()}">
          <div class="modal-header" style="background: var(--nl-accent);">
            <div>
              <h2>Select Meal for ${formattedDate}</h2>
              <p style="margin: 4px 0 0 0; font-size: 0.85rem; opacity: 0.9;">Search all ${allRecipes.length} recipes from your catalog</p>
            </div>
            <button @click="${() => this._closeRecipePicker()}">✕</button>
          </div>

          <div class="modal-content recipe-picker-body">
            <!-- Search & Quick Action Bar -->
            <div class="recipe-search-toolbar">
              <div class="recipe-search-input-wrap">
                <ha-icon icon="mdi:magnify" style="--mdc-icon-size: 20px; color: var(--nl-fg-sec);"></ha-icon>
                <input 
                  type="text" 
                  class="recipe-search-input" 
                  placeholder="Search recipes, ingredients, tags (e.g. Curry, High-Protein, Beef)..."
                  .value="${this._recipeSearchQuery}"
                  @input="${(e) => { this._recipeSearchQuery = e.target.value; this.requestUpdate(); }}"
                  autofocus
                />
                ${this._recipeSearchQuery ? html`
                  <button class="clear-search-btn" @click="${() => { this._recipeSearchQuery = ''; this.requestUpdate(); }}">✕</button>
                ` : ''}
              </div>

              <button class="btn-sync-inline" @click="${() => this._syncRecipesFromWebsite()}" title="Refresh recipe catalog from Home Assistant">
                <ha-icon icon="mdi:refresh" class="${this._directRecipesLoading ? 'spin-icon' : ''}" style="--mdc-icon-size: 18px;"></ha-icon>
                <span>Refresh</span>
              </button>
            </div>

            <!-- Categories / Tags Filter -->
            ${categories.length > 1 ? html`
              <div class="recipe-tags-scroll">
                ${categories.map(c => html`
                  <button 
                    class="recipe-tag-pill ${catFilter === c ? 'active' : ''}"
                    @click="${() => { this._recipeCategoryFilter = c; this.requestUpdate(); }}">
                    ${c}
                  </button>
                `)}
              </div>
            ` : ''}

            <!-- Quick Add Custom Option -->
            <div class="recipe-custom-prompt" @click="${() => { const date = this._recipePickerDate; this._closeRecipePicker(); this._scheduleMeal(date, 'custom'); }}">
              <div class="custom-icon">✏️</div>
              <div class="custom-text">
                <strong>Add a Custom / One-off Meal...</strong>
                <span>Type in a custom title not currently in your recipe catalog</span>
              </div>
            </div>

            <!-- Recipes List -->
            <div class="recipes-results-list no-scrollbar">
              ${filtered.length === 0 ? html`
                <div class="no-recipes-found">
                  <ha-icon icon="mdi:food-off-outline" style="--mdc-icon-size: 40px; color: var(--nl-fg-sec);"></ha-icon>
                  <p>No recipes found matching "<strong>${this._recipeSearchQuery}</strong>"</p>
                  <button class="btn-primary" style="margin-top: 8px;" @click="${() => { const date = this._recipePickerDate; this._closeRecipePicker(); this._scheduleMeal(date, 'custom'); }}">
                    ✏️ Enter "${this._recipeSearchQuery}" as Custom Meal
                  </button>
                </div>
              ` : filtered.map(r => {
                let recipeUrl = r.url;
                if (!recipeUrl && this.config.website_url) {
                  recipeUrl = `${this.config.website_url.replace(/\/$/, '')}/recipe/${r.id}`;
                }

                return html`
                  <div class="recipe-result-item" @click="${() => { const date = this._recipePickerDate; this._closeRecipePicker(); this._scheduleMeal(date, r.id); }}">
                    <div class="recipe-result-info">
                      <div class="recipe-result-title-row">
                        <span class="recipe-result-title">${r.title}</span>
                        ${recipeUrl ? html`
                          <a href="${recipeUrl}" target="_blank" rel="noopener noreferrer" class="recipe-result-ext-link" @click="${(e) => e.stopPropagation()}" title="View Recipe on Website">
                            <ha-icon icon="mdi:open-in-new" style="--mdc-icon-size: 18px;"></ha-icon>
                          </a>
                        ` : ''}
                      </div>

                      <div class="recipe-result-meta">
                        ${(r.prepTime || r.cookTime) ? html`
                          <span class="recipe-meta-pill">
                            <ha-icon icon="mdi:clock-outline" style="--mdc-icon-size: 14px;"></ha-icon>
                            ${(r.prepTime || 0) + (r.cookTime || 0)} min
                          </span>
                        ` : ''}
                        ${r.servings ? html`
                          <span class="recipe-meta-pill">
                            <ha-icon icon="mdi:account-group-outline" style="--mdc-icon-size: 14px;"></ha-icon>
                            ${r.servings} srv
                          </span>
                        ` : ''}
                        ${r.macros?.calories ? html`
                          <span class="recipe-meta-pill cal">${r.macros.calories} kcal</span>
                        ` : ''}
                        ${r.macros?.protein ? html`
                          <span class="recipe-meta-pill pro">${r.macros.protein}g P</span>
                        ` : ''}
                      </div>
                    </div>
                    <button class="recipe-pick-btn" title="Schedule this recipe">Select</button>
                  </div>
                `;
              })}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _inferCategory(name) {
    const lower = (name || '').toLowerCase();
    if (/apple|banana|berry|berries|lettuce|salad|tomato|onion|garlic|potato|carrot|spinach|avocado|lemon|lime|cucumber|pepper|broccoli|fruit|veg|herb|cilantro|parsley|basil/i.test(lower)) return 'Produce';
    if (/milk|cheese|butter|yogurt|cream|egg|eggs|parmesan|cheddar|mozzarella/i.test(lower)) return 'Dairy & Eggs';
    if (/chicken|beef|pork|steak|salmon|fish|turkey|bacon|sausage|meat|tuna|shrimp|prawn/i.test(lower)) return 'Meat & Seafood';
    if (/bread|bagel|buns|tortilla|croissant|pita|roll|bakery|pastry/i.test(lower)) return 'Bakery';
    if (/salt|pepper|paprika|cumin|oregano|curry powder|chili powder|cinnamon|spice|seasoning|seasonings/i.test(lower)) return 'Spices & Seasonings';
    if (/pasta|rice|flour|sugar|oil|vinegar|sauce|can|canned|beans|oats|cereal|broth|stock/i.test(lower)) return 'Pantry';
    if (/frozen|ice cream|pizza|peas|waffles/i.test(lower)) return 'Frozen';
    if (/water|juice|coffee|tea|soda|beer|wine|coke/i.test(lower)) return 'Beverages';
    if (/soap|detergent|paper towel|tissue|foil|trash|cleaner/i.test(lower)) return 'Household';
    return 'Other';
  }

  _renderShoppingList() {
    const shoppingSensorId = this.config.shopping_sensor || 'sensor.meal_planner_shopping_list';
    const shoppingSensor = this.hass.states[shoppingSensorId];
    const rawDocs = this._extractRawList(shoppingSensor);
    if (rawDocs.length > 0) this._cachedShoppingDocs = rawDocs;

    const items = (this._cachedShoppingDocs || []).map(doc => {
      let id = "";
      let rawName = "Unknown";
      let preparation = "";
      let category = "";
      let amount = 1;
      let unit = "";
      let checked = false;

      // Firestore REST structure
      if (doc.fields) {
        const f = doc.fields;
        id = f.id?.stringValue || "";
        rawName = f.name?.stringValue || "Unknown";
        preparation = f.preparation?.stringValue || "";
        category = f.category?.stringValue || f.department?.stringValue || "";
        amount = f.metricAmount?.doubleValue ?? f.metricAmount?.integerValue ?? f.amount?.doubleValue ?? f.amount?.integerValue ?? 1;
        unit = f.metricUnit?.stringValue || f.unit?.stringValue || "";
        checked = f.checked?.booleanValue ?? (f.checked?.stringValue === 'true');
      } else {
        // Standard clean REST JSON
        id = String(doc.id || "");
        rawName = doc.name || doc.title || "Unknown";
        preparation = doc.preparation || "";
        category = doc.category || doc.department || "";
        amount = typeof doc.metricAmount === 'number' ? doc.metricAmount : (typeof doc.amount === 'number' ? doc.amount : 1);
        unit = doc.metricUnit || doc.unit || "";
        checked = Boolean(doc.checked === true || doc.checked === 'true' || doc.completed === true);
      }

      let displayName = rawName;
      const match = (typeof rawName === 'string') ? rawName.match(/^\[(.*?)\]\s*(.*)$/) : null;
      if (match) {
        if (!category) category = match[1];
        displayName = match[2];
      }

      // Standard category normalization
      if (category === "Dairy" || category === "Eggs") {
        category = "Dairy & Eggs";
      }

      if (!category || category === "Other") {
        category = this._inferCategory(displayName);
      }

      // Title case
      if (typeof category === 'string') {
        category = category.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }

      // Apply optimistic update
      if (id && this._optimisticShoppingUpdates.has(id)) {
        checked = this._optimisticShoppingUpdates.get(id);
      }

      return {
        id: id || ('item-' + displayName),
        rawName: rawName,
        name: displayName,
        preparation: preparation,
        department: category || "Other",
        amount: amount,
        unit: unit,
        checked: checked
      };
    });

    // Sort: unchecked first, then department, then alphabetical
    items.sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      if (a.department === "Other" && b.department !== "Other") return 1;
      if (b.department === "Other" && a.department !== "Other") return -1;
      if (a.department !== b.department) return a.department.localeCompare(b.department);
      return a.name.localeCompare(b.name);
    });

    const hasCheckedItems = items.some(i => i.checked);

    return html`
      <div class="shopping-container">
        <div class="shopping-add">
          <input type="text" id="new_shopping_item" placeholder="Add item (e.g. 2L Milk, 500g Chicken, Apples)..." @keydown="${(e) => e.key === 'Enter' && this._addShoppingItem(e.target.value)}">
          <button class="btn-primary" @click="${() => {
            const input = this.shadowRoot.getElementById('new_shopping_item');
            this._addShoppingItem(input.value);
            input.value = '';
          }}">Add</button>
          <button class="btn-primary" style="background: var(--nl-surface); color: var(--nl-fg); border: 1px solid var(--nl-border); padding: 14px; width: auto;" @click="${() => this._refreshShoppingList()}" title="Refresh List">
            <ha-icon icon="mdi:refresh"></ha-icon>
          </button>
        </div>

        ${hasCheckedItems ? html`
          <div style="display: flex; justify-content: flex-end;">
            <button class="clear-checked-btn" @click="${() => this._clearCompletedShoppingItems(items.filter(i => i.checked))}">
              <ha-icon icon="mdi:check-all" style="--mdc-icon-size: 16px; margin-right: 4px;"></ha-icon> Clear Completed
            </button>
          </div>
        ` : ''}

        <div class="shopping-list">
          ${items.map((item, index) => {
            const showDept = index === 0 || 
                             (item.checked !== items[index - 1].checked) || 
                             (!item.checked && item.department !== items[index - 1].department);
            
            let displayUnit = item.unit === 'approx value' ? '' : (item.unit || '');
            let showMeta = item.amount > 1 || displayUnit !== '';
            let metaText = `${item.amount} ${displayUnit}`.trim();
            if (item.amount <= 1 && displayUnit === '') {
                showMeta = false;
            }
            
            return html`
              ${showDept ? html`<div class="shopping-dept-header ${item.checked ? 'checked' : ''}">${item.checked ? 'Completed' : item.department}</div>` : ''}
              <div class="shopping-item ${item.checked ? 'checked' : ''}">
                <div class="shopping-item-left" @click="${() => this._toggleShoppingItem(item)}">
                  <ha-icon icon="${item.checked ? 'mdi:checkbox-marked-circle' : 'mdi:checkbox-blank-circle-outline'}"></ha-icon>
                  <span class="shopping-item-name">${item.name}</span>
                  ${item.preparation ? html`<span style="font-size: 0.75rem; color: var(--nl-fg-sec); font-style: italic; margin-left: 4px;">(${item.preparation})</span>` : ''}
                  ${showMeta ? html`<span class="shopping-item-meta">${metaText}</span>` : ''}
                </div>
                <button class="shopping-item-delete" @click="${() => this._deleteShoppingItem(item.id)}" title="Delete Item">
                  <ha-icon icon="mdi:delete-outline"></ha-icon>
                </button>
              </div>
            `;
          })}
          ${items.length === 0 ? html`<div class="empty-state">Shopping list is empty. Add an item above.</div>` : ''}
        </div>
      </div>
    `;
  }

  async _refreshShoppingList() {
    const shoppingSensorId = this.config.shopping_sensor || 'sensor.meal_planner_shopping_list';
    await this.hass.callService('homeassistant', 'update_entity', { entity_id: shoppingSensorId });
  }

  async _clearCompletedShoppingItems(completedItems) {
    for (const item of completedItems) {
      await this.hass.callService('rest_command', 'meal_planner_delete_shopping_item', { id: item.id });
    }
    setTimeout(() => {
      this._refreshShoppingList();
    }, 500);
  }

  async _addShoppingItem(name) {
    if (!name || !name.trim()) return;
    
    let raw = name.trim();
    let amount = 1;
    let unit = "";
    let parsedName = raw;
    let category = "Other";

    const KNOWN_UNITS = new Set([
      "g", "kg", "ml", "l", "cup", "cups", "tbsp", "tsp", "tablespoon", "tablespoons", "teaspoon", "teaspoons", 
      "oz", "lb", "pinch", "dash", "handful", "clove", "cloves", "bunch", "sprig", "sprigs", "slice", "slices", 
      "can", "tin", "packet", "head", "stalk", "stalks", "piece", "pieces", "whole", "half", "quarter", "cm", "inch",
      "jar", "bottle", "drop", "drops", "scoop", "scoops", "sheet", "sheets", "strip", "strips", "knob"
    ]);

    // Match mixed fractions like 1 1/2
    const mixedFractionMatch = raw.match(/^(\d+)\s+(\d+)\/(\d+)\s+([a-zA-Z]+)?\s*(.*)$/);
    // Match fractions like 1/2, 1/4
    const fractionMatch = raw.match(/^(\d+)\/(\d+)\s+([a-zA-Z]+)?\s*(.*)$/);
    
    if (mixedFractionMatch) {
      amount = parseInt(mixedFractionMatch[1]) + (parseInt(mixedFractionMatch[2]) / parseInt(mixedFractionMatch[3]));
      const potentialUnit = (mixedFractionMatch[4] || "").toLowerCase();
      if (KNOWN_UNITS.has(potentialUnit)) {
        unit = potentialUnit;
        parsedName = mixedFractionMatch[5];
      } else {
        unit = "";
        // If there's no unit, mixedFractionMatch[4] might be undefined, so we need to handle it carefully
        parsedName = (mixedFractionMatch[4] ? mixedFractionMatch[4] + " " : "") + (mixedFractionMatch[5] || "");
      }
    } else if (fractionMatch) {
      amount = parseInt(fractionMatch[1]) / parseInt(fractionMatch[2]);
      const potentialUnit = (fractionMatch[3] || "").toLowerCase();
      if (KNOWN_UNITS.has(potentialUnit)) {
        unit = potentialUnit;
        parsedName = fractionMatch[4];
      } else {
        unit = "";
        parsedName = (fractionMatch[3] ? fractionMatch[3] + " " : "") + (fractionMatch[4] || "");
      }
    } else {
      // Match decimals or integers with optional units attached (like 300g) or separated (like 3 tbsp)
      // Also handles "Carrot - 1" by looking for numbers at the end if the start doesn't match
      const match = raw.match(/^([\d.]+)\s*([a-zA-Z]+)?\s*(.*)$/);
      const reverseMatch = raw.match(/^(.*?)\s*-\s*([\d.]+)$/); // Matches "Carrot - 1" or "Carrot - 1.5"

      if (reverseMatch) {
        amount = parseFloat(reverseMatch[2]);
        unit = "";
        parsedName = reverseMatch[1];
      } else if (match) {
        amount = parseFloat(match[1]);
        const potentialUnit = (match[2] || "").toLowerCase();
        if (KNOWN_UNITS.has(potentialUnit)) {
          unit = potentialUnit;
          parsedName = match[3] || "";
        } else {
          unit = "";
          // Crucial fix: if potentialUnit is NOT a known unit, it's part of the name.
          // We must ensure we don't concatenate undefined objects.
          const part1 = match[2] ? match[2] + " " : "";
          const part2 = match[3] || "";
          parsedName = part1 + part2;
        }
      } else {
        // Handle "Pinch of ..."
        const pinchMatch = raw.match(/^pinch of\s+(.*)$/i);
        if (pinchMatch) {
          amount = 1;
          unit = "pinch";
          parsedName = pinchMatch[1];
        } else if (raw.toLowerCase().startsWith("splash of ")) {
          amount = 1;
          unit = "splash";
          parsedName = raw.substring(10);
        } else if (raw.toLowerCase().startsWith("handful of ")) {
          amount = 1;
          unit = "handful";
          parsedName = raw.substring(11);
        }
      }
    }

    // Final cleanup of the parsed name
    parsedName = parsedName.trim();
    if (!parsedName) {
        parsedName = raw; // Fallback if parsing completely stripped the name
    }

    const id = 'item-' + Date.now();
    const shoppingSensorId = this.config.shopping_sensor || 'sensor.meal_planner_shopping_list';
    await this.hass.callService('rest_command', 'meal_planner_upsert_shopping_item', {
      id: id,
      name: parsedName.trim(),
      category: category,
      amount: amount,
      unit: unit,
      checked: "false"
    });
    setTimeout(() => {
      this.hass.callService('homeassistant', 'update_entity', { entity_id: shoppingSensorId });
    }, 1000);
  }

  async _toggleShoppingItem(item) {
    const shoppingSensorId = this.config.shopping_sensor || 'sensor.meal_planner_shopping_list';
    // Optimistic UI Update - feels instant!
    this._optimisticShoppingUpdates.set(item.id, !item.checked);
    this.requestUpdate();

    try {
      // Use the upsert command since we have all the data and we know it handles booleans correctly
      await this.hass.callService('rest_command', 'meal_planner_upsert_shopping_item', {
        id: item.id,
        name: item.rawName,
        category: item.department,
        amount: item.amount,
        unit: item.unit,
        checked: !item.checked ? "true" : "false"
      });
      
      setTimeout(() => {
        this._refreshShoppingList();
      }, 1000);

      // Clear optimistic state after a few seconds to rely on real data again
      setTimeout(() => {
        this._optimisticShoppingUpdates.delete(item.id);
        this.requestUpdate();
      }, 4000);

    } catch (e) {
      console.error("Failed to toggle shopping item:", e);
      // Revert optimistic update on failure
      this._optimisticShoppingUpdates.delete(item.id);
      this.requestUpdate();
    }
  }

  async _deleteShoppingItem(id) {
    const shoppingSensorId = this.config.shopping_sensor || 'sensor.meal_planner_shopping_list';
    await this.hass.callService('rest_command', 'meal_planner_delete_shopping_item', {
      id: id
    });
    setTimeout(() => {
      this.hass.callService('homeassistant', 'update_entity', { entity_id: shoppingSensorId });
    }, 1000);
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
      
      .meals-header-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
      .meals-sync-info { display: flex; align-items: center; gap: 12px; }
      .recipe-count-badge { display: inline-flex; align-items: center; gap: 6px; background: var(--nl-surface); border: 1px solid var(--nl-border); padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; color: var(--nl-fg); }
      .syncing-indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--nl-accent); font-weight: 500; }
      .spin-icon { animation: spin 1.2s linear infinite; }
      @keyframes spin { 100% { transform: rotate(360deg); } }
      .meals-actions { display: flex; gap: 10px; align-items: center; }
      .btn-meals-action { display: inline-flex; align-items: center; gap: 6px; background: var(--nl-surface); border: 1px solid var(--nl-border); padding: 8px 14px; border-radius: 10px; color: var(--nl-fg); font-size: 0.85rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: all 0.2s; }
      .btn-meals-action:hover { background: var(--nl-bg); border-color: var(--nl-accent); color: var(--nl-accent); }

      .meals-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
      .meal-card { background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: 20px; padding: 20px; display: flex; flex-direction: column; box-shadow: var(--nl-shadow); transition: transform 0.2s; min-height: 190px; }
      .meal-card:hover { transform: translateY(-4px); }
      .meal-header { display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: var(--nl-accent); margin-bottom: 12px; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 1px; }
      .meal-date { color: var(--nl-fg-sec); font-weight: 600; }
      .meal-card.today { border-color: var(--nl-accent); background: rgba(59, 130, 246, 0.05); }
      .meal-content { display: flex; flex-direction: column; gap: 12px; flex: 1; justify-content: space-between; }
      
      .meal-picker-box { display: flex; flex-direction: column; gap: 8px; width: 100%; }
      .meal-current-display { background: var(--nl-bg); border: 1px solid var(--nl-border); border-radius: 10px; padding: 10px 12px; min-height: 44px; display: flex; align-items: center; }
      .meal-title-row { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px; }
      .meal-active-title { font-size: 0.95rem; color: var(--nl-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      .meal-empty-title { font-size: 0.9rem; color: var(--nl-fg-sec); font-style: italic; }
      .meal-link-btn { color: var(--nl-accent); display: flex; align-items: center; justify-content: center; text-decoration: none; opacity: 0.8; transition: opacity 0.2s; }
      .meal-link-btn:hover { opacity: 1; }
      
      .meal-button-row { display: flex; gap: 8px; align-items: center; width: 100%; }
      .btn-meal-search { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: var(--nl-surface); border: 1px solid var(--nl-border); padding: 8px 12px; border-radius: 8px; color: var(--nl-fg); font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
      .btn-meal-search:hover { background: var(--nl-bg); border-color: var(--nl-accent); color: var(--nl-accent); }
      .btn-meal-clear { background: var(--nl-surface); border: 1px solid var(--nl-border); color: #EF4444; border-radius: 8px; padding: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
      .btn-meal-clear:hover { background: rgba(239, 68, 68, 0.1); border-color: #EF4444; }

      .meal-macros { display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto; }
      .macro { font-size: 0.75rem; padding: 4px 8px; border-radius: 12px; font-weight: 600; }
      .macro.cal { background: rgba(239, 68, 68, 0.1); color: #EF4444; }
      .macro.pro { background: rgba(59, 130, 246, 0.1); color: #3B82F6; }
      .macro.carbs { background: rgba(16, 185, 129, 0.1); color: #10B981; }
      .macro.fat { background: rgba(245, 158, 11, 0.1); color: #F59E0B; }

      /* Recipe Search Modal */
      .recipe-search-modal { max-width: 650px; max-height: 85vh; display: flex; flex-direction: column; }
      .recipe-picker-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; overflow: hidden; flex: 1; }
      .recipe-search-toolbar { display: flex; gap: 10px; align-items: center; }
      .recipe-search-input-wrap { flex: 1; display: flex; align-items: center; gap: 8px; background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: 12px; padding: 0 12px; }
      .recipe-search-input { flex: 1; border: none; background: transparent; padding: 12px 0; font-size: 1rem; color: var(--nl-fg); outline: none; font-family: inherit; }
      .clear-search-btn { background: none; border: none; color: var(--nl-fg-sec); cursor: pointer; font-size: 1rem; padding: 4px; }
      .btn-sync-inline { display: flex; align-items: center; gap: 6px; background: var(--nl-surface); border: 1px solid var(--nl-border); padding: 10px 14px; border-radius: 12px; color: var(--nl-fg); font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
      .btn-sync-inline:hover { border-color: var(--nl-accent); color: var(--nl-accent); }

      .recipe-tags-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
      .recipe-tag-pill { background: var(--nl-surface); border: 1px solid var(--nl-border); color: var(--nl-fg-sec); padding: 6px 12px; border-radius: 16px; font-size: 0.8rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s; }
      .recipe-tag-pill:hover { border-color: var(--nl-accent); color: var(--nl-fg); }
      .recipe-tag-pill.active { background: var(--nl-accent); border-color: var(--nl-accent); color: #fff; }

      .recipe-custom-prompt { display: flex; align-items: center; gap: 12px; background: var(--nl-surface); border: 1px dashed var(--nl-border); border-radius: 12px; padding: 12px 16px; cursor: pointer; transition: all 0.2s; }
      .recipe-custom-prompt:hover { border-color: var(--nl-accent); background: rgba(59, 130, 246, 0.05); }
      .custom-icon { font-size: 1.2rem; }
      .custom-text { display: flex; flex-direction: column; gap: 2px; }
      .custom-text strong { font-size: 0.9rem; color: var(--nl-fg); }
      .custom-text span { font-size: 0.75rem; color: var(--nl-fg-sec); }

      .recipes-results-list { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 380px; padding-right: 4px; }
      .recipe-result-item { display: flex; justify-content: space-between; align-items: center; background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: 12px; padding: 14px 16px; cursor: pointer; transition: all 0.2s; gap: 12px; }
      .recipe-result-item:hover { border-color: var(--nl-accent); transform: translateX(3px); background: var(--nl-bg); }
      .recipe-result-info { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
      .recipe-result-title-row { display: flex; align-items: center; gap: 8px; }
      .recipe-result-title { font-weight: 700; font-size: 1rem; color: var(--nl-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .recipe-result-ext-link { color: var(--nl-accent); display: flex; align-items: center; text-decoration: none; opacity: 0.7; transition: opacity 0.2s; }
      .recipe-result-ext-link:hover { opacity: 1; }
      .recipe-result-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
      .recipe-meta-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 0.75rem; color: var(--nl-fg-sec); background: var(--nl-bg); border: 1px solid var(--nl-border); padding: 2px 8px; border-radius: 8px; font-weight: 500; }
      .recipe-meta-pill.cal { color: #EF4444; border-color: rgba(239, 68, 68, 0.2); }
      .recipe-meta-pill.pro { color: #3B82F6; border-color: rgba(59, 130, 246, 0.2); }
      .recipe-pick-btn { background: var(--nl-accent); color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: opacity 0.2s; }
      .recipe-pick-btn:hover { opacity: 0.9; }

      .no-recipes-found { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; text-align: center; color: var(--nl-fg-sec); }

      /* Shopping List */
      .shopping-container { display: flex; flex-direction: column; gap: 24px; max-width: 600px; margin: 0 auto; width: 100%; }
      .shopping-add { display: flex; gap: 12px; }
      .shopping-add input { flex: 1; padding: 14px; border-radius: 12px; border: 1px solid var(--nl-border); background: var(--nl-surface); color: var(--nl-fg); font-family: inherit; font-size: 1rem; outline: none; }
      .shopping-add input:focus { border-color: var(--nl-accent); }
      .shopping-list { display: flex; flex-direction: column; gap: 8px; }
      .shopping-dept-header { font-size: 0.85rem; text-transform: uppercase; font-weight: 700; color: var(--nl-accent); margin: 16px 0 4px 4px; letter-spacing: 1px; }
      .shopping-dept-header.checked { color: var(--nl-fg-sec); margin-top: 24px; border-top: 1px solid var(--nl-border); padding-top: 16px; }
      .clear-checked-btn { background: var(--nl-surface); color: var(--nl-fg-sec); border: 1px solid var(--nl-border); padding: 8px 14px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; transition: all 0.2s; }
      .clear-checked-btn:hover { background: var(--nl-bg); color: #EF4444; border-color: #EF4444; }
      .shopping-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--nl-surface); border: 1px solid var(--nl-border); border-radius: 12px; transition: all 0.2s; }
      .shopping-item.checked { opacity: 0.6; background: transparent; border-style: dashed; }
      .shopping-item.checked .shopping-item-name { text-decoration: line-through; }
      .shopping-item-left { display: flex; align-items: center; gap: 12px; flex: 1; cursor: pointer; }
      .shopping-item-left ha-icon { color: var(--nl-accent); }
      .shopping-item.checked ha-icon { color: #10B981; }
      .shopping-item-name { font-weight: 600; color: var(--nl-fg); font-size: 1.05rem; }
      .shopping-item-meta { font-size: 0.85rem; color: var(--nl-fg-sec); background: var(--nl-bg); padding: 2px 8px; border-radius: 10px; margin-left: auto; margin-right: 12px; }
      .shopping-item-delete { background: none; border: none; color: #EF4444; cursor: pointer; opacity: 0.5; transition: opacity 0.2s; padding: 4px; display: flex; align-items: center; justify-content: center; }
      .shopping-item-delete:hover { opacity: 1; }

      /* Custom Navigation & Iframe Containers */
      .custom-iframe-container { width: 100%; height: 100%; min-height: 500px; display: flex; flex-direction: column; border-radius: 16px; overflow: hidden; border: 1px solid var(--nl-border); background: var(--nl-surface); }
      .custom-view-iframe { width: 100%; height: 100%; flex: 1; border: none; }
      .custom-view-container { width: 100%; height: 100%; }

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
    this._config = config || {};
    this.requestUpdate();
  }

  _updateConfig(changes) {
    this._config = { ...(this._config || {}), ...changes };
    this.dispatchEvent(new CustomEvent("config-changed", { 
      detail: { config: this._config },
      bubbles: true, 
      composed: true 
    }));
    this.requestUpdate();
  }

  _valueChanged(ev) {
    if (!this._config) return;
    const target = ev.target;
    const field = target.configValue || target.getAttribute('configValue');
    const value = ev.detail?.value !== undefined ? ev.detail.value : target.value;
    if (field) {
      if (this._config[field] === value) return;
      this._updateConfig({ [field]: value });
    }
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
    const cfg = this._config;
    return html`
      <div class="editor-container">
        <div class="editor-section">
            <h3>General Settings</h3>
            <div class="form-grid">
                <ha-textfield label="Dashboard Title" .value="${cfg.title || ''}" .configValue="${'title'}" @input="${this._valueChanged}" @value-changed="${this._valueChanged}"></ha-textfield>
                <ha-textfield label="Logo URL" .value="${cfg.logo_url || ''}" .configValue="${'logo_url'}" @input="${this._valueChanged}" @value-changed="${this._valueChanged}"></ha-textfield>
                
                <div style="display: flex; flex-direction: column; gap: 8px;">
                   <label style="font-size: 0.85rem; color: var(--secondary-text-color);">Theme</label>
                   <select .value="${cfg.theme || 'light'}" @change="${(e) => this._updateConfig({theme: e.target.value})}" style="padding: 10px; border-radius: 4px; border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);">
                     <option value="light" ?selected="${cfg.theme === 'light'}">Light Mode</option>
                     <option value="dark" ?selected="${cfg.theme === 'dark'}">Dark Mode</option>
                   </select>
                </div>
            </div>
        </div>

        <div class="editor-section">
            <h3>Integrations & Services</h3>
            <div class="form-grid">
                <ha-textfield label="Website URL (e.g. https://recipe-manager-797363602183.us-west1.run.app)" .value="${cfg.website_url || ''}" .configValue="${'website_url'}" @input="${this._valueChanged}" @value-changed="${this._valueChanged}"></ha-textfield>
                <ha-textfield label="Meals Sensor" .value="${cfg.meals_sensor || 'sensor.meal_planner_weekly_meals'}" .configValue="${'meals_sensor'}" @input="${this._valueChanged}" @value-changed="${this._valueChanged}"></ha-textfield>
                <ha-textfield label="Recipes Sensor" .value="${cfg.recipes_sensor || 'sensor.meal_planner_recipes'}" .configValue="${'recipes_sensor'}" @input="${this._valueChanged}" @value-changed="${this._valueChanged}"></ha-textfield>
                <ha-textfield label="Shopping Sensor" .value="${cfg.shopping_sensor || 'sensor.meal_planner_shopping_list'}" .configValue="${'shopping_sensor'}" @input="${this._valueChanged}" @value-changed="${this._valueChanged}"></ha-textfield>

                <ha-entity-picker 
                    .hass="${this.hass}" 
                    label="View Controller" 
                    .value="${cfg.view_controller || ''}" 
                    .configValue="${'view_controller'}" 
                    .includeDomains="${['input_select']}" 
                    @value-changed="${(e) => this._updateConfig({view_controller: e.detail.value})}">
                </ha-entity-picker>
                
                <ha-entity-picker 
                    .hass="${this.hass}" 
                    label="Family Notes List" 
                    .value="${cfg.notes_entity || ''}" 
                    .configValue="${'notes_entity'}" 
                    .includeDomains="${['todo']}" 
                    @value-changed="${(e) => this._updateConfig({notes_entity: e.detail.value})}">
                </ha-entity-picker>
            </div>
        </div>

        <div class="info-box">
           <strong>Advanced Configuration:</strong> Entities, Chores, Meal Plans, and Custom Navigation can be configured directly in the YAML code editor.
        </div>
      </div>
    `;
  }
}

// Register standard card tag
if (!customElements.get("nightlight-dashboard-card")) {
  customElements.define("nightlight-dashboard-card", NightlightDashboard);
}
// Register test environment card tag
if (!customElements.get("nightlight-dashboard-test")) {
  customElements.define("nightlight-dashboard-test", NightlightDashboard);
}
// Register visual editor tags
if (!customElements.get("nightlight-dashboard-editor")) {
  customElements.define("nightlight-dashboard-editor", NightlightCardEditor);
}
if (!customElements.get("nightlight-dashboard-test-editor")) {
  customElements.define("nightlight-dashboard-test-editor", NightlightCardEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "nightlight-dashboard-card",
  name: "Nightlight Dashboard",
  description: "Advanced Family Hub with Calendar, Chores & Meals"
});
window.customCards.push({
  type: "nightlight-dashboard-test",
  name: "Nightlight Dashboard (Test)",
  description: "Testing Environment for Nightlight Family Hub"
});
