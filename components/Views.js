import React, { useState } from 'react';
import { MOCK_MEALS, MOCK_NOTES, MOCK_KIDS } from '../constants';
import { Plus, Check, Send, Mic } from 'lucide-react';

export const MealsView = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
    {MOCK_MEALS.map((item, idx) => (
      <div key={idx} className="group bg-white rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full">
            {item.day}
          </span>
          {item.chef && (
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
              👨‍🍳 {item.chef}
            </span>
          )}
        </div>
        <h3 className="text-lg font-bold text-slate-800 leading-tight mb-2 group-hover:text-indigo-700 transition-colors">
          {item.meal}
        </h3>
        <div className="h-32 w-full bg-slate-100 rounded-2xl mt-4 overflow-hidden relative">
            <img 
                src={`https://source.unsplash.com/random/400x300/?food,${item.meal.split(' ')[0]}`} 
                alt={item.meal}
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"
                onError={(e) => e.target.style.display = 'none'} 
            />
        </div>
      </div>
    ))}
  </div>
);

export const NotesView = () => (
  <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
    {MOCK_NOTES.map((note) => (
      <div 
        key={note.id} 
        className={`${note.color} p-6 rounded-3xl shadow-sm rotate-[${note.rotation}deg] hover:rotate-0 hover:scale-105 hover:shadow-xl transition-all duration-300 break-inside-avoid cursor-pointer`}
      >
        <h3 className="font-bold text-slate-800 mb-2 border-b border-black/5 pb-2">{note.title}</h3>
        <p className="whitespace-pre-wrap text-slate-700 font-medium leading-relaxed">{note.content}</p>
      </div>
    ))}
    <button className="w-full h-48 border-2 border-dashed border-slate-300 rounded-3xl flex flex-col items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all">
      <Plus size={32} />
      <span className="font-medium mt-2">Add Note</span>
    </button>
  </div>
);

export const ChoresView = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
    {MOCK_KIDS.map((kid) => (
      <div key={kid.id} className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 p-32 bg-indigo-50 rounded-full blur-3xl opacity-50 -mr-16 -mt-16 pointer-events-none" />
        
        <div className="relative flex items-center gap-5 mb-8">
          <div className="w-20 h-20 rounded-full bg-slate-100 border-4 border-white shadow-lg overflow-hidden">
            <img src={kid.avatar} alt={kid.name} className="w-full h-full object-cover" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{kid.name}</h2>
            <div className="flex items-center gap-2 mt-1">
                <div className="h-2 w-24 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-green-500 rounded-full" 
                        style={{ width: `${(kid.chores.filter(c => c.done).length / kid.chores.length) * 100}%`}}
                    />
                </div>
                <span className="text-xs font-bold text-green-600">
                    {Math.round((kid.chores.filter(c => c.done).length / kid.chores.length) * 100)}%
                </span>
            </div>
          </div>
        </div>

        <div className="space-y-3 relative z-10">
          {kid.chores.map((chore) => (
            <div 
              key={chore.id}
              className={`flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 ${
                chore.done 
                  ? 'bg-green-50 border-green-100' 
                  : 'bg-white border-slate-100 hover:border-indigo-100'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`
                    w-10 h-10 rounded-xl flex items-center justify-center transition-colors
                    ${chore.done ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}
                `}>
                    <Check size={20} strokeWidth={3} />
                </div>
                <div>
                  <h4 className={`font-bold ${chore.done ? 'text-green-800 line-through opacity-75' : 'text-slate-700'}`}>
                    {chore.label}
                  </h4>
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    {chore.period}
                  </span>
                </div>
              </div>
              
              {!chore.done && (
                  <button className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-indigo-600 transition-colors">
                    Complete
                  </button>
              )}
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export const AssistantView = () => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([
        { id: 1, role: 'model', text: 'Good evening! How can I help organize your home today?' }
    ]);

    const handleSend = () => {
        if (!input.trim()) return;
        setMessages([...messages, { id: Date.now(), role: 'user', text: input }]);
        setInput('');
        // Mock response delay
        setTimeout(() => {
            setMessages(prev => [...prev, { 
                id: Date.now() + 1, 
                role: 'model', 
                text: "I've updated your calendar. Is there anything else?" 
            }]);
        }, 1000);
    };

    return (
        <div className="h-[calc(100vh-180px)] bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`
                            max-w-[70%] p-5 rounded-3xl text-sm leading-relaxed
                            ${msg.role === 'user' 
                                ? 'bg-indigo-600 text-white rounded-br-sm' 
                                : 'bg-slate-100 text-slate-800 rounded-bl-sm'}
                        `}>
                            {msg.text}
                        </div>
                    </div>
                ))}
            </div>
            <div className="p-4 bg-white border-t border-slate-100">
                <div className="bg-slate-50 border border-slate-200 rounded-full p-2 flex items-center gap-2 focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-300 transition-all">
                    <button className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-full transition-all">
                        <Mic size={20} />
                    </button>
                    <input 
                        type="text" 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Add an event, reminder, or ask a question..."
                        className="flex-1 bg-transparent border-none outline-none text-slate-800 placeholder:text-slate-400"
                    />
                    <button 
                        onClick={handleSend}
                        className="p-3 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!input.trim()}
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
