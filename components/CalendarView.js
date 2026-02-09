import React from 'react';
import { 
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, 
  isSameMonth, isSameDay, isToday, addMonths, subMonths, 
  startOfDay, isSameYear
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

const CalendarView = ({ events, calendars, currentDate, onDateChange }) => {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Helper to find events for a specific day
  const getEventsForDay = (day) => {
    return events.filter(event => isSameDay(event.start, day));
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Calendar Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-100/50 p-1 rounded-xl border border-slate-200">
          <button 
            onClick={() => onDateChange(subMonths(currentDate, 1))}
            className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-500 hover:text-indigo-600 transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <button 
            onClick={() => onDateChange(new Date())}
            className="px-4 py-1.5 text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-colors"
          >
            Today
          </button>
          <button 
            onClick={() => onDateChange(addMonths(currentDate, 1))}
            className="p-2 hover:bg-white hover:shadow-sm rounded-lg text-slate-500 hover:text-indigo-600 transition-all"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg shadow-indigo-200 transition-all hover:scale-105 active:scale-95">
          <Plus size={18} />
          <span>New Event</span>
        </button>
      </div>

      {/* Days Header */}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {weekDays.map(day => (
          <div key={day} className="py-4 text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-5 sm:grid-rows-6">
        {calendarDays.map((day, dayIdx) => {
          const dayEvents = getEventsForDay(day);
          const isSelectedMonth = isSameMonth(day, monthStart);
          const isCurrentDay = isToday(day);

          return (
            <div 
              key={day.toString()}
              className={`
                relative min-h-[100px] border-b border-r border-slate-50 p-3 transition-colors hover:bg-slate-50/80
                ${!isSelectedMonth ? 'bg-slate-50/30' : 'bg-white'}
              `}
            >
              <div className="flex items-center justify-between mb-2">
                <span 
                  className={`
                    text-sm font-medium w-8 h-8 flex items-center justify-center rounded-full
                    ${isCurrentDay 
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
                      : isSelectedMonth ? 'text-slate-700' : 'text-slate-300'
                    }
                  `}
                >
                  {format(day, 'd')}
                </span>
              </div>
              
              <div className="space-y-1.5">
                {dayEvents.map(event => (
                  <div 
                    key={event.id}
                    className="group flex items-center gap-1.5 cursor-pointer"
                  >
                    <div 
                      className="w-2 h-2 rounded-full ring-2 ring-white" 
                      style={{ backgroundColor: event.color }}
                    />
                    <div className="flex-1 truncate hidden md:block">
                      <span className="text-xs font-medium text-slate-600 group-hover:text-indigo-600 transition-colors">
                        {event.title}
                      </span>
                    </div>
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-slate-400 pl-3.5">
                    + {dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CalendarView;
