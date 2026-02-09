
import { LitElement, html, css } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
import { 
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, 
  isSameMonth, isSameDay, isToday, addMonths, subMonths, parseISO, 
  addDays, subDays, startOfDay, endOfDay, getHours, getMinutes, addHours
} from "https://unpkg.com/date-fns@2.29.3/esm/index.js";

/**
 * Nightlight Dashboard
 * A Kiosk-style dashboard for Home Assistant.
 */
class NightlightDashboard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _activeView: { type: String }, // 'calendar', 'meals', etc.
      _calendarViewMode: { type: String }, // 'month', 'week', 'day', 'agenda'
      _currentDate: { type: String }, // ISO string
      _events: { type: Array },
      _calendars: { type: Array }, // List of calendar entities and their visibility
      _sidebarOpen: { type: Boolean },
      _darkMode: { type: Boolean },
      _selectedEvent: { type: Object }, // For details modal
      _showAddModal: { type: Boolean }, // For add event modal
      _addEventForm: { type: Object } // Form state
    };
  }

  constructor() {
    super();
    this._activeView = 'calendar';
    this._calendarViewMode = 'month';
    this._currentDate = new Date().toISOString();
    this._sidebarOpen = false;
    this._darkMode = false;
    this._events = [];
    this._calendars = [];
    this._selectedEvent = null;
    this._showAddModal = false;
    
    // Default form state
    this._addEventForm = {
      summary: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      startTime: '09:00',
      endTime: '10:00',
      description: '',
      calendar: ''
    };

    // Placeholder data for other tabs
    this._meals = [
      { day: 'Mon', meal: 'Spaghetti Bolognese' },
      { day: 'Tue', meal: 'Taco Tuesday!' },
      { day: 'Wed', meal: 'Grilled Chicken Salad' },
      { day: 'Thu', meal: 'Leftovers' },
      { day: 'Fri', meal: 'Pizza Night 🍕' },
      { day: 'Sat', meal: 'Out for dinner' },
      { day: 'Sun', meal: 'Roast Chicken' }
    ];
    this._notes = [
      { id: 'n1', content: 'Wifi Password: supersecretpass', color: '#fff9c4' },
      { id: 'n2', content: 'Buy milk and eggs', color: '#e1f5fe' }
    ];
    this._kids = [
      { id: 'k1', name: 'Leo', image: 'https://picsum.photos/400/200?random=1', chores: [
          { id: 'c1', label: 'Make Bed', period: 'Morning', done: false },
          { id: 'c2', label: 'Brush Teeth', period: 'Morning', done: true },
          { id: 'c3', label: 'Pack Bag', period: 'Evening', done: false }
      ]},
      { id: 'k2', name: 'Mia', image: 'https://picsum.photos/400/200?random=2', chores: [
          { id: 'c4', label: 'Feed Cat', period: 'Morning', done: false },
          { id: 'c5', label: 'Homework', period: 'Afternoon', done: false }
      ]}
    ];
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this.config = config;
    if (config.theme === 'dark') this._darkMode = true;
    
    // Initialize calendars from config or defaults
    // Expected config: calendar_entities: ['calendar.family', 'calendar.work']
    if (this.config.calendar_entities) {
      this._calendars = this.config.calendar_entities.map((entity_id, index) => ({
        entity_id,
        name: entity_id.split('.')[1], // simplistic name fallback
        color: this._getCalendarColor(index),
        visible: true
      }));
    }
  }

  updated(changedProps) {
    // When HASS is loaded for the first time or Date changes, fetch events
    if (changedProps.has('hass') && !this._hasFetched && this.hass && this.config.calendar_entities) {
      this._hasFetched = true;
      this._fetchEvents();
      
      // Update calendar friendly names if available in HASS
      this._calendars = this._calendars.map(c => {
        const state = this.hass.states[c.entity_id];
        return state ? { ...c, name: state.attributes.friendly_name || c.name } : c;
      });
    }

    if (changedProps.has('_currentDate') || changedProps.has('_calendarViewMode')) {
      this._fetchEvents();
    }
  }

  // --- DATA FETCHING ---
  
  async _fetchEvents() {
    if (!this.hass || !this._calendars.length) return;

    // Calculate range based on view
    const current = parseISO(this._currentDate);
    let start = startOfMonth(current);
    let end = endOfMonth(current);

    // Fetch a bit more for smoother transitions
    start = subDays(start, 7);
    end = addDays(end, 7);

    const startStr = start.toISOString();
    const endStr = end.toISOString();

    const allEvents = [];

    for (const cal of this._calendars) {
      if (!cal.visible) continue;
      
      try {
        const events = await this.hass.callApi(
          'GET', 
          `calendars/${cal.entity_id}?start=${startStr}&end=${endStr}`
        );
        
        events.forEach(e => {
          allEvents.push({
            ...e,
            entity_id: cal.entity_id,
            color: cal.color,
            calendarName: cal.name,
            // Ensure we have Date objects for logic
            startObj: new Date(e.start.dateTime || e.start.date),
            endObj: new Date(e.end.dateTime || e.end.date)
          });
        });
      } catch (err) {
        console.error("Error fetching calendar", cal.entity_id, err);
      }
    }

    this._events = allEvents;
  }

  async _createEvent() {
    if (!this.hass) return;
    
    const { summary, description, date, startTime, endTime, calendar } = this._addEventForm;
    if (!calendar) {
      alert("Please select a calendar");
      return;
    }

    try {
      await this.hass.callService('calendar', 'create_event', {
        entity_id: calendar,
        summary: summary,
        description: description,
        start_date_time: `${date} ${startTime}:00`,
        end_date_time: `${date} ${endTime}:00`
      });
      
      this._showAddModal = false;
      this._fetchEvents(); // Refresh
      // Reset form
      this._addEventForm = { ...this._addEventForm, summary: '', description: '' };
    } catch (err) {
      alert("Error creating event: " + err.message);
    }
  }

  _getCalendarColor(index) {
    const colors = ['#7b61ff', '#ff9f1c', '#2ec4b6', '#e71d36', '#3f37c9', '#4cc9f0'];
    return colors[index % colors.length];
  }

  // --- STYLES ---
  static get styles() {
    return css`
      :host {
        --nl-bg: #f8fafc;
        --nl-card-bg: #ffffff;
        --nl-text: #1e293b;
        --nl-text-light: #64748b;
        --nl-accent: #7b61ff;
        --nl-accent-light: rgba(123, 97, 255, 0.1);
        --nl-border: #e2e8f0;
        font-family: 'Inter', sans-serif;
        display: block;
        height: 100vh;
        width: 100%;
        overflow: hidden;
        background-color: var(--nl-bg);
        color: var(--nl-text);
        box-sizing: border-box;
      }

      :host([dark]) {
        --nl-bg: #121212;
        --nl-card-bg: #1e1e1e;
        --nl-text: #e2e8f0;
        --nl-text-light: #94a3b8;
        --nl-border: #333333;
      }

      * { box-sizing: border-box; }
      
      /* SCROLLBARS */
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: var(--nl-border); border-radius: 3px; }

      .app-container { display: flex; height: 100%; width: 100%; }

      /* SIDEBAR */
      .sidebar {
        width: 90px;
        background: var(--nl-card-bg);
        border-right: 1px solid var(--nl-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 2rem;
        z-index: 50;
      }
      .logo { color: var(--nl-accent); margin-bottom: 2rem; }
      .nav-item {
        width: 100%; padding: 1rem 0; display: flex; flex-direction: column;
        align-items: center; gap: 0.25rem; cursor: pointer; color: var(--nl-text-light);
        border-right: 3px solid transparent; transition: all 0.2s;
      }
      .nav-item ha-icon { --mdc-icon-size: 24px; }
      .nav-item span { font-size: 10px; font-weight: bold; text-transform: uppercase; }
      .nav-item.active { color: var(--nl-accent); background: var(--nl-accent-light); border-right-color: var(--nl-accent); }

      /* MAIN */
      .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
      .header { padding: 1.5rem 2rem; display: flex; justify-content: space-between; align-items: center; }
      .header h1 { margin: 0; font-size: 1.5rem; font-weight: 900; }
      .header-right { display: flex; align-items: center; gap: 1rem; }
      .content-area { flex: 1; padding: 0 2rem 2rem 2rem; overflow-y: auto; display: flex; flex-direction: column; }

      /* CALENDAR CONTROLS */
      .calendar-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem;}
      .view-switcher { background: var(--nl-card-bg); border: 1px solid var(--nl-border); border-radius: 8px; overflow: hidden; display: flex; }
      .view-btn { padding: 0.5rem 1rem; border: none; background: transparent; color: var(--nl-text-light); cursor: pointer; font-weight: bold; font-size: 0.8rem; }
      .view-btn.active { background: var(--nl-accent); color: white; }
      
      .calendar-toggles { display: flex; gap: 0.5rem; align-items: center; }
      .cal-chip { 
        padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: bold; 
        cursor: pointer; display: flex; align-items: center; gap: 0.25rem; border: 1px solid transparent; opacity: 0.5; transition: opacity 0.2s;
        color: var(--nl-text);
      }
      .cal-chip.active { opacity: 1; border-color: currentColor; }
      .cal-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

      /* MONTH GRID */
      .month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; height: 100%; grid-auto-rows: 1fr; }
      .day-header { text-align: center; font-weight: bold; color: var(--nl-text-light); font-size: 0.75rem; padding-bottom: 0.5rem; }
      .day-cell { 
        background: var(--nl-card-bg); border: 1px solid var(--nl-border); border-radius: 12px; 
        padding: 0.5rem; cursor: pointer; display: flex; flex-direction: column; overflow: hidden;
      }
      .day-cell:hover { border-color: var(--nl-accent); }
      .day-cell.today { border: 2px solid var(--nl-accent); background: var(--nl-accent-light); }
      .day-cell.dimmed { opacity: 0.4; background: var(--nl-bg); }
      .day-number { font-weight: bold; font-size: 1.1rem; margin-bottom: 0.25rem; }
      .event-dot { 
        font-size: 0.65rem; padding: 2px 4px; border-radius: 4px; color: white; margin-bottom: 2px; 
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
      }

      /* WEEK/DAY GRID */
      .time-grid-container { display: flex; height: 100%; overflow-y: auto; background: var(--nl-card-bg); border-radius: 12px; border: 1px solid var(--nl-border); position: relative; }
      .time-column { width: 60px; flex-shrink: 0; border-right: 1px solid var(--nl-border); }
      .time-slot { height: 60px; border-bottom: 1px solid var(--nl-bg); font-size: 0.7rem; color: var(--nl-text-light); text-align: right; padding-right: 0.5rem; padding-top: 0.5rem; }
      .days-container { flex: 1; display: flex; position: relative; }
      .day-column { flex: 1; border-right: 1px solid var(--nl-border); position: relative; min-width: 100px; }
      .day-col-header { height: 40px; border-bottom: 1px solid var(--nl-border); text-align: center; font-weight: bold; padding-top: 0.5rem; position: sticky; top: 0; background: var(--nl-card-bg); z-index: 10;}
      .grid-lines { position: absolute; inset: 0; pointer-events: none; }
      .grid-line { height: 60px; border-bottom: 1px solid var(--nl-bg); }
      .event-block {
        position: absolute; left: 2px; right: 2px; padding: 4px; border-radius: 6px; color: white; font-size: 0.75rem;
        overflow: hidden; cursor: pointer; z-index: 5; box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      /* AGENDA */
      .agenda-list { display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; }
      .agenda-item { 
        display: flex; gap: 1rem; padding: 1rem; background: var(--nl-card-bg); border-radius: 12px; 
        border: 1px solid var(--nl-border); cursor: pointer; align-items: center;
      }
      .agenda-date { display: flex; flex-direction: column; align-items: center; min-width: 60px; font-weight: bold; }
      .agenda-day { font-size: 1.5rem; color: var(--nl-accent); }
      .agenda-month { font-size: 0.75rem; color: var(--nl-text-light); uppercase; }
      .agenda-details h4 { margin: 0 0 0.25rem 0; font-size: 1.1rem; }
      .agenda-time { font-size: 0.8rem; color: var(--nl-text-light); display: flex; align-items: center; gap: 0.5rem; }

      /* MODALS */
      .modal-overlay { 
        position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; 
        display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px);
      }
      .modal { background: var(--nl-card-bg); width: 90%; max-width: 500px; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
      .modal-header { padding: 1.5rem; background: var(--nl-accent); color: white; display: flex; justify-content: space-between; align-items: flex-start; }
      .modal-header h2 { margin: 0; font-size: 1.5rem; }
      .close-btn { background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      .modal-body { padding: 2rem; }
      .detail-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; color: var(--nl-text); }
      .modal-footer { padding: 1.5rem; background: var(--nl-bg); display: flex; justify-content: flex-end; gap: 1rem; }

      /* FORMS */
      .form-group { margin-bottom: 1rem; }
      .form-label { display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem; color: var(--nl-text-light); }
      .form-input, .form-select { 
        width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--nl-border); 
        background: var(--nl-bg); color: var(--nl-text); font-size: 1rem; 
      }
      .btn { background: var(--nl-accent); color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 12px; cursor: pointer; font-weight: bold; }
      .btn-ghost { background: transparent; color: var(--nl-text); border: 1px solid var(--nl-border); }

      /* UTILS */
      .icon-btn { background: transparent; border: none; cursor: pointer; color: var(--nl-text); }
      
      /* OTHER VIEWS STUBS */
      .meals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; }
      .meal-card { background: var(--nl-card-bg); border: 1px solid var(--nl-border); border-radius: 16px; padding: 1.5rem; }
      .meal-card h3 { color: var(--nl-accent); margin: 0 0 1rem 0; text-transform: uppercase; font-size: 1rem; }
      .meal-input { width: 100%; border: none; background: transparent; font-size: 1.1rem; color: var(--nl-text); font-family: inherit; resize: none; }
      .notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.5rem; }
      .note-card { min-height: 200px; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; text-align: center; font-weight: bold; color: #333; font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif; transform: rotate(-1deg); }
      .chores-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
      .kid-card { background: var(--nl-card-bg); border-radius: 24px; overflow: hidden; border: 1px solid var(--nl-border); }
      .kid-header { height: 120px; background-size: cover; background-position: center; position: relative; display: flex; align-items: flex-end; padding: 1rem; }
      .kid-name { position: relative; z-index: 2; color: white; font-size: 1.5rem; font-weight: 900; }
      .chore-item { display: flex; align-items: center; gap: 1rem; padding: 0.75rem; border-radius: 12px; cursor: pointer; transition: background 0.2s; }
      .chore-item.done { opacity: 0.5; text-decoration: line-through; }
      .chore-check { color: var(--nl-accent); }
    `;
  }

  // --- ACTIONS ---
  _navigate(view) { this._activeView = view; }
  
  _setCalendarView(mode) { 
    this._calendarViewMode = mode;
    this._fetchEvents();
  }

  _changeDate(delta) {
    const d = parseISO(this._currentDate);
    if (this._calendarViewMode === 'month') this._currentDate = addMonths(d, delta).toISOString();
    else if (this._calendarViewMode === 'week') this._currentDate = addDays(d, delta * 7).toISOString();
    else this._currentDate = addDays(d, delta).toISOString();
  }

  _toggleCalendar(entityId) {
    this._calendars = this._calendars.map(c => 
      c.entity_id === entityId ? { ...c, visible: !c.visible } : c
    );
    this._fetchEvents();
  }

  // --- RENDERERS ---

  _renderSidebar() {
    const items = [
      { id: 'calendar', label: 'Calendar', icon: 'mdi:calendar' },
      { id: 'meals', label: 'Meals', icon: 'mdi:silverware' },
      { id: 'notes', label: 'Notes', icon: 'mdi:note-text' },
      { id: 'chores', label: 'Chores', icon: 'mdi:checkbox-marked-circle-outline' }
    ];

    return html`
      <div class="sidebar">
        <div class="logo"><ha-icon icon="mdi:view-dashboard" style="--mdc-icon-size: 32px;"></ha-icon></div>
        ${items.map(item => html`
          <div 
            class="nav-item ${this._activeView === item.id ? 'active' : ''}" 
            @click="${() => this._navigate(item.id)}"
          >
            <ha-icon icon="${item.icon}"></ha-icon>
            <span>${item.label}</span>
          </div>
        `)}
      </div>
    `;
  }

  _renderCalendarControls() {
    const date = parseISO(this._currentDate);
    let title = format(date, 'MMMM yyyy');
    if (this._calendarViewMode === 'day') title = format(date, 'MMMM d, yyyy');
    
    return html`
      <div class="calendar-controls">
        <div style="display:flex; align-items:center; gap: 1rem;">
          <h2 style="margin:0; min-width: 200px;">${title}</h2>
          <div>
            <button class="icon-btn" @click="${() => this._changeDate(-1)}"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
            <button class="icon-btn" @click="${() => this._changeDate(1)}"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
          </div>
          <button class="btn" @click="${() => this._showAddModal = true}">+ Add Event</button>
        </div>

        <div class="view-switcher">
          ${['month', 'week', 'day', 'agenda'].map(m => html`
            <button 
              class="view-btn ${this._calendarViewMode === m ? 'active' : ''}" 
              @click="${() => this._setCalendarView(m)}"
            >
              ${m.toUpperCase()}
            </button>
          `)}
        </div>
      </div>
      
      <div class="calendar-controls">
        <span style="font-size:0.8rem; font-weight:bold; color:var(--nl-text-light);">CALENDARS:</span>
        <div class="calendar-toggles">
           ${this._calendars.map(c => html`
             <div 
               class="cal-chip ${c.visible ? 'active' : ''}" 
               style="color: ${c.color}"
               @click="${() => this._toggleCalendar(c.entity_id)}"
             >
               <div class="cal-dot"></div>
               ${c.name}
             </div>
           `)}
        </div>
      </div>
    `;
  }

  _renderMonthView(date) {
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return html`
      <div class="month-grid">
         ${weekDays.map(d => html`<div class="day-header">${d}</div>`)}
         ${days.map(d => {
           const isCurrMonth = isSameMonth(d, monthStart);
           const isDayToday = isToday(d);
           const dayEvents = this._events.filter(e => isSameDay(e.startObj, d));

           return html`
             <div 
               class="day-cell ${isDayToday ? 'today' : ''} ${!isCurrMonth ? 'dimmed' : ''}"
               @click="${() => { this._currentDate = d.toISOString(); this._calendarViewMode = 'day'; }}"
             >
               <div class="day-number">${format(d, 'd')}</div>
               ${dayEvents.map(e => html`
                  <div 
                    class="event-dot" 
                    style="background-color: ${e.color}"
                    @click="${(ev) => { ev.stopPropagation(); this._selectedEvent = e; }}"
                  >
                    ${e.summary}
                  </div>
               `)}
             </div>
           `;
         })}
      </div>
    `;
  }

  _renderTimeGrid(date, mode) {
    // Mode is 'week' or 'day'
    let startDate, endDate, days;
    
    if (mode === 'week') {
      startDate = startOfWeek(date, { weekStartsOn: 1 });
      endDate = endOfWeek(date, { weekStartsOn: 1 });
      days = eachDayOfInterval({ start: startDate, end: endDate });
    } else {
      startDate = date;
      days = [date];
    }

    const hours = Array.from({ length: 24 }, (_, i) => i);

    return html`
      <div class="time-grid-container">
        <!-- Time Column -->
        <div class="time-column">
          <div style="height:40px;"></div> <!-- Header spacer -->
          ${hours.map(h => html`<div class="time-slot">${h}:00</div>`)}
        </div>

        <!-- Days -->
        <div class="days-container">
           ${days.map(d => {
             const dayEvents = this._events.filter(e => isSameDay(e.startObj, d));
             return html`
               <div class="day-column">
                  <div class="day-col-header">
                     <div>${format(d, 'EEE')}</div>
                     <div style="font-size: 1.2rem;">${format(d, 'd')}</div>
                  </div>
                  <div style="position: relative; height: 1440px;"> <!-- 24h * 60px -->
                     ${hours.map(() => html`<div class="grid-line"></div>`)}
                     
                     ${dayEvents.map(e => {
                       const startH = getHours(e.startObj) + (getMinutes(e.startObj)/60);
                       const endH = getHours(e.endObj) + (getMinutes(e.endObj)/60);
                       const duration = Math.max(endH - startH, 0.5); // Min 30 mins visual
                       
                       return html`
                         <div 
                           class="event-block"
                           style="top: ${startH * 60}px; height: ${duration * 60}px; background-color: ${e.color};"
                           @click="${(ev) => { ev.stopPropagation(); this._selectedEvent = e; }}"
                         >
                           <strong>${e.summary}</strong>
                           <div>${format(e.startObj, 'h:mm a')}</div>
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

  _renderAgendaView() {
    const sorted = [...this._events]
      .filter(e => e.startObj >= startOfDay(new Date())) // Only future/today
      .sort((a,b) => a.startObj - b.startObj)
      .slice(0, 20); // Limit

    return html`
      <div class="agenda-list">
         ${sorted.length === 0 ? html`<div style="text-align:center; padding: 2rem; color:var(--nl-text-light)">No upcoming events found.</div>` : ''}
         ${sorted.map(e => html`
            <div class="agenda-item" @click="${() => this._selectedEvent = e}">
               <div class="agenda-date">
                  <span class="agenda-month">${format(e.startObj, 'MMM')}</span>
                  <span class="agenda-day">${format(e.startObj, 'd')}</span>
               </div>
               <div class="agenda-details">
                  <h4>${e.summary}</h4>
                  <div class="agenda-time">
                     <ha-icon icon="mdi:clock-outline" style="--mdc-icon-size:16px"></ha-icon>
                     ${format(e.startObj, 'h:mm a')} - ${format(e.endObj, 'h:mm a')}
                     <span style="color: ${e.color}; margin-left: 0.5rem; font-weight:bold; font-size:0.7rem; text-transform:uppercase; padding: 2px 6px; background: color-mix(in srgb, ${e.color}, white 80%); border-radius: 4px;">
                       ${e.calendarName}
                     </span>
                  </div>
               </div>
            </div>
         `)}
      </div>
    `;
  }

  // --- MODALS ---

  _renderEventDetails() {
    if (!this._selectedEvent) return '';
    const e = this._selectedEvent;
    
    return html`
      <div class="modal-overlay" @click="${() => this._selectedEvent = null}">
        <div class="modal" @click="${(ev) => ev.stopPropagation()}">
           <div class="modal-header" style="background-color: ${e.color}">
              <h2>${e.summary}</h2>
              <button class="close-btn" @click="${() => this._selectedEvent = null}"><ha-icon icon="mdi:close"></ha-icon></button>
           </div>
           <div class="modal-body">
              <div class="detail-row">
                 <ha-icon icon="mdi:calendar"></ha-icon>
                 <div>
                    <strong>Date:</strong><br>
                    ${format(e.startObj, 'PPPP')}
                 </div>
              </div>
              <div class="detail-row">
                 <ha-icon icon="mdi:clock-time-four-outline"></ha-icon>
                 <div>
                    <strong>Time:</strong><br>
                    ${format(e.startObj, 'h:mm a')} - ${format(e.endObj, 'h:mm a')}
                 </div>
              </div>
              ${e.location ? html`
                <div class="detail-row">
                   <ha-icon icon="mdi:map-marker"></ha-icon>
                   <div><strong>Location:</strong><br>${e.location}</div>
                </div>
              ` : ''}
              ${e.description ? html`
                 <div class="detail-row" style="align-items:flex-start">
                    <ha-icon icon="mdi:text"></ha-icon>
                    <div style="white-space: pre-wrap;">${e.description}</div>
                 </div>
              ` : ''}
              <div class="detail-row">
                 <ha-icon icon="mdi:folder-outline"></ha-icon>
                 <div>Calendar: ${e.calendarName}</div>
              </div>
           </div>
        </div>
      </div>
    `;
  }

  _renderAddEventModal() {
    if (!this._showAddModal) return '';

    return html`
      <div class="modal-overlay" @click="${() => this._showAddModal = false}">
        <div class="modal" @click="${(ev) => ev.stopPropagation()}">
           <div class="modal-header">
              <h2>Add New Event</h2>
              <button class="close-btn" @click="${() => this._showAddModal = false}"><ha-icon icon="mdi:close"></ha-icon></button>
           </div>
           <div class="modal-body">
              <div class="form-group">
                 <label class="form-label">Summary</label>
                 <input 
                   class="form-input" type="text" placeholder="e.g. Soccer Practice"
                   .value="${this._addEventForm.summary}"
                   @input="${(e) => this._addEventForm = {...this._addEventForm, summary: e.target.value}}"
                 >
              </div>
              
              <div style="display:flex; gap:1rem;">
                <div class="form-group" style="flex:1">
                   <label class="form-label">Date</label>
                   <input 
                     class="form-input" type="date"
                     .value="${this._addEventForm.date}"
                     @input="${(e) => this._addEventForm = {...this._addEventForm, date: e.target.value}}"
                   >
                </div>
                <div class="form-group" style="flex:1">
                   <label class="form-label">Start Time</label>
                   <input 
                     class="form-input" type="time"
                     .value="${this._addEventForm.startTime}"
                     @input="${(e) => this._addEventForm = {...this._addEventForm, startTime: e.target.value}}"
                   >
                </div>
                <div class="form-group" style="flex:1">
                   <label class="form-label">End Time</label>
                   <input 
                     class="form-input" type="time"
                     .value="${this._addEventForm.endTime}"
                     @input="${(e) => this._addEventForm = {...this._addEventForm, endTime: e.target.value}}"
                   >
                </div>
              </div>

              <div class="form-group">
                 <label class="form-label">Calendar</label>
                 <select 
                   class="form-select"
                   @change="${(e) => this._addEventForm = {...this._addEventForm, calendar: e.target.value}}"
                 >
                   <option value="">Select a calendar...</option>
                   ${this._calendars.map(c => html`
                     <option value="${c.entity_id}">${c.name}</option>
                   `)}
                 </select>
              </div>

              <div class="form-group">
                 <label class="form-label">Description (Optional)</label>
                 <textarea 
                   class="form-input" rows="3"
                   .value="${this._addEventForm.description}"
                   @input="${(e) => this._addEventForm = {...this._addEventForm, description: e.target.value}}"
                 ></textarea>
              </div>
           </div>
           <div class="modal-footer">
              <button class="btn btn-ghost" @click="${() => this._showAddModal = false}">Cancel</button>
              <button class="btn" @click="${this._createEvent}">Create Event</button>
           </div>
        </div>
      </div>
    `;
  }

  // --- MAIN RENDER ---

  render() {
    const d = parseISO(this._currentDate);
    
    return html`
      <div class="app-container">
        ${this._renderSidebar()}
        
        <div class="main">
           <div class="header">
             <div style="width: 24px;"></div>
             <div class="header-right">
                <span>${this.hass ? 'Connected' : 'Demo Mode'}</span>
                <button class="icon-btn" @click="${this._toggleDarkMode}">
                   <ha-icon icon="mdi:theme-light-dark"></ha-icon>
                </button>
             </div>
           </div>

           <div class="content-area">
             ${this._activeView === 'calendar' ? html`
                ${this._renderCalendarControls()}
                <div style="flex: 1; min-height:0;">
                   ${this._calendarViewMode === 'month' ? this._renderMonthView(d) : ''}
                   ${this._calendarViewMode === 'week' ? this._renderTimeGrid(d, 'week') : ''}
                   ${this._calendarViewMode === 'day' ? this._renderTimeGrid(d, 'day') : ''}
                   ${this._calendarViewMode === 'agenda' ? this._renderAgendaView() : ''}
                </div>
             ` : ''}

             ${this._activeView === 'meals' ? this._renderMeals() : ''}
             ${this._activeView === 'notes' ? this._renderNotes() : ''}
             ${this._activeView === 'chores' ? this._renderChores() : ''}
           </div>
        </div>
      </div>
      
      ${this._renderEventDetails()}
      ${this._renderAddEventModal()}
    `;
  }

  getCardSize() { return 10; }
}

customElements.define("nightlight-dashboard", NightlightDashboard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "nightlight-dashboard",
  name: "Nightlight Dashboard",
  description: "A complete kiosk dashboard for families.",
  preview: true
});
