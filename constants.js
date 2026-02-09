import { addDays, startOfToday, setHours, setMinutes } from 'date-fns';

export const COLORS = [
  '#6366f1', // Indigo
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
];

export const VIEW_TYPES = {
  CALENDAR: 'calendar',
  MEALS: 'meals',
  NOTES: 'notes',
  CHORES: 'chores',
  ASSISTANT: 'assistant'
};

export const MOCK_CALENDARS = [
  { id: 'cal.family', name: 'Family', color: COLORS[0], visible: true },
  { id: 'cal.work', name: 'Work', color: COLORS[4], visible: true },
  { id: 'cal.soccer', name: 'Sports', color: COLORS[2], visible: true },
];

const today = startOfToday();

export const MOCK_EVENTS = [
  {
    id: '1',
    title: 'Morning Standup',
    start: setHours(setMinutes(today, 0), 9),
    end: setHours(setMinutes(today, 30), 9),
    color: COLORS[4],
    calendarName: 'Work'
  },
  {
    id: '2',
    title: 'Soccer Practice',
    start: setHours(setMinutes(today, 0), 17),
    end: setHours(setMinutes(today, 30), 18),
    color: COLORS[2],
    calendarName: 'Sports'
  },
  {
    id: '3',
    title: 'Family Dinner',
    start: addDays(setHours(setMinutes(today, 0), 19), 1),
    end: addDays(setHours(setMinutes(today, 0), 20), 1),
    color: COLORS[0],
    calendarName: 'Family',
    description: 'Taco Tuesday at home!'
  },
  {
    id: '4',
    title: 'Grocery Run',
    start: addDays(setHours(setMinutes(today, 0), 10), 2),
    end: addDays(setHours(setMinutes(today, 0), 11), 2),
    color: COLORS[0],
    calendarName: 'Family'
  }
];

export const MOCK_MEALS = [
  { day: 'Mon', meal: 'Spaghetti Bolognese', chef: 'Dad' },
  { day: 'Tue', meal: 'Taco Tuesday!', chef: 'Mom' },
  { day: 'Wed', meal: 'Grilled Chicken Salad', chef: 'Dad' },
  { day: 'Thu', meal: 'Leftovers', chef: '' },
  { day: 'Fri', meal: 'Pizza Night 🍕', chef: 'Delivery' },
  { day: 'Sat', meal: 'Out for dinner', chef: '' },
  { day: 'Sun', meal: 'Roast Chicken', chef: 'Mom' }
];

export const MOCK_NOTES = [
  { id: 'n1', title: 'Wifi', content: 'Network: Home_5G\nPass: supersecretpass', color: 'bg-amber-100', rotation: -1 },
  { id: 'n2', title: 'Groceries', content: '• Milk\n• Eggs\n• Sourdough bread\n• Avocados', color: 'bg-blue-100', rotation: 2 },
  { id: 'n3', title: 'Reminders', content: 'Call Grandma on Sunday!\nBook dentist appt.', color: 'bg-pink-100', rotation: -2 }
];

export const MOCK_KIDS = [
  { 
    id: 'k1', 
    name: 'Leo', 
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo', 
    chores: [
      { id: 'c1', label: 'Make Bed', period: 'Morning', done: false },
      { id: 'c2', label: 'Brush Teeth', period: 'Morning', done: true },
      { id: 'c3', label: 'Pack Bag', period: 'Evening', done: false }
    ]
  },
  { 
    id: 'k2', 
    name: 'Mia', 
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mia', 
    chores: [
      { id: 'c4', label: 'Feed Cat', period: 'Morning', done: false },
      { id: 'c5', label: 'Homework', period: 'Afternoon', done: false },
      { id: 'c6', label: 'Dishes', period: 'Evening', done: true }
    ]
  }
];
