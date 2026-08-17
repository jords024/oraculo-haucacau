import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Oraculo from './components/Oraculo';
import Criador from './components/Criador';
import ReelsCloner from './components/ReelsCloner';
import Calendar from './components/Calendar';
import Settings from './components/Settings';
import VideoFactory from './components/VideoFactory';
import Radar from './components/Radar';
import Lightbox from './components/Lightbox';
import NewCarouselModal from './components/NewCarouselModal';
import EditSlideModal from './components/EditSlideModal';
import LiveGenPanel from './components/LiveGenPanel';
import UsersManagement from './components/UsersManagement';
import BackupManagement from './components/BackupManagement';
import GenerationHistoryModal from './components/GenerationHistoryModal';
import InProgressPage from './components/InProgressPage';
import LogoutModal from './components/LogoutModal';
import { parseCarouselText } from './utils/carouselParser';
import { customFetch } from './utils/customFetch';


export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    // Se o usuário veio da página de login, forçamos 'carrosseis' apenas no primeiro carregamento
    if (document.referrer && (document.referrer.includes('login.html') || document.referrer.includes('login')) && !sessionStorage.getItem('loginHandled')) {
      sessionStorage.setItem('loginHandled', 'true');
      localStorage.setItem('activeTab', 'carrosseis');
      return 'carrosseis';
    }
    return localStorage.getItem('activeTab') || 'carrosseis';
  });

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab);
    if (activeTab === 'carrosseis') {
      loadCarousels();
      loadStats();
    }
    if (activeTab !== 'criador') {
      setCriadorReadOnly(false);
    }
  }, [activeTab]);
  const [allCarousels, setAllCarousels] = useState([]);
  const [stats, setStats] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [shouldAddFormMessage, setShouldAddFormMessage] = useState(false);
  const [criadorInitialMessages, setCriadorInitialMessages] = useState(null);
  const [criadorReadOnly, setCriadorReadOnly] = useState(false);

  // Modais
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newModalDefaults, setNewModalDefaults] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editCarouselId, setEditCarouselId] = useState('');
  const [editFilename, setEditFilename] = useState('');

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxCarouselId, setLightboxCarouselId] = useState('');
  const [lightboxSlides, setLightboxSlides] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Live Session Panel
  const [liveSession, setLiveSession] = useState(null);

  // Toast
  const [toastMessage, setToastMessage] = useState('');
  const [toastShow, setToastShow] = useState(false);
  const [imageVersion, setImageVersion] = useState(Date.now());
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);

  // Histórico de Geração
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyCarouselId, setHistoryCarouselId] = useState('');
  const [branding, setBranding] = useState(() => {
    try {
      const cached = localStorage.getItem('fo_branding');
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return {
      companyName: 'Tete',
      logoText: '@HAUCACAU',
      logoSub: 'PRODUÇÃO',
      logoSize: '6px',
      logoColor: '#ffffff',
      carouselTextSize: '15px',
      carouselTextColor: '#e4e4e7',
      titleTextSize: '18px',
      bodyTextSize: '12px',
      titleTextColor: '#ffffff',
      bodyTextColor: '#df0c7c',
      logoPosition: 'right'
    };
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const handleOpenLightbox = (id, slides, idx) => {
    setLightboxCarouselId(id);
    setLightboxSlides(slides);
    setLightboxIndex(idx);
    setLightboxOpen(true);
  };

  useEffect(() => {
    const initApp = async () => {
      try {
        // Executa chamadas iniciais
        await Promise.all([
          loadCurrentUser(),
          loadBranding(),
          loadStats()
        ]);

        const loadedCarousels = await loadCarousels();
        setupSSE();

        // Pré-carrega as imagens de capa dos carrosséis para só exibir quando estiverem renderizadas
        if (Array.isArray(loadedCarousels) && loadedCarousels.length > 0) {
          const imagePromises = loadedCarousels
            .filter(c => c.cover || (c.slides && c.slides[0]))
            .map(c => {
              return new Promise((resolve) => {
                const img = new Image();
                const coverPath = c.cover || (typeof c.slides[0] === 'string' ? c.slides[0] : c.slides[0]?.filename);
                if (!coverPath) return resolve();
                
                const token = encodeURIComponent(localStorage.getItem('fo_token') || '');
                img.src = coverPath.startsWith('http') || coverPath.startsWith('/')
                  ? coverPath 
                  : `/api/carousels/${c.id}/image/${coverPath}?token=${token}`;
                
                img.onload = () => resolve();
                img.onerror = () => resolve(); // se falhar imagem individual não trava o dashboard
              });
            });
          
          // Aguarda o pré-carregamento de todas as imagens de capa
          await Promise.all(imagePromises);
        }
      } catch (err) {
        console.error("Erro na inicialização do painel:", err);
      } finally {
        // Transição suave
        setTimeout(() => {
          setInitialLoading(false);
        }, 400);
      }
    };

    initApp();

    const handleShowLogout = () => setLogoutModalOpen(true);
    window.addEventListener('show-logout-modal', handleShowLogout);
    return () => {
      window.removeEventListener('show-logout-modal', handleShowLogout);
    };
  }, []);

  // Polling para carrosseis em geração — caso a conexão SSE caia (ex: container reiniciado)
  useEffect(() => {
    const hasGenerating = allCarousels.some(c => c.status === 'generating');
    if (!hasGenerating) return;
    const interval = setInterval(() => {
      loadCarousels();
    }, 5000);
    return () => clearInterval(interval);
  }, [allCarousels]);

  const loadCurrentUser = async () => {
    try {
      const res = await customFetch('/api/me');
      const data = await res.json();
      if (res.ok) {
        setCurrentUser(data);
      } else {
        localStorage.removeItem('fo_token');
        window.location.href = '/login';
      }
    } catch (e) {
      localStorage.removeItem('fo_token');
      window.location.href = '/login';
    }
  };

  useEffect(() => {
    document.title = "Oraculo";
  }, []);

  const loadBranding = async () => {
    try {
      const res = await customFetch('/api/settings/branding');
      const data = await res.json();
      if (data) {
        setBranding(data);
        localStorage.setItem('fo_branding', JSON.stringify(data));
      }
    } catch (e) {}
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setToastShow(true);
    setTimeout(() => setToastShow(false), 2500);
  };

  const loadCarousels = async () => {
    try {
      const res = await customFetch('/api/carousels');
      const data = await res.json();
      if (res.ok) {
        setAllCarousels(data);
        setImageVersion(Date.now());
        return data;
      }
    } catch (e) {
      showToast('Erro ao carregar carrosséis.');
    }
    return [];
  };

  const loadStats = async () => {
    try {
      const res = await customFetch('/api/stats');
      const data = await res.json();
      if (res.ok) {
        setStats(data);
      }
    } catch (e) {
      showToast('Erro ao carregar estatísticas.');
    }
  };

  const setupSSE = () => {
    const token = localStorage.getItem('fo_token');
    const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
    const eventSource = new EventSource(url);

    // Timeout para fechar o painel se ficar preso sem receber slides (ex: container reiniciado no meio da geração)
    let stuckTimer = null;
    const resetStuckTimer = () => {
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        setLiveSession(prev => prev ? { ...prev, visible: false } : null);
      }, 60000); // 60 segundos sem atividade → fecha
    };

    eventSource.onmessage = function(event) {
      try {
        const obj = JSON.parse(event.data);
        if (obj.type === 'start') {
          setLiveSession({
            carouselId: obj.carouselId,
            total: obj.total,
            slides: [],
            visible: true,
            expanded: false
          });
          loadCarousels();
          resetStuckTimer(); // inicia o watchdog
        } else if (obj.type === 'slide') {
          resetStuckTimer(); // renova o watchdog a cada slide recebido
          loadCarousels(); // recarrega a lista para mostrar a imagem do slide recém-criado
          loadStats(); // atualiza o custo em tempo real
          setLiveSession(prev => {
            if (!prev) return prev;
            const slides = [...prev.slides];
            const idx = slides.findIndex(s => s.num === obj.num);
            const slideData = {
              num: obj.num,
              estado: obj.estado,
              filename: obj.filename,
              title_text: obj.title_text,
              status: obj.status === 'ok' ? 'ok' : obj.status === 'erro' ? 'error' : 'loading',
              timestamp: Date.now()
            };
            if (idx >= 0) slides[idx] = slideData;
            else slides.push(slideData);
            return { ...prev, slides };
          });
        } else if (obj.type === 'done' || obj.type === 'registered') {
          if (stuckTimer) clearTimeout(stuckTimer); // cancela o watchdog
          loadCarousels();
          loadStats();
          // Fecha o painel automaticamente após 3 segundos
          setTimeout(() => {
            setLiveSession(prev => prev ? { ...prev, visible: false } : null);
          }, 3000);
        }
      } catch (e) {}
    };
    return () => { eventSource.close(); if (stuckTimer) clearTimeout(stuckTimer); };

  };

  const handleCreateCarousel = async (payload) => {
    try {
      const res = await customFetch('/api/carousels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        showToast('Carrossel criado com sucesso!');
        loadCarousels();
        loadStats();
      }
    } catch (e) {
      showToast('Erro ao criar carrossel.');
    }
  };

  const handleStartGeneration = async (carouselText, carouselId = null, extraOpts = {}) => {
    const payload = parseCarouselText(carouselText);
    if (payload.slides.length === 0) {
      showToast('⚠️ Não foram encontrados slides formatados para geração.', 'error');
      return;
    }

    const currentStyle = extraOpts?.visualStyle || localStorage.getItem('haucacau_visual_style') || 'identidade_oficial';
    payload.preset = currentStyle;
    if (payload.slides && payload.slides.length > 0) {
      payload.slides = payload.slides.map(s => ({
        ...s,
        preset: currentStyle,
        layout: currentStyle === 'identidade_oficial' ? 'identidade_oficial' : (currentStyle === 'criativo_papel' ? 'editorial_paper' : (s.layout || 'dramatico'))
      }));
    }

    if (carouselId) {
      payload.id = carouselId;
    }

    try {
      const res = await customFetch('/api/criador/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showToast('✦ Pipeline de geração iniciado com sucesso!');
        await loadCarousels();
        setActiveTab('carrosseis');
      } else {
        showToast(`Erro ao iniciar pipeline: ${data.error || data.detail || 'Erro no servidor'}`);
      }
    } catch (e) {
      showToast('Erro de conexão ao iniciar pipeline.');
    }
  };

  const handleStartMockGeneration = async (carouselText, carouselId = null) => {
    const payload = parseCarouselText(carouselText);
    if (payload.slides.length === 0) {
      showToast('⚠️ Não foram encontrados slides formatados para geração rápida.', 'error');
      return;
    }

    if (carouselId) {
      payload.id = carouselId;
    }

    try {
      const res = await customFetch('/api/escala/criar-mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast('⚡ Pipeline de geração rápida (mock) concluído!');
        await loadCarousels();
        setActiveTab('carrosseis');
      } else {
        showToast(`Erro ao criar design rápido: ${data.error || data.detail}`);
      }
    } catch (e) {
      showToast('Erro de conexão ao iniciar pipeline rápido.');
    }
  };

  const formatSize = (val) => {
    if (!val) return '';
    const clean = val.trim();
    if (/^\d+$/.test(clean)) return `${clean}px`;
    return clean;
  };

  const activeEditCarousel = allCarousels.find(x => x.id === editCarouselId);
  const editSlides = activeEditCarousel ? activeEditCarousel.slides : [];

  return (
    <div className="app-shell">
      {initialLoading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#09090b',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'opacity 0.5s ease',
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(201, 168, 76, 0.15)',
            borderTopColor: '#C9A84C',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            marginBottom: '20px'
          }} />
          <div style={{
            fontSize: '11px',
            color: 'rgba(237, 232, 223, 0.4)',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: 'sans-serif'
          }}>
            Carregando Estúdio...
          </div>
        </div>
      )}
      <style>{`
        .brand-name {
          font-size: ${formatSize(branding.logoSize)} !important;
          color: ${branding.logoColor} !important;
        }
        .carousel-card-title, .carousel-title, .slide-text, .lb-editor-textarea, .meta-textarea, .slide-preview-text {
          font-size: ${formatSize(branding.carouselTextSize)} !important;
          color: ${branding.carouselTextColor} !important;
        }
      `}</style>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        branding={branding}
        currentUser={currentUser}
        onNewCarousel={() => {
          setShouldAddFormMessage(true);
          setCriadorReadOnly(false);
          setActiveTab('criador');
        }}
      />

      <div className="main-area">
        {currentUser?.permissions?.[activeTab] === 'em_breve' ? (
          <InProgressPage activeTab={activeTab} currentUser={currentUser} />
        ) : (
          <>
            {activeTab === 'carrosseis' && (
              <Dashboard
                allCarousels={allCarousels}
                stats={stats}
                filterStatus={filterStatus}
                setFilterStatus={setFilterStatus}
                currentUser={currentUser}
                imageVersion={imageVersion}
                onOpenLightbox={handleOpenLightbox}
                onOpenEditModal={(id, filename) => {
                  setEditCarouselId(id);
                  setEditFilename(filename);
                  setEditModalOpen(true);
                }}
                onLoadCarousels={loadCarousels}
                showToast={showToast}
                onOpenHistoryModal={(id) => {
                  setHistoryCarouselId(id);
                  setHistoryModalOpen(true);
                }}
                onLoadChatHistory={(chatHistory) => {
                  setCriadorInitialMessages(chatHistory);
                  setCriadorReadOnly(true);
                  setActiveTab('criador');
                }}
              />
            )}

            {activeTab === 'calendario' && (
              <Calendar
                allCarousels={allCarousels}
                onLoadCarousels={loadCarousels}
                showToast={showToast}
                imageVersion={imageVersion}
              />
            )}

            {activeTab === 'reels' && (
              <ReelsCloner
                onOpenNewModal={(defaults) => {
                  setNewModalDefaults(defaults);
                  setNewModalOpen(true);
                }}
                showToast={showToast}
              />
            )}

            {activeTab === 'oraculo' && <Oraculo showToast={showToast} />}
            {activeTab === 'radar' && <Radar showToast={showToast} />}
            {activeTab === 'fabrica' && <VideoFactory />}
            {activeTab === 'criador' && (
              <Criador
                onStartGeneration={handleStartGeneration}
                showToast={showToast}
                shouldAddFormMessage={shouldAddFormMessage}
                clearAddFormMessage={() => setShouldAddFormMessage(false)}
                initialMessages={criadorInitialMessages}
                clearInitialMessages={() => setCriadorInitialMessages(null)}
                isReadOnly={criadorReadOnly}
              />
            )}
            {activeTab === 'configuracoes' && <Settings showToast={showToast} onLoadBranding={loadBranding} currentUser={currentUser} />}
            {activeTab === 'users' && <UsersManagement showToast={showToast} />}
            {activeTab === 'backups' && <BackupManagement showToast={showToast} />}
            {activeTab === 'escala' && (
              <Criador
                onStartGeneration={handleStartMockGeneration}
                showToast={showToast}
                shouldAddFormMessage={shouldAddFormMessage}
                clearAddFormMessage={() => setShouldAddFormMessage(false)}
                initialMessages={criadorInitialMessages}
                clearInitialMessages={() => setCriadorInitialMessages(null)}
                isReadOnly={criadorReadOnly}
                isMockFlow={true}
              />
            )}
          </>
        )}
      </div>

      <Lightbox
        isOpen={lightboxOpen}
        onClose={() => { setLightboxOpen(false); loadCarousels(); }}
        carouselId={lightboxCarouselId}
        slides={lightboxSlides}
        initialIndex={lightboxIndex}
        onOpenEditModal={(id, filename) => {
          setEditCarouselId(id);
          setEditFilename(filename);
          setEditModalOpen(true);
        }}
        showToast={showToast}
      />

      <NewCarouselModal
        isOpen={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreate={handleCreateCarousel}
        defaults={newModalDefaults}
        onSendToChat={(briefing) => {
          setShouldAddFormMessage(true);
          setActiveTab('criador');
        }}
      />

      <EditSlideModal
        isOpen={editModalOpen}
        onClose={() => { setEditModalOpen(false); loadCarousels(); }}
        onSave={() => { loadCarousels(); setImageVersion(Date.now()); }}
        carouselId={editCarouselId}
        filename={editFilename}
        onChangeFilename={(newFilename) => setEditFilename(newFilename)}
        slides={editSlides}
        showToast={showToast}
        onOpenLightbox={handleOpenLightbox}
      />

      <LiveGenPanel
        liveSession={liveSession}
        setLiveSession={setLiveSession}
        onOpenLightbox={handleOpenLightbox}
      />

      <GenerationHistoryModal
        isOpen={historyModalOpen}
        onClose={() => { setHistoryModalOpen(false); loadCarousels(); }}
        carouselId={historyCarouselId}
      />

      <LogoutModal
        logoutModalOpen={logoutModalOpen}
        setLogoutModalOpen={setLogoutModalOpen}
      />

      <div className={`toast ${toastShow ? 'show' : ''}`} id="toast">
        {toastMessage}
      </div>
    </div>
  );
}
