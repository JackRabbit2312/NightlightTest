/**
 * Nightlight Dashboard - Interactive Live Preview & Web Developer Specification Hub
 */

interface MacroInfo {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface RecipeItem {
  id: string;
  title: string;
  url: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  macros: MacroInfo;
}

interface MealItem {
  date: string;
  recipeId: string;
  recipeTitle: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  macros?: {
    cal: number;
    pro: number;
    carbs: number;
    fat: number;
  };
  url?: string;
}

interface ShoppingItem {
  id: string;
  name: string;
  category: string;
  amount: number;
  unit: string;
  checked: boolean;
}

// Initial mock dataset
const INITIAL_RECIPES: RecipeItem[] = [
  {
    id: "rec_chicken_curry",
    title: "Creamy Coconut Chicken Curry",
    url: "https://my-family-meals.example.com/recipe/rec_chicken_curry",
    prepTime: 15,
    cookTime: 25,
    servings: 4,
    macros: { calories: 580, protein: 42, carbs: 24, fat: 32 }
  },
  {
    id: "rec_salmon_bowl",
    title: "Teriyaki Salmon & Quinoa Bowl",
    url: "https://my-family-meals.example.com/recipe/rec_salmon_bowl",
    prepTime: 10,
    cookTime: 15,
    servings: 2,
    macros: { calories: 520, protein: 38, carbs: 45, fat: 18 }
  },
  {
    id: "rec_beef_tacos",
    title: "Fiesta Ground Beef Tacos",
    url: "https://my-family-meals.example.com/recipe/rec_beef_tacos",
    prepTime: 10,
    cookTime: 15,
    servings: 4,
    macros: { calories: 640, protein: 36, carbs: 48, fat: 28 }
  },
  {
    id: "rec_veg_lasagna",
    title: "Roasted Vegetable Lasagna",
    url: "https://my-family-meals.example.com/recipe/rec_veg_lasagna",
    prepTime: 25,
    cookTime: 45,
    servings: 6,
    macros: { calories: 480, protein: 22, carbs: 54, fat: 16 }
  }
];

function getInitialMeals(): MealItem[] {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(today);
  monday.setDate(diffToMonday);

  const formatDate = (offset: number) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  return [
    {
      date: formatDate(0), // Monday
      recipeId: "rec_chicken_curry",
      recipeTitle: "Creamy Coconut Chicken Curry",
      macros: { cal: 580, pro: 42, carbs: 24, fat: 32 },
      url: "https://my-family-meals.example.com/recipe/rec_chicken_curry"
    },
    {
      date: formatDate(2), // Wednesday
      recipeId: "rec_salmon_bowl",
      recipeTitle: "Teriyaki Salmon & Quinoa Bowl",
      macros: { cal: 520, pro: 38, carbs: 45, fat: 18 },
      url: "https://my-family-meals.example.com/recipe/rec_salmon_bowl"
    },
    {
      date: formatDate(4), // Friday
      recipeId: "rec_beef_tacos",
      recipeTitle: "Fiesta Ground Beef Tacos",
      macros: { cal: 640, pro: 36, carbs: 48, fat: 28 },
      url: "https://my-family-meals.example.com/recipe/rec_beef_tacos"
    }
  ];
}

const INITIAL_SHOPPING: ShoppingItem[] = [
  { id: "shop_1", name: "Whole Milk", category: "Dairy", amount: 2, unit: "L", checked: false },
  { id: "shop_2", name: "Chicken Breasts", category: "Meat & Seafood", amount: 800, unit: "g", checked: false },
  { id: "shop_3", name: "Avocados", category: "Produce", amount: 4, unit: "", checked: false },
  { id: "shop_4", name: "Coconut Milk Cans", category: "Pantry", amount: 2, unit: "can", checked: false },
  { id: "shop_5", name: "Fresh Cilantro", category: "Produce", amount: 1, unit: "bunch", checked: true },
  { id: "shop_6", name: "Jasmine Rice", category: "Pantry", amount: 1, unit: "kg", checked: true }
];

class DashboardPreviewApp {
  private recipes: RecipeItem[] = [...INITIAL_RECIPES];
  private meals: MealItem[] = getInitialMeals();
  private shopping: ShoppingItem[] = [...INITIAL_SHOPPING];
  private activeTab: 'preview' | 'specs' | 'ha_config' | 'api_tester' = 'preview';
  private cardElement: any = null;

