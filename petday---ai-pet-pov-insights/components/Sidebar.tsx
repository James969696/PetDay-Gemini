
import React from 'react';
import { Page } from '../types';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, onNavigate }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'gallery', label: 'Gallery', icon: 'grid_view' },
    { id: 'discovery', label: 'Discovery', icon: 'explore' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <aside className="w-64 bg-sidebar-dark border-r border-warm-gray/30 flex flex-col h-full z-50">
      <div 
        className="p-6 flex items-center gap-3 cursor-pointer group" 
        onClick={() => onNavigate('landing')}
      >
        <div className="bg-primary text-background-dark p-1.5 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
          <span className="material-symbols-outlined font-bold text-xl">pets</span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white group-hover:text-primary transition-colors">PetDay</h2>
      </div>

      <nav className="flex-1 px-4 py-4 flex flex-col gap-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id as Page)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activePage === item.id 
                ? 'bg-primary text-background-dark font-bold shadow-lg shadow-primary/20' 
                : 'text-slate-400 hover:text-primary hover:bg-white/5'
            }`}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-warm-gray/30 bg-background-dark/50">
        <div className="flex items-center gap-3 px-2 py-2">
          <div 
            className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-10 border-2 border-primary/20" 
            style={{ backgroundImage: `url('https://picsum.photos/seed/user1/100/100')` }}
          />
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-bold truncate">Alex Johnson</span>
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Premium Plan</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
