import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import CalendarView from './components/CalendarView';
import { MealsView, NotesView, ChoresView, AssistantView } from './components/Views';
import { VIEW_TYPES, MOCK_EVENTS, MOCK_CALENDARS } from './constants';

const App = () => {
  const [activeView, setActiveView] = useState(VIEW_TYPES.CALENDAR);
  const [currentDate, setCurrentDate] = useState(new Date());

  const renderContent = () => {
    switch (activeView) {
      case VIEW_TYPES.CALENDAR:
        return (
          <CalendarView 
            events={MOCK_EVENTS} 
            calendars={MOCK_CALENDARS}
            currentDate={currentDate}
            onDateChange={setCurrentDate}
          />
        );
      case VIEW_TYPES.MEALS:
        return <MealsView />;
      case VIEW_TYPES.NOTES:
        return <NotesView />;
      case VIEW_TYPES.CHORES:
        return <ChoresView />;
      case VIEW_TYPES.ASSISTANT:
        return <AssistantView />;
      default:
        return <CalendarView events={MOCK_EVENTS} calendars={MOCK_CALENDARS} currentDate={currentDate} onDateChange={setCurrentDate} />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden selection:bg-indigo-100 selection:text-indigo-700">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      
      <main className="flex-1 h-full relative overflow-hidden flex flex-col">
        <header className="px-8 py-6 flex items-center justify-between z-10">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {activeView === VIEW_TYPES.CALENDAR && 'Calendar'}
              {activeView === VIEW_TYPES.MEALS && 'Weekly Menu'}
              {activeView === VIEW_TYPES.NOTES && 'Family Board'}
              {activeView === VIEW_TYPES.CHORES && 'Chores & Rewards'}
              {activeView === VIEW_TYPES.ASSISTANT && 'Assistant'}
            </h1>
            <p className="text-slate-500 text-sm mt-0.5 font-medium">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
             <div className="h-10 w-10 rounded-full bg-slate-200 border-2 border-white shadow-sm overflow-hidden">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Dad" alt="User" className="h-full w-full object-cover" />
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-8 pt-0">
          <div className="max-w-7xl mx-auto h-full">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