  init() {
    this.renderLayout();
    this.mountCard();
  }

  private getHassObject() {
    return {
      states: {
        'sensor.meal_planner_recipes': {
          state: String(this.recipes.length),
          attributes: {
            recipes: this.recipes,
            friendly_name: "Meal Planner Recipes"
          }
        },
        'sensor.meal_planner_weekly_meals': {
          state: String(this.meals.length),
          attributes: {
            meals: this.meals,
            friendly_name: "Meal Planner Weekly Meals"
          }
        },
        'sensor.meal_planner_shopping_list': {
          state: String(this.shopping.length),
          attributes: {
            shopping_list: this.shopping,
            friendly_name: "Meal Planner Shopping List"
          }
        },
        'input_select.family_dashboard_view': {
          state: 'Nightlight',
          attributes: {
            options: ['Nightlight', 'Meals', 'Shopping', 'Chores', 'Calendar']
          }
        },
        'todo.family_whiteboard_notes': {
          state: '2',
          attributes: {
            friendly_name: "Family Notes"
          }
        }
      },
      callWS: async (msg: any) => {
        if (msg.type === 'todo/item/list') {
          return {
            items: [
              { uid: 'n1', summary: 'Remember dentist appointment Thursday at 3pm!', status: 'needs_action' },
              { uid: 'n2', summary: 'Soccer practice moved to Field 4.', status: 'needs_action' }
            ]
          };
        }
        if (msg.type === 'calendar/event/list') {
          const now = new Date();
          return {
            events: [
              {
                start: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString() },
                end: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30).toISOString() },
                summary: 'Team Standup & Planning',
                description: 'Weekly team synchronisation'
              },
              {
                start: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 0).toISOString() },
                end: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 15, 0).toISOString() },
                summary: 'Kids Swimming Lesson',
                description: 'Community pool'
              }
            ]
          };
        }
        return {};
      },
      callService: async (domain: string, service: string, data: any) => {
        console.log(`[HA Service Call] ${domain}.${service}`, data);

        if (domain === 'rest_command') {
          if (service === 'meal_planner_upsert_weekly_meal') {
            const index = this.meals.findIndex(m => m.date === data.date || m.date === data.id);
            const updatedMeal: MealItem = {
              date: data.date || data.id,
              recipeId: data.recipe_id,
              recipeTitle: data.recipe_title,
              prepTime: Number(data.prep_time || 0),
              cookTime: Number(data.cook_time || 0),
              servings: Number(data.servings || 2),
              macros: {
                cal: Number(data.calories || 0),
                pro: Number(data.protein || 0),
                carbs: Number(data.carbs || 0),
                fat: Number(data.fat || 0)
              }
            };
            if (index >= 0) {
              this.meals[index] = updatedMeal;
            } else {
              this.meals.push(updatedMeal);
            }
            this.syncHass();
          } else if (service === 'meal_planner_delete_weekly_meal') {
            this.meals = this.meals.filter(m => m.date !== data.id && m.date !== data.date);
            this.syncHass();
          } else if (service === 'meal_planner_upsert_shopping_item') {
            const index = this.shopping.findIndex(s => s.id === data.id);
            const isChecked = String(data.checked) === 'true';
            const item: ShoppingItem = {
              id: data.id || ('shop_' + Date.now()),
              name: data.name,
              category: data.category || 'Other',
              amount: Number(data.amount || 1),
              unit: data.unit || '',
              checked: isChecked
            };
            if (index >= 0) {
              this.shopping[index] = item;
            } else {
              this.shopping.unshift(item);
            }
            this.syncHass();
          } else if (service === 'meal_planner_delete_shopping_item') {
            this.shopping = this.shopping.filter(s => s.id !== data.id);
            this.syncHass();
          }
        } else if (domain === 'homeassistant' && service === 'update_entity') {
          this.syncHass();
        }
      }
    };
  }

  private syncHass() {
    if (this.cardElement) {
      this.cardElement.hass = this.getHassObject();
      this.cardElement.requestUpdate?.();
    }
  }

  private mountCard() {
    const container = document.getElementById('card-host');
    if (!container) return;

    container.innerHTML = '';
    const card = document.createElement('nightlight-dashboard-card') as any;
    card.setConfig({
      title: "Nightlight Family Hub",
      logo_url: "",
      theme: "light",
      website_url: "https://my-family-meals.example.com",
      meals_sensor: "sensor.meal_planner_weekly_meals",
      recipes_sensor: "sensor.meal_planner_recipes",
      shopping_sensor: "sensor.meal_planner_shopping_list",
      notes_entity: "todo.family_whiteboard_notes",
      view_controller: "input_select.family_dashboard_view",
      navigation: [
        { id: "calendar", name: "Calendar", icon: "mdi:calendar-month-outline" },
        { id: "meals", name: "Meals", icon: "mdi:silverware-fork-knife" },
        { id: "shopping", name: "Shopping", icon: "mdi:cart-outline" },
        { id: "whiteboard", name: "Whiteboard", icon: "mdi:bulletin-board" },
        { id: "chores", name: "Chores", icon: "mdi:checkbox-marked-circle-outline" }
      ],
      entities: [
        { entity: "calendar.personal", color: "#3B82F6", name: "Family Calendar" }
      ],
      chores: {
        "Alex": [
          { name: "Make Bed", period: "morning" },
          { name: "Pack Backpack", period: "morning" },
          { name: "Read 20 Mins", period: "evening" }
        ],
        "Emma": [
          { name: "Feed Pets", period: "morning" },
          { name: "Clean Desk", period: "afternoon" },
          { name: "Brush Teeth", period: "evening" }
        ]
      }
    });

    card.hass = this.getHassObject();
    container.appendChild(card);
    this.cardElement = card;
  }

  renderLayout() {
    const root = document.getElementById('root');
    if (!root) return;

    root.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column;">
        <!-- Top Navbar -->
        <header style="background: #0f172a; color: #f8fafc; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #334155; position: sticky; top: 0; z-index: 100;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #3b82f6, #6366f1); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; color: white;">
              N
            </div>
            <div>
              <div style="font-size: 16px; font-weight: 700; letter-spacing: -0.2px;">Nightlight Dashboard Card</div>
              <div style="font-size: 11px; color: #94a3b8;">Home Assistant Custom Lovelace Card & Website API Specification</div>
            </div>
          </div>

          <!-- Navigation Tabs -->
          <nav style="display: flex; gap: 6px; background: #1e293b; padding: 4px; border-radius: 10px; border: 1px solid #334155;">
            <button id="tab-preview" class="nav-tab ${this.activeTab === 'preview' ? 'active' : ''}" style="${this.getTabStyle(this.activeTab === 'preview')}">
              Interactive Card Preview
            </button>
            <button id="tab-specs" class="nav-tab ${this.activeTab === 'specs' ? 'active' : ''}" style="${this.getTabStyle(this.activeTab === 'specs')}">
              Web Developer API Specs
            </button>
            <button id="tab-ha-config" class="nav-tab ${this.activeTab === 'ha_config' ? 'active' : ''}" style="${this.getTabStyle(this.activeTab === 'ha_config')}">
              HA Configuration (YAML)
            </button>
          </nav>
        </header>

        <!-- Main Workspace -->
        <main style="flex: 1; padding: 24px; max-width: 1500px; margin: 0 auto; width: 100%;">
          <div id="content-preview" style="display: ${this.activeTab === 'preview' ? 'block' : 'none'};">
            <!-- Controls Bar -->
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 20px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              <div style="display: flex; align-items: center; gap: 16px;">
                <span style="font-weight: 600; font-size: 14px; color: #334155;">Quick View Switcher:</span>
                <button class="btn-view" data-view="calendar" style="padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; font-size: 13px; font-weight: 600; cursor: pointer;">📅 Calendar</button>
                <button class="btn-view" data-view="meals" style="padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; font-size: 13px; font-weight: 600; cursor: pointer;">🍽️ Meals</button>
                <button class="btn-view" data-view="shopping" style="padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; font-size: 13px; font-weight: 600; cursor: pointer;">🛒 Shopping List</button>
                <button class="btn-view" data-view="whiteboard" style="padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; font-size: 13px; font-weight: 600; cursor: pointer;">📌 Whiteboard</button>
                <button class="btn-view" data-view="chores" style="padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; font-size: 13px; font-weight: 600; cursor: pointer;">⭐ Chores</button>
              </div>

              <div style="display: flex; gap: 10px;">
                <button id="btn-seed" style="padding: 6px 14px; border-radius: 6px; background: #3b82f6; color: white; border: none; font-size: 13px; font-weight: 600; cursor: pointer;">Reset Sample Data</button>
              </div>
            </div>

            <!-- Card Container -->
            <div id="card-host" style="background: white; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); min-height: 680px; overflow: hidden; border: 1px solid #e2e8f0;"></div>
          </div>

          <!-- Web Developer Specification Hub -->
          <div id="content-specs" style="display: ${this.activeTab === 'specs' ? 'block' : 'none'};">
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px;">
                <div>
                  <h1 style="margin: 0 0 6px 0; font-size: 24px; font-weight: 800; color: #0f172a;">Website Developer Specification: Meals & Shopping Integration</h1>
                  <p style="margin: 0; font-size: 14px; color: #64748b;">Give this exact document to the website developers. It details the REST API endpoints and data models required for 100% seamless bi-directional synchronization with Home Assistant and this dashboard card.</p>
                </div>
                <button id="btn-copy-specs" style="background: #0f172a; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">📋 Copy Specs to Clipboard</button>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 24px;">
                
                <!-- Section 1: Recipes Endpoint -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                    <span style="background: #10b981; color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px;">GET</span>
                    <code style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: #0f172a;">/api/recipes</code>
                  </div>
                  <p style="font-size: 13px; color: #475569; margin: 0 0 12px 0;">Returns the catalog of family recipes available for scheduling.</p>
                  <pre style="background: #0f172a; color: #38bdf8; padding: 14px; border-radius: 8px; font-size: 12px; font-family: 'JetBrains Mono', monospace; overflow-x: auto;"><code>{
  "recipes": [
    {
      "id": "rec_chicken_curry",
      "title": "Creamy Coconut Chicken Curry",
      "url": "https://my-meals.app/recipe/rec_chicken_curry",
      "prepTime": 15,
      "cookTime": 25,
      "servings": 4,
      "macros": {
        "calories": 580,
        "protein": 42,
        "carbs": 24,
        "fat": 32
      }
    }
  ]
}</code></pre>
                </div>

                <!-- Section 2: Weekly Meals Endpoint -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                    <span style="background: #10b981; color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px;">GET</span>
                    <span style="background: #3b82f6; color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px;">POST</span>
                    <span style="background: #ef4444; color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px;">DELETE</span>
                    <code style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: #0f172a;">/api/weekly-meals</code>
                  </div>
                  <p style="font-size: 13px; color: #475569; margin: 0 0 12px 0;">Gets, schedules, or removes planned meals by date (<code style="font-size: 12px;">YYYY-MM-DD</code>).</p>
                  <pre style="background: #0f172a; color: #38bdf8; padding: 14px; border-radius: 8px; font-size: 12px; font-family: 'JetBrains Mono', monospace; overflow-x: auto;"><code>// GET /api/weekly-meals
{
  "meals": [
    {
      "date": "2026-08-24",
      "recipeId": "rec_chicken_curry",
      "recipeTitle": "Creamy Coconut Chicken Curry",
      "macros": { "cal": 580, "pro": 42, "carbs": 24, "fat": 32 },
      "url": "https://my-meals.app/recipe/rec_chicken_curry"
    }
  ]
}

// POST /api/weekly-meals (Upsert Payload)
{
  "id": "2026-08-24",
  "date": "2026-08-24",
  "recipe_id": "rec_chicken_curry",
  "recipe_title": "Creamy Coconut Chicken Curry",
  "calories": 580,
  "protein": 42,
  "carbs": 24,
  "fat": 32
}</code></pre>
                </div>

                <!-- Section 3: Shopping List Endpoint -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                    <span style="background: #10b981; color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px;">GET</span>
                    <span style="background: #3b82f6; color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px;">POST</span>
                    <span style="background: #ef4444; color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px;">DELETE</span>
                    <code style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: #0f172a;">/api/shopping-list</code>
                  </div>
                  <p style="font-size: 13px; color: #475569; margin: 0 0 12px 0;">Manages grocery ingredients, checked status, and department categorization.</p>
                  <pre style="background: #0f172a; color: #38bdf8; padding: 14px; border-radius: 8px; font-size: 12px; font-family: 'JetBrains Mono', monospace; overflow-x: auto;"><code>// GET /api/shopping-list
{
  "shopping_list": [
    {
      "id": "item_1740268000",
      "name": "Whole Milk",
      "category": "Dairy",
      "amount": 2,
      "unit": "L",
      "checked": false
    }
  ]
}

// POST /api/shopping-list (Upsert Item)
{
  "id": "item_1740268000",
  "name": "Whole Milk",
  "category": "Dairy",
  "amount": 2,
  "unit": "L",
  "checked": "false"
}

// DELETE /api/shopping-list?id=item_1740268000
{ "id": "item_1740268000" }</code></pre>
                </div>

                <!-- Section 4: Key Requirements Summary -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
                  <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 700; color: #0f172a;">Developer Integration Checklist</h3>
                  <ul style="font-size: 13px; color: #475569; padding-left: 20px; margin: 0; line-height: 1.8;">
                    <li><strong>CORS & Authentication:</strong> Allow Home Assistant server requests (either via static API Key in header <code style="font-size: 12px;">Authorization: Bearer &lt;token&gt;</code> or IP whitelist).</li>
                    <li><strong>Department Categorization:</strong> Suggested values for <code style="font-size: 12px;">category</code>: <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Produce</span>, <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Dairy</span>, <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Meat & Seafood</span>, <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Bakery</span>, <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Pantry</span>, <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Frozen</span>, <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Beverages</span>, <span style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">Household</span>.</li>
                    <li><strong>Firestore Format Support:</strong> If using Google Firestore directly, the card natively supports both Firestore REST map values (<code style="font-size: 12px;">stringValue</code>, <code style="font-size: 12px;">integerValue</code>) and standard clean JSON arrays.</li>
                    <li><strong>Direct Recipe Links:</strong> The <code style="font-size: 12px;">url</code> field or card configuration <code style="font-size: 12px;">website_url</code> will render an external link button ↗ directly into each meal card!</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <!-- Home Assistant Configuration YAML -->
          <div id="content-ha-config" style="display: ${this.activeTab === 'ha_config' ? 'block' : 'none'};">
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.04);">
              <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #0f172a;">Home Assistant configuration.yaml (Sensors & REST Commands)</h2>
              <p style="margin: 0 0 16px 0; font-size: 14px; color: #64748b;">Add this block to your Home Assistant <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">configuration.yaml</code> file to connect your website API to this card:</p>

              <pre style="background: #0f172a; color: #f8fafc; padding: 20px; border-radius: 12px; font-size: 13px; font-family: 'JetBrains Mono', monospace; overflow-x: auto; line-height: 1.6;"><code># 1. REST Sensors to Fetch Data from Website
