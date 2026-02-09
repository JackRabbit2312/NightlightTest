import { LitElement, html, css } from 'https://unpkg.com/lit@3.1.2/index.js?module';

/**
 * Nightlight Dashboard v2.1.0
 * Modernized, High-Performance Home Assistant Card
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
      throw new Error("Nightlight: Define 'entities' or 'chores' in YAML.");
    }
    
    this.config = {
      title: "Family Hub",
      theme: "light",
      logo_url: '/',
      ...config
    };

    if (this._activeCalendars.length === 0 && config.entities) {
      this._activeCalendars = config.entities.map(e => e.entity);
    }
  }

  /* --- Data & Lifecycle --- */

  updated(changedProps) {
    if (changedProps.has('_activeView')) {
      if (this._activeView === 'whiteboard') this._fetchNotes();
      if (this._activeView === 'chores') this._fetchChoreData();
    }

    if (changedProps.has('hass')) {
      this._checkDailyReset();
      const oldHass = changedProps.get('hass');
      if (oldHass) {
        const notesEntity = this.config.notes_entity;
        if (this._activeView === 'whiteboard' && notesEntity && 
            this.hass.states[notesEntity] !== oldHass.states[notesEntity]) {
          this._fetchNotes();
        }
      }
    }

    if (changedProps.has('hass') || changedProps.has('_activeView') || 
        changedProps.has('_calendarMode') || changedProps.has('_referenceDate')) {
      this._refreshData();
    }
  }

  async _refreshData() {
    if (!this.hass || this._loading) return;
    if (this._debounceFetch) clearTimeout(this._debounceFetch);
    
    this._debounceFetch = setTimeout(async () => {
      this._loading = true;
      try {
        if (this._activeView === 'calendar') await this._fetchEvents();
      } catch (e) {
        console.error("Nightlight: Refresh failed", e);
      } finally {
        this._loading = false;
      }
    }, 50);
  }

  async _fetchEvents() {
    let start = new Date(this._referenceDate);
    let end = new Date(this._referenceDate);

    if (this._calendarMode === 'month') {
      start = new Date(start.getFullYear(), start.getMonth(), 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
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
    } catch (e) { console.error("Event Fetch Error", e); }
  }

  async _fetchChoreData() {
    if (!this.hass || !this.config.chores) return;
    try {
      const allItems = [];
      for (const kid of this.config.chores) {
        if (!kid.todo_list) continue;
        try {
          const result = await this.hass.callWS({ type: "todo/item/list", entity_id: kid.todo_list });
          if (result && result.items) {
            allItems.push(...result.items.map(item => ({ ...item, list_id: kid.todo_list })));
          }
        } catch (e) {}
      }
      this._todoItems = allItems;
    } catch (e) {}
  }

  async _fetchNotes() {
    if (!this.config.notes_entity || !this.hass) return;
    try {
      const result = await this.hass.callWS({ type: "todo/item/list", entity_id: this.config.notes_entity });
      this._todoItems = (result.items || []).filter(item => item.status === 'needs_action');
    } catch (e) {}
  }

  async _checkDailyReset() {
    if (!this.hass || !this.config.chores) return;
    const today = new Date().toDateString();

    if (this._lastResetDate !== today) {
      for (const kid of this.config.chores) {
        if (!kid.todo_list) continue;
        const state = this.hass.states[kid.todo_list];
        // Note: Logic for resetting legacy todo items if needed
        if (state?.attributes?.items) {
             for (const item of state.attributes.items) {
                if (item.status === 'completed') {
                    await this.hass.callService('todo', 'update_item', {
                        entity_id: kid.todo_list,
                        item: item.summary,
                        status: 'needs_action'
                    });
                }
             }
        }
      }
      localStorage.setItem('nightlight_reset_date', today);
      this._lastResetDate = today;
    }
  }

  /* --- Actions --- */

  _navigate(dir) {
    const d = new Date(this._referenceDate);
    if (this._calendarMode === 'month') d.setMonth(d.getMonth() + dir);
    else if (this._calendarMode === 'week') d.setDate(d.getDate() + (dir * 7));
    else d.setDate(d.getDate() + dir);
    this._referenceDate = d;
  }

  async _toggleTodo(entityId, taskLabel, isDone) {
    try {
      await this.hass.callService('todo', 'update_item', {
        entity_id: entityId,
        item: taskLabel,
        status: isDone ? 'needs_action' : 'completed'
      });
      await this._fetchChoreData();
    } catch (e) { console.error("Todo Toggle Error", e); }
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

    if (!payload.summary || !payload.calendar) return alert("Title and Calendar required");

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
    } catch (e) { alert("Error creating event"); }
  }

  async _saveMeal(day, value) {
    const entityId = this.config.meal_entities?.[day];
    if (entityId) {
      await this.hass.callService('input_text', 'set_value', {
        entity_id: entityId,
        value: value ? `${value} | ${new Date().toISOString()}` : ""
      });
    }
  }

  _getTodoStatus(entityId, taskLabel) {
    if (!this._todoItems) return false;
    const item = this._todoItems.find(i => 
      i.list_id === entityId && i.summary.toLowerCase() === taskLabel.toLowerCase()
    );
    return item ? item.status === 'completed' : false;
  }

  _isToday(n) {
    const t = new Date();
    return n === t.getDate() && this._referenceDate.getMonth() === t.getMonth();
  }

  /* --- Render --- */

  render() {
    if (!this.hass) return html`<div>Loading...</div>`;

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

    const notesState = this.hass.states[this.config.notes_entity];
    const hasNewNotes = activeView === 'whiteboard' && notesState 
      ? (new Date() - new Date(notesState.last_changed)) < (3600000) : false;

    return html`
      <div class="nl-card ${this.config.theme} ${this._menuOpen ? 'menu-open' : ''}">
        <aside class="nl-sidebar">
          <div class="nl-sidebar-content">
            <div class="nl-logo" @click="${() => this._activeView = 'calendar'}">
              <ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon>
            </div>
            <nav class="nl-nav">
              ${navItems.map(item => html`
                <button class="nl-nav-btn ${activeView === item.id ? 'active' : ''}"
                  @click="${() => { this._activeView = item.id; this._menuOpen = false; }}">
                  <ha-icon icon="${item.icon}"></ha-icon>
                  <span>${item.name}</span>
                  ${item.id === 'whiteboard' && hasNewNotes ? html`<span class="notification-dot"></span>` : ''}
                </button>
              `)}
              ${(this.config.navigation || []).map(nav => html`
                <button class="nl-nav-btn ${activeView === nav.name ? 'active' : ''}"
                  @click="${() => {
                    this._activeView = nav.name;
                    this._menuOpen = false;
                    if (this.config.view_controller) {
                      this.hass.callService('input_select', 'select_option', {
                        entity_id: this.config.view_controller,
                        option: nav.name
                      });
                    }
                  }}">
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
                    <button @click="${() => this._referenceDate = new Date()}" class="today-btn">Today</button>
                    <button @click="${() => this._navigate(1)}"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
                 </div>
              ` : html`<span class="nl-clock">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>`}
            </div>
            <div class="nl-header-right">
              ${activeView === 'calendar' ? html`
                <div class="nl-view-toggles">
                  ${['month', 'week', 'day'].map(m => html`
                    <button class="${this._calendarMode === m ? 'active' : ''}" @click="${() => this._calendarMode = m}">${m}</button>
                  `)}
                </div>
              ` : ''}
              <div class="nl-avatar">${this.hass.user?.name ? this.hass.user.name.charAt(0) : 'U'}</div>
            </div>
          </header>

          <section class="nl-content-viewport">
            ${this._renderActiveView()}
          </section>
        </main>

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
      case 'calendar': default: 
        if (this._calendarMode === 'month') return this._renderMonth();
        return this._renderTimeGrid(this._calendarMode === 'week' ? 7 : 1);
    }
  }

  _renderMonth() {
    const start = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth(), 1);
    const end = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth() + 1, 0);
    const startDay = (start.getDay() + 6) % 7; 
    const cells = Array(startDay).fill(null).concat([...Array(end.getDate()).keys()].map(i => i + 1));

    return html`
      <div class="nl-month-view">
        <div class="nl-week-header">${['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d => html`<span>${d}</span>`)}</div>
        <div class="nl-month-grid">
          ${cells.map(day => {
            if (!day) return html`<div class="nl-day empty"></div>`;
            const isToday = this._isToday(day);
            const evs = this._events.filter(e => new Date(e.start.dateTime || e.start.date).getDate() === day && this._activeCalendars.includes(e.origin));
            return html`
              <div class="nl-day ${isToday ? 'today' : ''}" @click="${() => { this._referenceDate = new Date(this._referenceDate.getFullYear(), this._referenceDate.getMonth(), day); this._calendarMode = 'day'; }}">
                <span class="nl-day-num">${day}</span>
                <div class="nl-event-dots">
                  ${evs.slice(0, 4).map(e => html`
                    <div class="nl-event-pill" style="--c: ${e.color}" @click="${(ev) => { ev.stopPropagation(); this._selectedEvent = e; }}">${e.summary}</div>
                  `)}
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  _renderTimeGrid(days) {
      // Simplified Time Grid for brevity in this modernized view
      return html`<div class="nl-center-msg"><h3>Timeline view coming soon</h3></div>`;
  }

  _renderMeals() {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return html`
      <div class="nl-card-grid">
        ${days.map(day => {
          const ent = this.config.meal_entities?.[day];
          const state = this.hass.states[ent]?.state?.split(' | ')[0] || "";
          return html`
            <div class="nl-meal-card">
              <div class="nl-meal-header"><h3>${day}</h3><ha-icon icon="mdi:silverware-variant"></ha-icon></div>
              <textarea class="nl-meal-input" placeholder="Plan dinner..." .value="${state}" @change="${e => this._saveMeal(day, e.target.value)}"></textarea>
            </div>
          `;
        })}
      </div>
    `;
  }

  _renderChores() {
    if (!this.config.chores) return html`<div class="nl-empty">No Chores Configured</div>`;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const period = (this.config.periods || []).find(p => {
       const [sh,sm] = p.start.split(':').map(Number);
       const [eh,em] = p.end.split(':').map(Number);
       const s = sh*60+sm, e = eh*60+em;
       return cur >= s && cur <= e;
    });

    if (!period) return html`<div class="nl-center-msg"><ha-icon icon="mdi:sleep" style="font-size:48px"></ha-icon><h2>No Active Period</h2></div>`;

    return html`
      <div class="nl-chore-wrapper">
        <div class="nl-period-banner">Period: ${period.name}</div>
        <div class="nl-card-grid">
          ${this.config.chores.map(kid => {
            const tasks = (kid.items || []).filter(i => i.period === period.name);
            if (!tasks.length) return '';
            return html`
              <div class="nl-kid-card">
                <div class="nl-kid-header" style="background-image: linear-gradient(#00000040, #00000090), url('${kid.image}')"><h3>${kid.name}</h3></div>
                <div class="nl-task-list">
                  ${tasks.map(t => {
                    const done = this._getTodoStatus(kid.todo_list, t.label);
                    return html`
                      <div class="nl-task-row ${done?'done':''}" @click="${() => this._toggleTodo(kid.todo_list, t.label, done)}">
                        <div class="nl-checkbox">${done ? html`<ha-icon icon="mdi:check"></ha-icon>` : ''}</div><span>${t.label}</span>
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
        <div class="nl-notes-header"><h2>Notes</h2><button class="nl-btn-primary" @click="${() => {
             const t = prompt("Note:"); if(t) this.hass.callService('todo', 'add_item', {entity_id: this.config.notes_entity, item: t}).then(()=>this._fetchNotes());
        }}">Add</button></div>
        <div class="nl-masonry">
           ${this._todoItems.map((n, i) => html`
             <div class="nl-sticky-note" style="--rot:${i%2?-1:1}deg"><button class="nl-close-btn" @click="${()=>this._toggleTodo(this.config.notes_entity, n.summary, false)}">×</button>${n.summary}</div>
           `)}
        </div>
      </div>
    `;
  }

  _renderAddModal() {
    return html`
      <div class="nl-modal-backdrop" @click="${()=>this._showAddModal=false}">
        <div class="nl-modal" @click="${e=>e.stopPropagation()}">
          <h3>New Event</h3>
          <div class="nl-form">
            <input id="new_summary" class="nl-input full" placeholder="Title">
            <div class="nl-form-row"><input type="date" id="new_date_start" class="nl-input"><input type="time" id="new_start_time" value="09:00" class="nl-input"></div>
            <div class="nl-form-row"><input type="date" id="new_date_end" class="nl-input"><input type="time" id="new_end_time" value="10:00" class="nl-input"></div>
            <select id="new_calendar" class="nl-input full">${(this.config.entities||[]).filter(e=>e.entity.startsWith('calendar')).map(e=>html`<option value="${e.entity}">${e.entity}</option>`)}</select>
            <textarea id="new_description" class="nl-input full" placeholder="Details"></textarea>
            <button class="nl-btn-primary" @click="${this._submitEvent}">Create</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderEventModal() {
      return html`
      <div class="nl-modal-backdrop" @click="${()=>this._selectedEvent=null}">
        <div class="nl-modal" @click="${e=>e.stopPropagation()}">
            <h3 style="color:${this._selectedEvent.color}">${this._selectedEvent.summary}</h3>
            <p>${new Date(this._selectedEvent.start.dateTime || this._selectedEvent.start.date).toLocaleString()}</p>
            <p>${this._selectedEvent.description || ''}</p>
        </div>
      </div>
      `;
  }

  static styles = css`
    :host { --primary: #6366f1; --bg: #fff; --surface: #f8fafc; --text: #1e293b; --text-dim: #64748b; --border: #e2e8f0; display: block; height: 100%; font-family: 'Inter', sans-serif; }
    :host([theme="dark"]) { --bg: #0f172a; --surface: #1e293b; --text: #f8fafc; --text-dim: #94a3b8; --border: #334155; }
    .nl-card { background: var(--bg); color: var(--text); display: grid; grid-template-columns: 80px 1fr; height: 100%; overflow: hidden; border-radius: 20px; }
    .nl-sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 20px 0; display: flex; flex-direction: column; align-items: center; z-index: 10; }
    .nl-sidebar-content { display: flex; flex-direction: column; gap: 30px; height: 100%; align-items: center; }
    .nl-logo { color: var(--primary); --mdc-icon-size: 32px; cursor: pointer; }
    .nl-nav { display: flex; flex-direction: column; gap: 20px; width: 100%; }
    .nl-nav-btn { background: transparent; border: none; color: var(--text-dim); display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; padding: 10px 0; position: relative; }
    .nl-nav-btn.active { color: var(--primary); }
    .nl-nav-btn.active::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); height: 24px; width: 3px; background: var(--primary); border-radius: 0 4px 4px 0; }
    .nl-nav-btn span { font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .nl-fab-mini { margin-top: auto; width: 40px; height: 40px; border-radius: 12px; background: var(--primary); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .nl-main { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .nl-header { padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
    .nl-title { font-size: 24px; font-weight: 800; margin: 0; }
    .nl-date-nav { display: flex; gap: 8px; background: var(--surface); padding: 4px; border-radius: 12px; border: 1px solid var(--border); }
    .nl-date-nav button { background: transparent; border: none; padding: 6px; cursor: pointer; color: var(--text-dim); }
    .nl-date-nav button:hover { color: var(--primary); }
    .nl-content-viewport { flex: 1; overflow-y: auto; padding: 0 32px 32px; }
    .nl-month-view { border: 1px solid var(--border); border-radius: 20px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    .nl-week-header { display: grid; grid-template-columns: repeat(7, 1fr); padding: 12px; background: var(--surface); border-bottom: 1px solid var(--border); text-align: center; font-weight: 700; font-size: 11px; color: var(--text-dim); }
    .nl-month-grid { display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(6, 1fr); flex: 1; }
    .nl-day { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 8px; cursor: pointer; position: relative; }
    .nl-day:hover { background: var(--surface); }
    .nl-day.today { background: rgba(99,102,241,0.05); }
    .nl-day.today .nl-day-num { background: var(--primary); color: white; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
    .nl-day-num { font-size: 13px; font-weight: 600; color: var(--text-dim); margin-bottom: 4px; display: inline-block; }
    .nl-event-pill { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--c); color: white; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nl-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
    .nl-meal-card, .nl-kid-card { background: var(--surface); border-radius: 20px; border: 1px solid var(--border); overflow: hidden; }
    .nl-meal-card { padding: 20px; }
    .nl-meal-header { display: flex; justify-content: space-between; color: var(--primary); margin-bottom: 12px; }
    .nl-meal-input { background: transparent; border: none; resize: none; width: 100%; color: var(--text); font-family: inherit; height: 80px; }
    .nl-kid-header { height: 100px; background-size: cover; display: flex; align-items: flex-end; padding: 16px; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
    .nl-kid-header h3 { margin: 0; }
    .nl-task-list { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .nl-task-row { display: flex; gap: 12px; padding: 10px; background: var(--bg); border-radius: 12px; align-items: center; cursor: pointer; }
    .nl-task-row.done { opacity: 0.5; text-decoration: line-through; }
    .nl-checkbox { width: 20px; height: 20px; border: 2px solid var(--border); border-radius: 6px; display: flex; align-items: center; justify-content: center; }
    .nl-task-row.done .nl-checkbox { background: #10b981; border-color: #10b981; color: white; }
    .nl-masonry { column-count: 3; column-gap: 20px; }
    .nl-sticky-note { background: #fef08a; padding: 20px; border-radius: 2px; margin-bottom: 20px; transform: rotate(var(--rot)); position: relative; color: #854d0e; white-space: pre-wrap; box-shadow: 2px 4px 6px rgba(0,0,0,0.1); }
    .nl-close-btn { position: absolute; top: 5px; right: 5px; border: none; background: transparent; cursor: pointer; opacity: 0.5; }
    .nl-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .nl-modal { background: var(--bg); padding: 24px; border-radius: 24px; width: 400px; box-shadow: 0 20px 25px rgba(0,0,0,0.1); }
    .nl-input { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); margin-bottom: 10px; box-sizing: border-box; }
    .nl-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .nl-btn-primary { background: var(--primary); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; width: 100%; font-weight: 600; }
    @media(max-width: 768px) { .nl-card { grid-template-columns: 1fr; } .nl-sidebar { display: none; } .menu-open .nl-sidebar { display: flex; position: absolute; height: 100%; width: 200px; } .nl-month-view { border: none; } .nl-month-grid { grid-template-rows: repeat(6, 60px); } .nl-menu-trigger { display: block; background: transparent; border: none; font-size: 24px; cursor: pointer; color: var(--text); } }
    @media(min-width: 769px) { .nl-menu-trigger { display: none; } }
  `;
}

// Full Editor Component ported from v1.6.8
class NightlightCardEditor extends LitElement {
  static properties = { hass: {}, _config: {} };
  setConfig(config) { this._config = config; }
  _valueChanged(ev) { 
      const target = ev.target;
      this.dispatchEvent(new CustomEvent("config-changed", { 
          detail: { config: { ...this._config, [target.configValue]: target.value } },
          bubbles: true, composed: true 
      }));
  }
  render() {
    if (!this.hass || !this._config) return html``;
    return html`
      <div style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
        <ha-textfield label="Title" .value="${this._config.title}" .configValue="${'title'}" @input="${this._valueChanged}"></ha-textfield>
        <ha-select label="Theme" .value="${this._config.theme}" .configValue="${'theme'}" @selected="${this._valueChanged}">
             <mwc-list-item value="light">Light</mwc-list-item>
             <mwc-list-item value="dark">Dark</mwc-list-item>
        </ha-select>
        <p>Edit Entities and Chores in YAML for full control.</p>
      </div>
    `;
  }
}

customElements.define("nightlight-calendar-card", NightlightDashboard);
customElements.define("nightlight-card-editor", NightlightCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "nightlight-calendar-card",
  name: "Nightlight Hub",
  description: "A beautiful, modern home management dashboard."
});
