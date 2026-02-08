
import React, { useState } from 'react';
import { Page } from '../types';

interface SettingsProps {
  onNavigate: (page: Page) => void;
}

const Settings: React.FC<SettingsProps> = ({ onNavigate }) => {
  const [notifications, setNotifications] = useState({
    moodChange: true,
    friendDetected: true,
    weeklyReport: true,
    batteryAlert: false,
  });

  return (
    <div className="p-8 max-w-5xl mx-auto pb-32">
      <header className="mb-12">
        <h1 className="text-4xl font-black tracking-tight">Settings</h1>
        <p className="text-slate-400 mt-2 text-lg">Manage your account, pet profiles, and AI preferences.</p>
      </header>

      <div className="space-y-12">
        {/* Profile Section */}
        <section className="bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 p-8 shadow-xl">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">person</span>
              Account Profile
            </h2>
            <button className="text-primary text-sm font-bold hover:underline">Edit Profile</button>
          </div>
          <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
            <div className="relative group">
              <div className="size-32 rounded-full overflow-hidden border-4 border-primary/20 bg-warm-gray group-hover:border-primary transition-all">
                <img src="https://picsum.photos/seed/user1/200/200" alt="User Profile" />
              </div>
              <button className="absolute bottom-0 right-0 size-10 rounded-full bg-primary text-background-dark flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                <span className="material-symbols-outlined !text-xl font-bold">photo_camera</span>
              </button>
            </div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-1">Full Name</label>
                <input 
                  type="text" 
                  readOnly 
                  value="Alex Johnson" 
                  className="w-full bg-background-dark/50 border border-warm-gray/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-1">Email Address</label>
                <input 
                  type="email" 
                  readOnly 
                  value="alex.johnson@example.com" 
                  className="w-full bg-background-dark/50 border border-warm-gray/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Community & Social Section */}
        <section className="bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 p-8 shadow-xl overflow-hidden relative group">
          <div className="absolute -top-10 -right-10 size-40 bg-primary/5 rounded-full blur-3xl"></div>
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">hub</span>
              Community & Discovery
            </h2>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1">
              <p className="text-slate-300 font-medium leading-relaxed mb-6">
                Connect with other pet owners in the PetDay Community. Share your pet's best moments and see how other pets are spending their days.
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => onNavigate('discovery')}
                  className="bg-primary text-background-dark px-6 py-3 rounded-xl font-black text-sm hover:shadow-2xl hover:shadow-primary/20 transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined !text-lg">explore</span>
                  Go to Discovery Feed
                </button>
                <button className="bg-white/5 border border-white/10 px-6 py-3 rounded-xl font-bold text-sm hover:bg-white/10 transition-all">
                  Community Settings
                </button>
              </div>
            </div>
            <div className="flex -space-x-4">
              {[10, 11, 12].map(i => (
                <div key={i} className="size-16 rounded-2xl border-4 border-surface-dark overflow-hidden rotate-3 group-hover:rotate-0 transition-transform shadow-xl">
                  <img src={`https://picsum.photos/seed/p${i}/150/150`} alt="pet" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pet Profiles Section */}
        <section className="bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 p-8 shadow-xl">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">pets</span>
              Manage Pets
            </h2>
            <button className="bg-primary text-background-dark px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider hover:shadow-lg transition-all flex items-center gap-2">
              <span className="material-symbols-outlined !text-sm font-black">add</span>
              Add Pet
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { name: 'Cooper', breed: 'Golden Retriever', hardware: 'CollarCam Pro v2', img: 'https://images.unsplash.com/photo-1548191265-cc70d3d45ba1?q=80&w=200' },
              { name: 'Luna', breed: 'Tabby Cat', hardware: 'GimbalLite Collar', img: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?q=80&w=200' },
            ].map((pet, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-background-dark/30 border border-warm-gray/20 hover:border-primary/30 transition-all cursor-pointer group">
                <img src={pet.img} className="size-14 rounded-xl object-cover" alt={pet.name} />
                <div className="flex-1">
                  <h4 className="font-bold">{pet.name}</h4>
                  <p className="text-xs text-slate-500">{pet.breed} • {pet.hardware}</p>
                </div>
                <span className="material-symbols-outlined text-slate-500 group-hover:text-primary transition-colors">settings_applications</span>
              </div>
            ))}
          </div>
        </section>

        {/* AI & Notification Preferences */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section className="bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 p-8 shadow-xl">
            <h2 className="text-xl font-bold mb-8 flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">notifications</span>
              Notifications
            </h2>
            <div className="space-y-6">
              {[
                { key: 'moodChange', label: 'Significant Mood Changes', desc: 'Alert me when AI detects high stress or unusual joy.' },
                { key: 'friendDetected', label: 'New Friend Detected', desc: 'Notify when my pet meets a new animal or human.' },
                { key: 'weeklyReport', label: 'Weekly Behavioral Report', desc: 'Summary of the week delivered every Monday.' },
              ].map((item) => (
                <div key={item.key} className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-bold text-sm">{item.label}</p>
                    <p className="text-xs text-slate-500 mt-1">{item.desc}</p>
                  </div>
                  <button 
                    onClick={() => setNotifications(prev => ({ ...prev, [item.key as any]: !prev[item.key as any] }))}
                    className={`w-12 h-6 rounded-full transition-all relative shrink-0 ${notifications[item.key as keyof typeof notifications] ? 'bg-primary' : 'bg-warm-gray/40'}`}
                  >
                    <div className={`absolute top-1 left-1 size-4 rounded-full bg-white transition-all ${notifications[item.key as keyof typeof notifications] ? 'translate-x-6' : 'translate-x-0'}`}></div>
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-surface-dark rounded-[2.5rem] border border-warm-gray/30 p-8 shadow-xl">
            <h2 className="text-xl font-bold mb-8 flex items-center gap-3">
              <span className="material-symbols-outlined text-primary">bolt</span>
              Subscription
            </h2>
            <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 mb-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-black text-primary uppercase tracking-widest text-xs">Current Plan</h4>
                  <p className="text-2xl font-black text-white mt-1">AI Explorer Plus</p>
                </div>
                <span className="bg-primary text-background-dark text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-tighter">Active</span>
              </div>
              <p className="text-sm text-slate-300 mb-6 leading-relaxed">Unlimited AI analysis, 4K video exports, and multi-pet support.</p>
              <button className="w-full bg-primary text-background-dark py-3 rounded-xl font-black text-sm hover:shadow-xl hover:shadow-primary/20 transition-all">
                Manage Subscription
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Next billing date</span>
                <span className="font-bold">Nov 24, 2024</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Storage used</span>
                <span className="font-bold">14.2 GB / 50 GB</span>
              </div>
              <div className="h-1.5 w-full bg-warm-gray/20 rounded-full overflow-hidden">
                <div className="h-full bg-primary w-[28%]"></div>
              </div>
            </div>
          </section>
        </div>

        {/* Danger Zone */}
        <section className="bg-danger/5 rounded-[2.5rem] border border-danger/20 p-8 shadow-xl">
          <h2 className="text-xl font-bold mb-6 text-danger flex items-center gap-3">
            <span className="material-symbols-outlined">warning</span>
            Danger Zone
          </h2>
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div>
              <p className="font-bold text-white">Delete Account and Data</p>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">Once deleted, all your pet POV history, AI summaries, and media will be permanently removed.</p>
            </div>
            <button className="bg-danger/10 text-danger border border-danger/30 px-6 py-3 rounded-xl font-bold text-sm hover:bg-danger hover:text-white transition-all whitespace-nowrap">
              Delete Forever
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings;
