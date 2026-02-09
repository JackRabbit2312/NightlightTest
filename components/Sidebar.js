import React from 'react';
import { Calendar, Utensils, StickyNote, CheckCircle, Sparkles } from 'lucide-react';
import { VIEW_TYPES } from '../constants';

const Sidebar = ({ activeView, onNavigate }) => {
  const navItems = [
    { id: VIEW_TYPES.CALENDAR, label: 'Calendar', icon: Calendar },
    { id: VIEW_TYPES.MEALS, label: 'Meals', icon: Utensils },
    { id: VIEW_TYPES.NOTES, label: 'Notes', icon: StickyNote },
    { id: VIEW_TYPES.CHORES, label: 'Chores', icon: CheckCircle },
  ];

  return (
    <nav className="w-24 h-full bg-white/80 backdrop-blur-xl border-r border-slate-200/60 flex flex-col items-center py-8 z-50">
      <div className="mb-10">
        <div className="w-12 h-12 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 ring-4 ring-indigo-50">
          <Sparkles className="text-white w-6 h-6" />
        </div>
      </div>
      
      <div className="flex-1 w-full flex flex-col gap-4 px-3">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`group relative w-full flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all duration-300 ${
                isActive 
                  ? 'bg-indigo-50 text-indigo-600 shadow-sm' 
                  : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
              }`}
            >
              <Icon 
                size={24} 
                strokeWidth={isActive ? 2.5 : 2} 
                className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}
              />
              <span className="text-[10px] font-bold tracking-wide uppercase">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto px-3 w-full">
        <button 
          onClick={() => onNavigate(VIEW_TYPES.ASSISTANT)}
          className={`w-full aspect-square rounded-2xl flex items-center justify-center transition-all duration-300 ${
            activeView === VIEW_TYPES.ASSISTANT 
              ? 'bg-slate-900 text-white shadow-xl shadow-slate-200 scale-100' 
              : 'bg-white border border-slate-200 text-slate-400 hover:border-indigo-200 hover:text-indigo-500 hover:shadow-md hover:scale-105'
          }`}
        >
          <Sparkles size={22} className={activeView === VIEW_TYPES.ASSISTANT ? 'animate-pulse' : ''} />
        </button>
      </div>
    </nav>
  );
};

export default Sidebar;