rest:
  - resource: "https://your-website.com/api/recipes"
    scan_interval: 3600
    sensor:
      - name: "Meal Planner Recipes"
        unique_id: meal_planner_recipes
        value_template: "{{ value_json.recipes | count if value_json.recipes is defined else 0 }}"
        json_attributes:
          - recipes

  - resource: "https://your-website.com/api/weekly-meals"
    scan_interval: 300
    sensor:
      - name: "Meal Planner Weekly Meals"
        unique_id: meal_planner_weekly_meals
        value_template: "{{ value_json.meals | count if value_json.meals is defined else 0 }}"
        json_attributes:
          - meals

  - resource: "https://your-website.com/api/shopping-list"
    scan_interval: 60
    sensor:
      - name: "Meal Planner Shopping List"
        unique_id: meal_planner_shopping_list
        value_template: "{{ value_json.shopping_list | count if value_json.shopping_list is defined else 0 }}"
        json_attributes:
          - shopping_list

# 2. REST Commands to Send Updates from Dashboard Card to Website
rest_command:
  meal_planner_upsert_weekly_meal:
    url: "https://your-website.com/api/weekly-meals"
    method: POST
    headers:
      Content-Type: "application/json"
    payload: >-
      {
        "id": "{{ id }}",
        "date": "{{ date }}",
        "recipe_id": "{{ recipe_id }}",
        "recipe_title": "{{ recipe_title }}",
        "prep_time": {{ prep_time | default(0) }},
        "cook_time": {{ cook_time | default(0) }},
        "servings": {{ servings | default(2) }},
        "calories": {{ calories | default(0) }},
        "protein": {{ protein | default(0) }},
        "carbs": {{ carbs | default(0) }},
        "fat": {{ fat | default(0) }}
      }

  meal_planner_delete_weekly_meal:
    url: "https://your-website.com/api/weekly-meals"
    method: DELETE
    headers:
      Content-Type: "application/json"
    payload: '{"id": "{{ id }}"}'

  meal_planner_upsert_shopping_item:
    url: "https://your-website.com/api/shopping-list"
    method: POST
    headers:
      Content-Type: "application/json"
    payload: >-
      {
        "id": "{{ id }}",
        "name": "{{ name }}",
        "category": "{{ category }}",
        "amount": {{ amount | default(1) }},
        "unit": "{{ unit }}",
        "checked": "{{ checked }}"
      }

  meal_planner_delete_shopping_item:
    url: "https://your-website.com/api/shopping-list"
    method: DELETE
    headers:
      Content-Type: "application/json"
    payload: '{"id": "{{ id }}"}'
