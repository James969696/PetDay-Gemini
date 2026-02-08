
import React, { useState } from 'react';
import Landing from './pages/Landing';
import Gallery from './pages/Gallery';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import Settings from './pages/Settings';
import Discovery from './pages/Discovery';
import Sidebar from './components/Sidebar';
import { Page } from './types';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('landing');

  const renderPage = () => {
    switch (currentPage) {
      case 'landing': return <Landing onStart={() => setCurrentPage('dashboard')} />;
      case 'gallery': return <Gallery onSelect={() => setCurrentPage('analysis')} />;
      case 'dashboard': return <Dashboard onAnalyze={() => setCurrentPage('analysis')} onGallery={() => setCurrentPage('gallery')} />;
      case 'analysis': return <Analysis onBack={() => setCurrentPage('gallery')} />;
      case 'settings': return <Settings onNavigate={setCurrentPage} />;
      case 'discovery': return <Discovery onSelect={() => setCurrentPage('analysis')} />;
      default: return <Landing onStart={() => setCurrentPage('dashboard')} />;
    }
  };

  if (currentPage === 'landing') {
    return <Landing onStart={() => setCurrentPage('dashboard')} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-white font-sans">
      <Sidebar
        activePage={currentPage}
        onNavigate={setCurrentPage}
      />
      <main className="flex-1 overflow-y-auto relative custom-scrollbar bg-background-dark">
        {renderPage()}
      </main>
    </div>
  );
};

export default App;
