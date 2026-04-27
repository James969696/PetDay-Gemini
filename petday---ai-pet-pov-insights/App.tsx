
import React, { useState } from 'react';
import Landing from './pages/Landing';
import Gallery from './pages/Gallery';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import Settings from './pages/Settings';
import Discovery from './pages/Discovery';
import MyPets from './pages/MyPets';
import PetProfile from './pages/PetProfile';
import PetChat from './pages/PetChat';
import Sidebar from './components/Sidebar';
import { Page } from './types';

const App: React.FC = () => {
  const initialPage = (() => {
    if (typeof window === 'undefined') return 'landing' as Page;
    const page = new URLSearchParams(window.location.search).get('page') as Page | null;
    return page && ['landing', 'gallery', 'dashboard', 'analysis', 'settings', 'discovery', 'pets', 'pet-profile', 'pet-chat'].includes(page)
      ? page
      : 'landing';
  })();
  const [currentPage, setCurrentPage] = useState<Page>(initialPage);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
    setSidebarOpen(false);
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'landing': return <Landing onStart={() => handleNavigate('dashboard')} />;
      case 'gallery': return <Gallery onSelect={() => handleNavigate('analysis')} />;
      case 'dashboard': return <Dashboard onAnalyze={() => handleNavigate('analysis')} onGallery={() => handleNavigate('gallery')} onNavigate={handleNavigate} />;
      case 'analysis': return <Analysis onBack={() => handleNavigate('gallery')} onNavigate={handleNavigate} />;
      case 'settings': return <Settings onNavigate={handleNavigate} />;
      case 'discovery': return <Discovery onSelect={() => handleNavigate('analysis')} />;
      case 'pets': return <MyPets onNavigate={handleNavigate} />;
      case 'pet-profile': return <PetProfile onNavigate={handleNavigate} />;
      case 'pet-chat': return <PetChat onNavigate={handleNavigate} />;
      default: return <Landing onStart={() => handleNavigate('dashboard')} />;
    }
  };

  if (currentPage === 'landing') {
    return <Landing onStart={() => handleNavigate('dashboard')} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-white font-sans">
      {/* Mobile hamburger button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-50 md:hidden bg-surface-dark border border-warm-gray/30 p-2.5 rounded-xl shadow-lg"
      >
        <span className="material-symbols-outlined text-white">menu</span>
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        activePage={currentPage}
        onNavigate={handleNavigate}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 overflow-y-auto relative custom-scrollbar bg-background-dark">
        {renderPage()}
      </main>
    </div>
  );
};

export default App;