</code></pre>
            </div>
          </div>
        </main>
      </div>
    `;

    this.attachEventListeners();
  }

  private getTabStyle(active: boolean) {
    return `
      background: ${active ? '#3b82f6' : 'transparent'};
      color: ${active ? '#ffffff' : '#94a3b8'};
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    `;
  }

  private attachEventListeners() {
    document.getElementById('tab-preview')?.addEventListener('click', () => {
      this.activeTab = 'preview';
      this.renderLayout();
      this.mountCard();
    });

    document.getElementById('tab-specs')?.addEventListener('click', () => {
      this.activeTab = 'specs';
      this.renderLayout();
    });

    document.getElementById('tab-ha-config')?.addEventListener('click', () => {
      this.activeTab = 'ha_config';
      this.renderLayout();
    });

    document.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', (e: any) => {
        const view = e.target.getAttribute('data-view');
        if (this.cardElement) {
          this.cardElement._switchView(view);
          this.cardElement.requestUpdate();
        }
      });
    });

    document.getElementById('btn-seed')?.addEventListener('click', () => {
      this.recipes = [...INITIAL_RECIPES];
      this.meals = getInitialMeals();
      this.shopping = [...INITIAL_SHOPPING];
      this.syncHass();
    });

    document.getElementById('btn-copy-specs')?.addEventListener('click', (e: any) => {
      const specText = `WEBSITE DEVELOPER API SPECIFICATION FOR NIGHTLIGHT MEAL & SHOPPING PLANNER
