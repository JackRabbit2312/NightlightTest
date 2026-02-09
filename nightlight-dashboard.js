
import { LitElement, html, css } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday, addMonths, subMonths, parseISO, startOfDay } from "https://unpkg.com/date-fns@2.29.3/esm/index.js";

/**
 * Nightlight Dashboard
 * A Kiosk-style dashboard for Home Assistant.
 */
class NightlightDashboard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _activeView: { type: String },
      _currentDate: { type: String }, // Stored as ISO string
      _events: { type: Array },
      _meals: { type: Array },
      _notes: { type: Array },
      _kids: { type: Array },
      _sidebarOpen: { type: Boolean },
      _darkMode: { type: Boolean }
    };
  }

  constructor() {
    super();
    this._activeView = 'calendar';
    this._currentDate = new Date().toISOString();
    this._sidebarOpen = false;
    this._darkMode = false;

    // --- MOCK DATA INITIALIZATION ---
    this._events = [
      { id: 1, title: 'Soccer Practice', date: new Date().toISOString(), color: '#7b61ff', time: '4:00 PM' },
      { id: 2, title: 'Family Dinner', date: new Date().toISOString(), color: '#ff9f1c', time: '6:30 PM' },
      { id: 3, title: 'Grocery Run', date: new Date(Date.now() + 86400000).toISOString(), color: '#2ec4b6', time: '10:00 AM' }
    ];
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

      /* Dark Mode Overrides */
      :host([dark]) {
        --nl-bg: #121212;
        --nl-card-bg: #1e1e1e;
        --nl-text: #e2e8f0;
        --nl-text-light: #94a3b8;
        --nl-border: #333333;
      }

      * { box-sizing: border-box; }

      .app-container {
        display: flex;
        height: 100%;
        width: 100%;
      }

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

      .logo {
        color: var(--nl-accent);
        margin-bottom: 2rem;
      }

      .nav-item {
        width: 100%;
        padding: 1rem 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        cursor: pointer;
        color: var(--nl-text-light);
        border-right: 3px solid transparent;
        transition: all 0.2s;
      }

      .nav-item ha-icon { --mdc-icon-size: 24px; }
      .nav-item span { font-size: 10px; font-weight: bold; text-transform: uppercase; }

      .nav-item.active {
        color: var(--nl-accent);
        background: var(--nl-accent-light);
        border-right-color: var(--nl-accent);
      }

      /* MAIN CONTENT */
      .main {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .header {
        padding: 1.5rem 2rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .header h1 { margin: 0; font-size: 1.5rem; font-weight: 900; }
      .header-right { display: flex; align-items: center; gap: 1rem; }

      .content-area {
        flex: 1;
        padding: 0 2rem 2rem 2rem;
        overflow-y: auto;
      }

      /* CALENDAR VIEW */
      .calendar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }
      
      .month-title { font-size: 1.5rem; font-weight: 800; }

      .calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        height: calc(100% - 60px);
        gap: 0.5rem;
        grid-auto-rows: 1fr;
      }

      .day-header {
        text-align: center;
        font-weight: bold;
        color: var(--nl-text-light);
        text-transform: uppercase;
        font-size: 0.75rem;
        padding-bottom: 0.5rem;
      }

      .day-cell {
        background: var(--nl-card-bg);
        border: 1px solid var(--nl-border);
        border-radius: 12px;
        padding: 0.5rem;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        transition: border-color 0.2s;
      }

      .day-cell:hover { border-color: var(--nl-accent); }
      .day-cell.today { border: 2px solid var(--nl-accent); background: var(--nl-accent-light); }
      .day-cell.dimmed { opacity: 0.4; background: var(--nl-bg); }

      .day-number { font-weight: bold; font-size: 1.1rem; margin-bottom: 0.25rem; }

      .event-dot {
        font-size: 0.65rem;
        padding: 2px 4px;
        border-radius: 4px;
        color: white;
        margin-bottom: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* MEALS VIEW */
      .meals-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1.5rem;
      }
      
      .meal-card {
        background: var(--nl-card-bg);
        border: 1px solid var(--nl-border);
        border-radius: 16px;
        padding: 1.5rem;
      }
      .meal-card h3 { color: var(--nl-accent); margin: 0 0 1rem 0; text-transform: uppercase; font-size: 1rem; }
      .meal-input {
        width: 100%;
        border: none;
        background: transparent;
        font-size: 1.1rem;
        color: var(--nl-text);
        font-family: inherit;
        resize: none;
      }

      /* NOTES VIEW */
      .notes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 1.5rem;
      }
      .note-card {
        min-height: 200px;
        padding: 1.5rem;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-weight: bold;
        color: #333;
        font-family: 'Comic Sans MS', 'Chalkboard SE', sans-serif;
        transform: rotate(-1deg);
      }
      .note-card:nth-child(even) { transform: rotate(1deg); }

      /* CHORES VIEW */
      .chores-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.5rem;
      }
      .kid-card {
        background: var(--nl-card-bg);
        border-radius: 24px;
        overflow: hidden;
        border: 1px solid var(--nl-border);
      }
      .kid-header {
        height: 120px;
        background-size: cover;
        background-position: center;
        position: relative;
        display: flex;
        align-items: flex-end;
        padding: 1rem;
      }
      .kid-header::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
      }
      .kid-name {
        position: relative;
        z-index: 2;
        color: white;
        font-size: 1.5rem;
        font-weight: 900;
      }
      .chore-list { padding: 1rem; }
      .chore-item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem;
        border-radius: 12px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .chore-item:hover { background: var(--nl-bg); }
      .chore-item.done { opacity: 0.5; text-decoration: line-through; }
      .chore-check { color: var(--nl-accent); }

      /* UTILS */
      .btn {
        background: var(--nl-accent);
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
      }
      .icon-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--nl-text);
      }
    `;
  }

  // --- ACTIONS ---
  _navigate(view) {
    this._activeView = view;
  }

  _prevMonth() {
    this._currentDate = subMonths(parseISO(this._currentDate), 1).toISOString();
  }

  _nextMonth() {
    this._currentDate = addMonths(parseISO(this._currentDate), 1).toISOString();
  }

  _toggleDarkMode() {
    this._darkMode = !this._darkMode;
    if (this._darkMode) {
      this.setAttribute('dark', '');
    } else {
      this.removeAttribute('dark');
    }
  }

  _toggleChore(kidId, choreId) {
    this._kids = this._kids.map(k => {
      if (k.id !== kidId) return k;
      return {
        ...k,
        chores: k.chores.map(c => c.id === choreId ? {...c, done: !c.done} : c)
      };
    });
    this.requestUpdate();
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
        <div class="logo">
           <ha-icon icon="mdi:view-dashboard" style="--mdc-icon-size: 32px;"></ha-icon>
        </div>
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

  _renderCalendar() {
    const date = parseISO(this._currentDate);
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return html`
      <div style="height: 100%;">
        <div class="calendar-header">
           <h2 class="month-title">${format(date, 'MMMM yyyy')}</h2>
           <div>
             <button class="icon-btn" @click="${this._prevMonth}"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
             <button class="icon-btn" @click="${this._nextMonth}"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
           </div>
        </div>
        
        <div class="calendar-grid">
           ${weekDays.map(d => html`<div class="day-header">${d}</div>`)}
           
           ${days.map(d => {
             const isCurrMonth = isSameMonth(d, monthStart);
             const isDayToday = isToday(d);
             const dayEvents = this._events.filter(e => isSameDay(parseISO(e.date), d));

             return html`
               <div class="day-cell ${isDayToday ? 'today' : ''} ${!isCurrMonth ? 'dimmed' : ''}">
                 <div class="day-number">${format(d, 'd')}</div>
                 ${dayEvents.map(e => html`
                    <div class="event-dot" style="background-color: ${e.color}">${e.title}</div>
                 `)}
               </div>
             `;
           })}
        </div>
      </div>
    `;
  }

  _renderMeals() {
    return html`
      <h2>Weekly Menu</h2>
      <div class="meals-grid">
        ${this._meals.map(item => html`
          <div class="meal-card">
            <h3>${item.day}</h3>
            <textarea class="meal-input" rows="3">${item.meal}</textarea>
          </div>
        `)}
      </div>
    `;
  }

  _renderNotes() {
    return html`
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
        <h2>Sticky Notes</h2>
        <button class="btn">+ Add Note</button>
      </div>
      <div class="notes-grid">
         ${this._notes.map(note => html`
            <div class="note-card" style="background-color: ${note.color}">
              ${note.content}
            </div>
         `)}
      </div>
    `;
  }

  _renderChores() {
    return html`
      <h2>Chores Tracker</h2>
      <div class="chores-grid">
         ${this._kids.map(kid => html`
           <div class="kid-card">
              <div class="kid-header" style="background-image: url('${kid.image}')">
                 <span class="kid-name">${kid.name}</span>
              </div>
              <div class="chore-list">
                 ${kid.chores.map(chore => html`
                    <div 
                      class="chore-item ${chore.done ? 'done' : ''}" 
                      @click="${() => this._toggleChore(kid.id, chore.id)}"
                    >
                       <ha-icon 
                         class="chore-check" 
                         icon="${chore.done ? 'mdi:check-circle' : 'mdi:circle-outline'}"
                       ></ha-icon>
                       <span>${chore.label}</span>
                    </div>
                 `)}
              </div>
           </div>
         `)}
      </div>
    `;
  }

  render() {
    return html`
      <div class="app-container">
        ${this._renderSidebar()}
        
        <div class="main">
           <div class="header">
             <div style="width: 24px;"></div> <!-- Spacer -->
             <div class="header-right">
                <span>${this.hass ? 'Connected' : 'Demo Mode'}</span>
                <button class="icon-btn" @click="${this._toggleDarkMode}">
                   <ha-icon icon="mdi:theme-light-dark"></ha-icon>
                </button>
             </div>
           </div>

           <div class="content-area">
             ${this._activeView === 'calendar' ? this._renderCalendar() : ''}
             ${this._activeView === 'meals' ? this._renderMeals() : ''}
             ${this._activeView === 'notes' ? this._renderNotes() : ''}
             ${this._activeView === 'chores' ? this._renderChores() : ''}
           </div>
        </div>
      </div>
    `;
  }

  // --- HA SIZING ---
  getCardSize() {
    return 10;
  }
}

customElements.define("nightlight-dashboard", NightlightDashboard);

// Add to picker
window.customCards = window.customCards || [];
window.customCards.push({
  type: "nightlight-dashboard",
  name: "Nightlight Dashboard",
  description: "A complete kiosk dashboard for families.",
  preview: true
});
