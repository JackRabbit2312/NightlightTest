import { LitElement, html, css } from 'https://unpkg.com/lit@3.1.2/index.js?module';

/**
 * Nightlight Dashboard v2.0.0 (Modernized)
 * A visually stunning, high-performance Home Assistant dashboard card.
 */
class NightlightDashboard extends LitElement {
  
  static properties = {
    hass: { type: Object },
    config: { type: Object },
    _activeView: { state: true },
    _calendarMode: { state: true },
    _events: { state: true },
    _loading: { state: true },
    _referenceDate: { state: true },
    _selectedEvent: { state: true },
    _activeCalendars: { state: true },
    _showAddModal: { state: true },
    _menuOpen: { state: true },
    _todoItems: { state: true }
  };

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
    this._todoItems = [];
    this._lastResetDate = localStorage.getItem('nightlight_reset_date');
  }

  setConfig(config) {
    if (!config.entities && !config.chores) {
      throw new Error("Nightlight: Please define 'entities' (calendars) or 'chores' in your YAML configuration.");
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

  /* --- Lifecycle & Data Fetching --- */

  updated(changedProps) {
    // Handle View Mode Attributes for styling hooks
    if (changedProps.has('_activeView')) {
      const coreViews = ['calendar', 'meals', 'whiteboard', 'chores'];
      const mode = coreViews.includes(this._activeView) ? 'core' : 'section';
      this.setAttribute('mode', mode);

      if (this._activeView === 'whiteboard') this._fetchNotes();
      if (this._activeView === 'chores') this._fetchChoreData();
    }

    // Handle HASS updates
    if (changedProps.has('hass')) {
      this._checkDailyReset();
      
      const oldHass = changedProps.get('hass');
      if (oldHass) {
        // Reactive updates for specific entities
        const notesEntity = this.config.notes_entity;
        if (this._activeView === 'whiteboard' && notesEntity && 
            this.hass.states[notesEntity] !== oldHass.states[notesEntity]) {
          this._fetchNotes();
        }
      }
    }

    // Refresh Data triggers
    if (changedProps.has('hass') || changedProps.has('_activeView') || 
        changedProps.has('_calendarMode') || changedProps.has('_referenceDate')) {
      this._refreshData();
    }
  }

  async _refreshData() {
    if (!this.hass || this._loading) return;
    
    // Debounce slightly to prevent thrashing
    if (this._debounceFetch) clearTimeout(this._debounceFetch);
    
    this._debounceFetch = setTimeout(async () => {
      this._loading = true;
      try {
        if (this._activeView === 'calendar') await this._fetchEvents();
      } catch (e) {
        console.error("Nightlight: Data refresh failed", e);
      } finally {
        this._loading = false;
      }
    }, 50);
  }

  async _fetchEvents() {
    let start = new Date(this._referenceDate);
    let end = new Date(this._referenceDate);

    // Calculate Date Range
    if (this._calendarMode === 'month') {
      start = new Date(start.getFullYear(), start.getMonth(), 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
    } else if (this._calendarMode === 'week') {
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday start
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

    const calendars = (this.config.entities || []).filter(e => e.entity.startsWith('calendar'));
    
    try {
      const responses = await Promise.all(
        calendars.map(async ent => {
          try {
            const events = await this.hass.callApi('GET', `calendars/${ent.entity}?start=${startStr}&end=${endStr}`);
            const stateObj = this.hass.states[ent.entity];
            return events.map(e => ({
              ...e,
              color: ent.color || '#6366f1',
              origin: ent.entity,
              friendly_name: stateObj?.attributes?.friendly_name || ent.entity
            }));
          } catch {
            return [];
          }
        })
      );
      this._events = responses.flat();
    } catch (e) {
      console.error("Nightlight: Error fetching events", e);
    }
  }

  async _fetchChoreData() {
    if (!this.hass || !this.config.chores) return;

    try {
      const allItems = [];
      for (const kid of this.config.chores) {
        if (!kid.todo_list) continue;
        
        try {
          const result = await this.hass.callWS({
            type: "todo/item/list",
            entity_id: kid.todo_list,
          });
          
          if (result && result.items) {
            const taggedItems = result.items.map(item => ({
              ...item,
              list_id: kid.todo_list,
              kid_id: kid.name // Helper for grouping if needed
            }));
            allItems.push(...taggedItems);
          }
        } catch (e) {
          console.warn(`Nightlight: Could not fetch chores for ${kid.name}`, e);
        }
      }
      this._todoItems = allItems;
    } catch (e) {
      console.error("Nightlight: Chore fetch error", e);
    }
  }

  async _fetchNotes() {
    const entityId = this.config.notes_entity;
    if (!entityId || !this.hass) return;

    try {
      const result = await this.hass.callWS({
        type: "todo/item/list",
        entity_id: entityId,
      });
      this._todoItems = (result.items || []).filter(item => item.status === 'needs_action');
    } catch (e) {
      console.error("Nightlight: Notes fetch failed", e);
    }
  }

  async _checkDailyReset() {
    if (!this.hass || !this.config.chores) return;
    const today = new Date().toDateString();

    if (this._lastResetDate !== today) {
      // It's a new day, reset completed items to 'needs_action'
      for (const kid of this.config.chores) {
        if (!kid.todo_list) continue;
        
        const state = this.hass.states[kid.todo_list];
        // Note: Modern HA todo entities might handle this differently, but keeping logic for Todo lists
        // that require manual reset logic if not handled by automation
        const items = state?.attributes?.items || []; 
        
        for (const item of items) {
          if (item.status === 'completed') {
            await this.hass.callService('todo', 'update_item', {
              entity_id: kid.todo_list,
              item: item.summary,
              status: 'needs_action'
            });
          }
        }
      }
      
      localStorage.setItem('nightlight_reset_date', today);
      this._lastResetDate = today;
    }
  }

  /* --- Actions & Handlers --- */

  _navigate(dir) {
    const d = new Date(this._referenceDate);
    if (this._calendarMode === 'month') d.setMonth(d.getMonth() + dir);
    else if (this._calendarMode === 'week') d.setDate(d.getDate() + (dir * 7));
    else d.setDate(d.getDate() + dir);
    this._referenceDate = d;
  }

  async _toggleTodo(entityId, taskLabel, isDone) {
    if (!entityId) return;
    const newStatus = isDone ? 'needs_action' : 'completed';
    
    // Optimistic UI update could go here, but we wait for refresh for source of truth
    try {
      await this.hass.callService('todo', 'update_item', {
        entity_id: entityId,
        item: taskLabel,
        status: newStatus
      });
      await this._fetchChoreData();
    } catch (e) {
      console.error("Nightlight: Todo toggle failed", e);
    }
  }

  async _submitEvent() {
    const root = this.shadowRoot;
    const getVal = (id) => root.getElementById(id)?.value;

    const payload = {
      summary: getVal('new_summary'),
      calendar: getVal('new_calendar'),
      start: `${getVal('new_date_start')}T${getVal('new_start_time')}:00`,
      end: `${getVal('new_date_end')}T${getVal('new_end_time')}:00`,
      location: getVal('new_location'),
      description: getVal('new_description')
    };

    if (!payload.summary || !payload.calendar) {
      alert("Please provide at least a title and target calendar.");
      return;
    }

    try {
      await this.hass.callService('calendar', 'create_event', {
        entity_id: payload.calendar,
        summary: payload.summary,
        location: payload.location,
        description: payload.description,
        start_date_time: payload.start,
        end_date_time: payload.end,
      });
      this._showAddModal = false;
      this._refreshData();
    } catch (e) {
      console.error("Event creation failed", e);
      alert("Failed to create event. Check logs.");
    }
  }

  async _saveMeal(day, value) {
    const entityId = this.config.meal_entities?.[day];
    if (!entityId) return;

    const timestamp = new Date().toISOString();
    const payload = value ? `${value} | ${timestamp}` : "";

    await this.hass.callService('input_text', 'set_value', {
      entity_id: entityId,
      value: payload
    });
  }

  /* --- Render Helpers --- */

  _getTodoStatus(entityId, taskLabel) {
    if (!this._todoItems) return false;
    const item = this._todoItems.find(i => 
      i.list_id === entityId && 
      i.summary.trim().toLowerCase() === taskLabel.trim().toLowerCase()
    );
    return item ? item.status === 'completed' : false;
  }

  _isToday(n) {
    const t = new Date();
    return n === t.getDate() && 
           this._referenceDate.getMonth() === t.getMonth() && 
           this._referenceDate.getFullYear() === t.getFullYear();
  }

  /* --- Main Render --- */

  render() {
    if (!this.hass) return html`<div>Loading Home Assistant...</div>`;

    const activeView = this._activeView;
    const headerTitle = activeView === 'calendar'
      ? this._referenceDate.toLocaleString('default', { month: 'long', year: 'numeric' })
      : (this.config.title || "Family Hub");

    const navItems = [
      { id: 'calendar', name: 'Calendar', icon: 'mdi:calendar-month' },
      { id: 'meals', name: 'Meals', icon: 'mdi:silverware-fork-knife' },
      { id: 'whiteboard', name: 'Notes', icon: 'mdi:note-edit' },
      { id: 'chores', name: 'Chores', icon: 'mdi:check-all' }
    ];

    const isWhiteboard = activeView === 'whiteboard';
    const notesState = this.hass.states[this.config.notes_entity];
    const hasNewNotes = isWhiteboard && notesState 
      ? (new Date() - new Date(notesState.last_changed)) < (60 * 60 * 1000) 
      : false;

    return html`
      <div class="nl-card ${this.config.theme} ${this._menuOpen ? 'menu-open' : ''}">
        
        <!-- Sidebar Navigation -->
        <aside class="nl-sidebar">
          <div class="nl-sidebar-content">
            <div class="nl-logo" @click="${() => this._activeView = 'calendar'}">
              <ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon>
            </div>

            <nav class="nl-nav">
              ${navItems.map(item => html`
                <button 
                  class="nl-nav-btn ${activeView === item.id ? 'active' : ''}"
                  @click="${() => { this._activeView = item.id; this._menuOpen = false; }}"
                >
                  <ha-icon icon="${item.icon}"></ha-icon>
                  <span>${item.name}</span>
                  ${item.id === 'whiteboard' && hasNewNotes ? html`<span class="notification-dot"></span>` : ''}
                </button>
              `)}

              <!-- Custom Navigation from Config -->
              ${(this.config.navigation || []).map(nav => html`
                <button 
                  class="nl-nav-btn ${activeView === nav.name ? 'active' : ''}"
                  @click="${() => {
                    this._activeView = nav.name;
                    this._menuOpen = false;
                    // Support for external view controllers
                    if (this.config.view_controller) {
                      this.hass.callService('input_select', 'select_option', {
                        entity_id: this.config.view_controller,
                        option: nav.name
                      });
                    }
                  }}"
                >
                  <ha-icon icon="${nav.icon}"></ha-icon>
                  <span>${nav.name}</span>
                </button>
              `)}
            </nav>

            <button class="nl-fab-mini" @click="${() => this._showAddModal = true}">
              <ha-icon icon="mdi:plus"></ha-icon>
            </button>
          </div>
        </aside>

        <!-- Main Content Area -->
        <main class="nl-main">
          <header class="nl-header">
            <div class="nl-header-left">
              <button class="nl-menu-trigger" @click="${() => this._menuOpen = !this._menuOpen}">
                <ha-icon icon="mdi:menu"></ha-icon>
              </button>
              <h1 class="nl-title">${headerTitle}</h1>
            </div>

            <div class="nl-header-center">
              ${activeView === 'calendar' ? html`
                 <div class="nl-date-nav">
                    <button @click="${() => this._navigate(-1)}"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
                    <button @click="${() => { this._referenceDate = new Date(); }}" class="today-btn">Today</button>
                    <button @click="${() => this._navigate(1)}"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
                 </div>
              ` : html`<span class="nl-clock">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>`}
            </div>

            <div class="nl-header-right">
              ${activeView === 'calendar' ? html`
                <div class="nl-view-toggles">
                  ${['month', 'week', 'day', 'agenda'].map(m => html`
                    <button 
                      class="${this._calendarMode === m ? 'active' : ''}"
                      @click="${() => this._calendarMode = m}"
                    >${m}</button>
                  `)}
                </div>
              ` : ''}
              
              <div class="nl-avatar">
                ${this.hass.user?.name ? this.hass.user.name.charAt(0) : 'U'}
              </div>
            </div>
          </header>

          <section class="nl-content-viewport">
            ${this._renderActiveView()}
          </section>
        </main>

        <!-- Modals -->
        ${this._selectedEvent ? this._renderEventModal() : ''}
        ${this._showAddModal ? this._renderAddModal() : ''}
      </div>
    `;
  }

  _renderActiveView() {
    switch (this._activeView) {
      case 'meals': return this._renderMeals();
      case 'whiteboard': return this._renderWhiteboard();
      case 'chores': return this._renderChores();
      case 'calendar': 
      default: 
        if (this._calendarMode === 'agenda') return this._renderAgenda();
        if (this._calendarMode === 'month') return this._renderMonth();
        return this._renderTimeGrid(this._calendarMode === 'week' ? 7 : 1);
    }
  }

  /* --- Sub-Views --- */

  _renderMonth() {
    const start = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth(), 1);
    const end = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth() + 1, 0);
    const startDay = (start.getDay() + 6) % 7; // Mon start
    
    // Grid generation
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push({ day: null });
    for (let i = 1; i <= end.getDate(); i++) cells.push({ day: i });

    const weekDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

    return html`
      <div class="nl-month-view">
        <div class="nl-week-header">
          ${weekDays.map(d => html`<span>${d}</span>`)}
        </div>
        <div class="nl-month-grid">
          ${cells.map(cell => {
            if (!cell.day) return html`<div class="nl-day empty"></div>`;
            
            const isToday = this._isToday(cell.day);
            const events = this._events
              .filter(e => {
                const eDate = new Date(e.start.dateTime || e.start.date);
                return eDate.getDate() === cell.day && this._activeCalendars.includes(e.origin);
              })
              .sort((a,b) => (a.start.dateTime || a.start.date).localeCompare(b.start.dateTime || b.start.date));

            return html`
              <div class="nl-day ${isToday ? 'today' : ''}" @click="${() => {
                 const newDate = new Date(this._referenceDate);
                 newDate.setDate(cell.day);
                 this._referenceDate = newDate;
                 this._calendarMode = 'day';
              }}">
                <span class="nl-day-num">${cell.day}</span>
                <div class="nl-event-dots">
                  ${events.slice(0, 4).map(e => html`
                    <div 
                      class="nl-event-pill" 
                      style="--c: ${e.color}"
                      @click="${(ev) => { ev.stopPropagation(); this._selectedEvent = e; }}"
                    >
                      ${e.summary}
                    </div>
                  `)}
                  ${events.length > 4 ? html`<span class="more-indicator">+${events.length - 4}</span>` : ''}
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  _renderMeals() {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const entities = this.config.meal_entities || {};

    return html`
      <div class="nl-card-grid">
        ${days.map(day => {
          const entityId = entities[day];
          const stateObj = this.hass.states[entityId];
          let displayValue = "";
          
          // Parse meal content and timestamp logic
          if (stateObj?.state && stateObj.state !== "unknown") {
            const parts = stateObj.state.split(' | ');
            // Clear if older than 5 days
            if (parts[1] && (new Date() - new Date(parts[1])) > (432000000)) { // 5 days
              this._saveMeal(day, "");
            } else {
              displayValue = parts[0];
            }
          }

          return html`
            <div class="nl-meal-card">
              <div class="nl-meal-header">
                <h3>${day}</h3>
                <ha-icon icon="mdi:silverware-variant"></ha-icon>
              </div>
              <textarea 
                class="nl-meal-input"
                placeholder="Plan dinner..."
                .value="${displayValue}"
                @change="${(e) => this._saveMeal(day, e.target.value)}"
              ></textarea>
            </div>
          `;
        })}
      </div>
    `;
  }

  _renderChores() {
    if (!this.config.chores) return html`<div class="nl-empty">No chores configured in YAML.</div>`;

    // Determine Active Period
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const periods = this.config.periods || [];
    
    const activePeriod = periods.find(p => {
      const [sh, sm] = p.start.split(':').map(Number);
      const [eh, em] = p.end.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      return currentMins >= start && currentMins <= end;
    });

    if (!activePeriod) return html`
      <div class="nl-center-msg">
        <ha-icon icon="mdi:sleep" style="font-size: 64px; opacity: 0.5;"></ha-icon>
        <h2>No Active Chores</h2>
        <p>Relax! No chores are scheduled for right now.</p>
      </div>
    `;

    return html`
      <div class="nl-chore-wrapper">
        <div class="nl-period-banner">
          Current Period: <strong>${activePeriod.name}</strong>
        </div>
        <div class="nl-card-grid">
          ${this.config.chores.map(kid => {
            const tasks = (kid.items || []).filter(i => i.period === activePeriod.name);
            if (!tasks.length) return '';

            return html`
              <div class="nl-kid-card">
                <div class="nl-kid-header" style="background-image: linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.6)), url('${kid.image}')">
                  <h3>${kid.name}</h3>
                </div>
                <div class="nl-task-list">
                  ${tasks.map(task => {
                    const isDone = this._getTodoStatus(kid.todo_list, task.label);
                    return html`
                      <div class="nl-task-row ${isDone ? 'done' : ''}" @click="${() => this._toggleTodo(kid.todo_list, task.label, isDone)}">
                        <div class="nl-checkbox">
                          ${isDone ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}
                        </div>
                        <span>${task.label}</span>
                      </div>
                    `;
                  })}
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  _renderWhiteboard() {
    return html`
      <div class="nl-notes-layout">
        <div class="nl-notes-header">
           <h2>Family Notes</h2>
           <button class="nl-btn-primary" @click="${() => {
             const t = prompt("New Note:");
             if (t) this.hass.callService('todo', 'add_item', { entity_id: this.config.notes_entity, item: t }).then(() => this._fetchNotes());
           }}">Add Note</button>
        </div>
        <div class="nl-masonry">
           ${this._todoItems.map((note, i) => html`
             <div class="nl-sticky-note" style="--rot: ${(i % 2 === 0 ? -1 : 1)}deg">
                <button class="nl-close-btn" @click="${() => this._toggleTodo(this.config.notes_entity, note.summary, false)}">×</button>
                <div class="nl-note-text">${note.summary}</div>
             </div>
           `)}
        </div>
      </div>
    `;
  }

  /* --- Modals --- */

  _renderAddModal() {
    const today = new Date().toISOString().split('T')[0];
    return html`
      <div class="nl-modal-backdrop" @click="${() => this._showAddModal = false}">
        <div class="nl-modal" @click="${e => e.stopPropagation()}">
          <div class="nl-modal-header">
            <h3>New Event</h3>
            <button @click="${() => this._showAddModal = false}">×</button>
          </div>
          <div class="nl-form">
            <input type="text" id="new_summary" placeholder="Event Title" class="nl-input full">
            <div class="nl-form-row">
              <input type="date" id="new_date_start" value="${today}" class="nl-input">
              <input type="time" id="new_start_time" value="09:00" class="nl-input">
            </div>
            <div class="nl-form-row">
              <input type="date" id="new_date_end" value="${today}" class="nl-input">
              <input type="time" id="new_end_time" value="10:00" class="nl-input">
            </div>
            <select id="new_calendar" class="nl-input full">
              ${(this.config.entities || []).filter(e => e.entity.startsWith('calendar')).map(e => html`
                <option value="${e.entity}">${e.entity}</option>
              `)}
            </select>
            <textarea id="new_description" class="nl-input full" placeholder="Notes"></textarea>
            <div class="nl-modal-footer">
               <button class="nl-btn-primary" @click="${this._submitEvent}">Create Event</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* --- Styles --- */

  static styles = css`
    :host {
      --primary: #6366f1;
      --bg: #ffffff;
      --surface: #f8fafc;
      --text: #1e293b;
      --text-dim: #64748b;
      --border: #e2e8f0;
      --radius: 24px;
      display: block;
      height: 100%;
      font-family: 'Inter', system-ui, sans-serif;
    }

    /* Dark Mode Theme Hooks */
    :host([theme="dark"]) .nl-card {
      --bg: #0f172a;
      --surface: #1e293b;
      --text: #f8fafc;
      --text-dim: #94a3b8;
      --border: #334155;
    }

    /* Layout */
    .nl-card {
      background: var(--bg);
      color: var(--text);
      display: grid;
      grid-template-columns: 80px 1fr;
      height: 100%;
      overflow: hidden;
      border-radius: var(--radius);
      transition: all 0.3s ease;
    }

    /* Sidebar */
    .nl-sidebar {
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 20px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      z-index: 10;
    }
    
    .nl-sidebar-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      gap: 30px;
    }

    .nl-logo {
      color: var(--primary);
      --mdc-icon-size: 32px;
      cursor: pointer;
    }

    .nl-nav {
      display: flex;
      flex-direction: column;
      gap: 20px;
      width: 100%;
    }

    .nl-nav-btn {
      background: transparent;
      border: none;
      color: var(--text-dim);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      position: relative;
      transition: color 0.2s;
      padding: 10px 0;
    }

    .nl-nav-btn.active {
      color: var(--primary);
    }
    .nl-nav-btn.active::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      height: 24px;
      width: 3px;
      background: var(--primary);
      border-radius: 0 4px 4px 0;
    }

    .nl-nav-btn span {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .nl-fab-mini {
      margin-top: auto;
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--primary);
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }

    /* Main Area */
    .nl-main {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .nl-header {
      padding: 24px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .nl-title {
      font-size: 24px;
      font-weight: 800;
      margin: 0;
      letter-spacing: -0.5px;
    }

    .nl-header-center {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
    }

    .nl-clock {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-dim);
      font-variant-numeric: tabular-nums;
    }
    
    .nl-date-nav {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--surface);
      padding: 4px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .nl-date-nav button {
      background: transparent;
      border: none;
      padding: 6px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-dim);
    }
    .nl-date-nav button:hover {
      background: var(--bg);
      color: var(--primary);
    }
    .today-btn {
      font-weight: 600;
      font-size: 13px;
      padding: 6px 12px !important;
    }

    .nl-view-toggles {
      display: flex;
      background: var(--surface);
      padding: 4px;
      border-radius: 10px;
    }
    
    .nl-view-toggles button {
      background: transparent;
      border: none;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-dim);
      cursor: pointer;
    }
    
    .nl-view-toggles button.active {
      background: var(--bg);
      color: var(--text);
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    .nl-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
    }

    .nl-content-viewport {
      flex: 1;
      overflow-y: auto;
      padding: 0 32px 32px 32px;
    }

    /* Month View */
    .nl-month-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      border: 1px solid var(--border);
      border-radius: 20px;
      overflow: hidden;
    }
    .nl-week-header {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      padding: 12px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      text-align: center;
    }
    .nl-week-header span {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-dim);
      letter-spacing: 1px;
    }
    .nl-month-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      grid-template-rows: repeat(6, 1fr);
      flex: 1;
    }
    .nl-day {
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      padding: 8px;
      position: relative;
      cursor: pointer;
      transition: background 0.2s;
    }
    .nl-day:hover {
      background: var(--surface);
    }
    .nl-day.today {
      background: rgba(99, 102, 241, 0.05);
    }
    .nl-day.today .nl-day-num {
      background: var(--primary);
      color: white;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
    }
    .nl-day-num {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-dim);
      margin-bottom: 4px;
      display: inline-block;
    }
    .nl-event-dots {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nl-event-pill {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--c);
      color: white;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.9;
    }

    /* Meals */
    .nl-card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
    }
    .nl-meal-card {
      background: var(--surface);
      border-radius: 20px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    .nl-meal-header {
      display: flex;
      justify-content: space-between;
      color: var(--primary);
      margin-bottom: 12px;
    }
    .nl-meal-input {
      background: transparent;
      border: none;
      font-family: inherit;
      resize: none;
      color: var(--text);
      font-size: 14px;
      height: 80px;
    }
    .nl-meal-input:focus { outline: none; }

    /* Chores */
    .nl-kid-card {
      background: var(--surface);
      border-radius: 20px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .nl-kid-header {
      height: 100px;
      background-size: cover;
      background-position: center;
      display: flex;
      align-items: flex-end;
      padding: 16px;
    }
    .nl-kid-header h3 {
      color: white;
      margin: 0;
      text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    }
    .nl-task-list {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .nl-task-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      background: var(--bg);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .nl-task-row.done {
      opacity: 0.5;
      text-decoration: line-through;
    }
    .nl-checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid var(--border);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .nl-task-row.done .nl-checkbox {
      background: #10b981;
      border-color: #10b981;
      color: white;
    }

    /* Masonry Notes */
    .nl-masonry {
      column-count: 3;
      column-gap: 20px;
    }
    .nl-sticky-note {
      background: #fef08a;
      break-inside: avoid;
      margin-bottom: 20px;
      padding: 24px;
      border-radius: 2px;
      box-shadow: 2px 4px 8px rgba(0,0,0,0.1);
      transform: rotate(var(--rot));
      position: relative;
      color: #854d0e;
      font-weight: 500;
      white-space: pre-wrap;
    }
    .nl-close-btn {
      position: absolute;
      top: 5px;
      right: 5px;
      background: transparent;
      border: none;
      cursor: pointer;
      color: inherit;
      opacity: 0.5;
    }

    /* Generic Components */
    .nl-modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .nl-modal {
      background: var(--bg);
      padding: 24px;
      border-radius: 24px;
      width: 400px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
    }
    .nl-modal-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;
      font-size: 18px;
      font-weight: 700;
    }
    .nl-input {
      width: 100%;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      font-family: inherit;
    }
    .nl-btn-primary {
      background: var(--primary);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }
    
    .nl-center-msg {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-dim);
      text-align: center;
    }

    .menu-open .nl-sidebar {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 200px;
    }

    @media (max-width: 768px) {
      .nl-card { grid-template-columns: 1fr; }
      .nl-sidebar { display: none; }
      .nl-sidebar.open { display: flex; position: absolute; height: 100%; width: 80px; }
      .nl-menu-trigger { display: block; background: transparent; border: none; font-size: 24px; cursor: pointer; color: var(--text); }
      .nl-header-left { display: flex; align-items: center; gap: 10px; }
      .nl-month-view { border: none; }
      .nl-month-grid { grid-template-rows: repeat(6, 60px); }
    }
    
    @media (min-width: 769px) {
      .nl-menu-trigger { display: none; }
    }
  `;
}

// Register the Card
customElements.define("nightlight-calendar-card", NightlightDashboard);

// Mock Editor for now
class NightlightCardEditor extends LitElement {
  render() { return html`<div>Editor functionality would go here</div>`; }
}
customElements.define("nightlight-card-editor", NightlightCardEditor);

// Add to HA Custom Cards list
window.customCards = window.customCards || [];
window.customCards.push({
  type: "nightlight-calendar-card",
  name: "Nightlight Hub",
  description: "A beautiful, modern home management dashboard."
});