========================================================================

1. GET /api/recipes
Response format:
{
  "recipes": [
    {
      "id": "rec_chicken_curry",
      "title": "Creamy Coconut Chicken Curry",
      "url": "https://my-meals.app/recipe/rec_chicken_curry",
      "prepTime": 15,
      "cookTime": 25,
      "servings": 4,
      "macros": {
        "calories": 580,
        "protein": 42,
        "carbs": 24,
        "fat": 32
      }
    }
  ]
}

2. GET /api/weekly-meals & POST /api/weekly-meals & DELETE /api/weekly-meals
GET Response format:
{
  "meals": [
    {
      "date": "2026-08-24",
      "recipeId": "rec_chicken_curry",
      "recipeTitle": "Creamy Coconut Chicken Curry",
      "macros": { "cal": 580, "pro": 42, "carbs": 24, "fat": 32 },
      "url": "https://my-meals.app/recipe/rec_chicken_curry"
    }
  ]
}

3. GET /api/shopping-list & POST /api/shopping-list & DELETE /api/shopping-list
GET Response format:
{
  "shopping_list": [
    {
      "id": "item_1740268000",
      "name": "Whole Milk",
      "category": "Dairy",
      "amount": 2,
      "unit": "L",
      "checked": false
    }
  ]
}
`;
      navigator.clipboard?.writeText(specText);
      const originalText = e.target.textContent;
      e.target.textContent = '✓ Copied!';
      setTimeout(() => { e.target.textContent = originalText; }, 2000);
    });
  }
}

const app = new DashboardPreviewApp();
app.init();
