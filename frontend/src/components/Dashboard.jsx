import React, { useState, useEffect } from 'react';
import { useScrollLock } from '../hooks/useScrollLock';
import PipelineModal from './PipelineModal';
import { customFetch } from '../utils/customFetch';

function GeneratingBadge({ startedAt, carousel }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const getStartMs = (val) => {
      if (!val) return Date.now();
      if (typeof val === 'number') return val;
      const parsed = new Date(val).getTime();
      return isNaN(parsed) ? Date.now() : parsed;
    };

    const start = getStartMs(startedAt);
    setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    const interval = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const formattedTime = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const totalSlides = Number(carousel?.totalSlides) || 10;
  const currentSlidesCount = Array.isArray(carousel?.slides) ? carousel.slides.length : 0;
  const progressPercent = Math.min(100, Math.round((currentSlidesCount / totalSlides) * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="badge badge-generating" style={{ background: 'rgba(240, 91, 0, 0.15)', color: 'var(--gold, #F05B00)', border: '1px solid rgba(240, 91, 0, 0.4)', fontWeight: 'bold', fontSize: '11px', padding: '3px 8px', borderRadius: '4px' }}>
          ⚡ Gerando artes: {currentSlidesCount}/{totalSlides} ({progressPercent}%)
        </span>
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: '500' }}>{formattedTime}</span>
      </div>
      <div style={{ width: '100%', height: '5px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
        <div 
          style={{ 
            height: '100%', 
            width: `${Math.max(5, progressPercent)}%`, 
            background: 'linear-gradient(90deg, #F05B00 0%, #18B0AC 100%)', 
            borderRadius: '3px', 
            transition: 'width 0.5s ease-in-out' 
          }} 
        />
      </div>
    </div>
  );
}

export default function Dashboard({
  allCarousels,
  stats,
  filterStatus,
  setFilterStatus,
  onOpenLightbox,
  onOpenEditModal,
  onLoadCarousels,
  onLoadStats,
  showToast,
  onOpenHistoryModal,
  onLoadChatHistory,
  imageVersion
}) {
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedCards, setExpandedCards] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [selectedDetailsCarousel, setSelectedDetailsCarousel] = useState(null);
  const [selectedPipelineCarousel, setSelectedPipelineCarousel] = useState(null);
  const [isCaptionMaximized, setIsCaptionMaximized] = useState(false);
  const [retryingId, setRetryingId] = useState(null);

  const [editedCaption, setEditedCaption] = useState('');
  const [isSavingCaption, setIsSavingCaption] = useState(false);

  const handleOpenCaptionModal = (carousel) => {
    setSelectedDetailsCarousel(carousel);
    setEditedCaption(carousel.caption_full || carousel.caption || '');
    setIsCaptionMaximized(true);
  };

  const handleSaveCaption = async () => {
    if (!selectedDetailsCarousel) return;
    setIsSavingCaption(true);
    try {
      const res = await customFetch(`/api/carousels/${selectedDetailsCarousel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: editedCaption,
          caption_full: editedCaption
        })
      });
      const data = await res.json();
      if (res.ok && data.id) {
        showToast('Legenda atualizada com sucesso!', 'success');
        setSelectedDetailsCarousel(prev => prev ? { ...prev, caption: editedCaption, caption_full: editedCaption } : null);
        if (typeof onLoadCarousels === 'function') onLoadCarousels();
        setIsCaptionMaximized(false);
      } else {
        showToast(data.error || 'Erro ao salvar legenda.', 'error');
      }
    } catch (err) {
      showToast('Erro de conexão ao salvar legenda.', 'error');
    } finally {
      setIsSavingCaption(false);
    }
  };

  const [publishErrorModal, setPublishErrorModal] = useState(null); // { carouselId, error }
  const [copiedError, setCopiedError] = useState(false);
  const [confirmPublishCarousel, setConfirmPublishCarousel] = useState(null); // carrossel para confirmar
  const [isScheduleMode, setIsScheduleMode] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [publishResultModal, setPublishResultModal] = useState(null); // { success: true/false, carouselId, postId, log, error }
  const [publishingId, setPublishingId] = useState(null);
  const [schedulingId, setSchedulingId] = useState(null); // carrossel sendo agendado (diferente de publicando)

  // Trava scroll do body quando qualquer modal estiver aberto
  const anyModalOpen = !!selectedDetailsCarousel || !!selectedPipelineCarousel || isBulkDeleteModalOpen || !!deleteTargetId || isCaptionMaximized || !!publishErrorModal || !!confirmPublishCarousel || !!publishResultModal;
  useScrollLock(anyModalOpen);

  const handleRetryGeneration = async (carouselId) => {
    if (retryingId) return;
    setRetryingId(carouselId);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/carousels/${carouselId}/retry`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Erro ao iniciar retentativa', 'error');
        setRetryingId(null);
        return;
      }
      showToast('🔄 Retentativa iniciada! Acompanhe no chat do carrossel.', 'success');
      setTimeout(() => { onLoadCarousels(); onLoadStats(); setRetryingId(null); }, 3000);
    } catch (e) {
      showToast('Erro de conexão ao tentar recriar', 'error');
      setRetryingId(null);
    }
  };

  const handlePageSizeChange = (val) => {
    setPageSize(Number(val));
    setCurrentPage(1);
  };

  const handleTogglePin = async (carouselId, currentPinState) => {
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('fo_token');
      const res = await fetch(`/api/carousels/${carouselId}/pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ isPinned: !currentPinState })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(!currentPinState ? '📌 Carrossel fixado no topo!' : 'Carrossel desfixado do topo.');
        if (onLoadCarousels) onLoadCarousels();
      } else {
        showToast(data.error || 'Erro ao alternar fixação do carrossel.', 'error');
      }
    } catch (e) {
      showToast('Erro de conexão ao fixar carrossel.', 'error');
    }
  };

  // Filter & Pagination
  const filtered = allCarousels.filter(c => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'rascunho') {
      return c.status === 'rascunho' || c.status === 'generating';
    }
    return c.status === filterStatus;
  });

  const sortedFiltered = [...filtered].sort((a, b) => {
    const isAPinned = Boolean(a.isPinned);
    const isBPinned = Boolean(b.isPinned);
    if (isAPinned && !isBPinned) return -1;
    if (!isAPinned && isBPinned) return 1;
    if (isAPinned && isBPinned) {
      const timeA = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const timeB = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      return timeB - timeA;
    }
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / pageSize));
  const pageStartIndex = (currentPage - 1) * pageSize;
  const paginated = sortedFiltered.slice(pageStartIndex, pageStartIndex + pageSize);

  // Reseta seleção ao mudar o filtro
  useEffect(() => {
    setSelectedIds([]);
  }, [filterStatus]);

  const toggleExpand = (id) => {
    setExpandedCards(prev => (prev[id] ? {} : { [id]: true }));
  };

  const handleSelectCard = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const allFilteredIds = filtered.map(c => c.id);
    const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.includes(id));
    if (isAllSelected) {
      setSelectedIds(prev => prev.filter(id => !allFilteredIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const handleStatusChange = async (carouselId, status) => {
    try {
      const res = await customFetch(`/api/carousels/${carouselId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        showToast(`Status atualizado para: ${status.toUpperCase()}`);
        onLoadCarousels();
      }
    } catch (e) {
      showToast('Erro ao atualizar status.');
    }
  };

  const handlePublish = (carousel) => {
    setIsScheduleMode(false);
    // Padrão de 1 hora a partir de agora para agendamento
    const defaultDate = new Date(Date.now() + 3600 * 1000);
    const tzOffset = defaultDate.getTimezoneOffset() * 60000;
    const localISOTime = new Date(defaultDate.getTime() - tzOffset).toISOString().slice(0, 16);
    setScheduledDateTime(localISOTime);
    setConfirmPublishCarousel(carousel);
  };

  const executePublish = async () => {
    if (!confirmPublishCarousel) return;
    const carouselId = confirmPublishCarousel.id;
    const carouselTitle = confirmPublishCarousel.title;

    let unixTimestamp = null;
    if (isScheduleMode) {
      if (!scheduledDateTime) {
        showToast('Selecione a data e hora do agendamento.', 'error');
        return;
      }
      const targetMs = new Date(scheduledDateTime).getTime();
      const nowMs = Date.now();
      const minMs = nowMs + 15 * 60 * 1000; // Mínimo 15 min no futuro exigido pela Meta API
      const maxMs = nowMs + 75 * 24 * 3600 * 1000; // Máximo 75 dias

      if (targetMs < minMs) {
        showToast('A Meta exige que o agendamento seja com no mínimo 15 minutos de antecedência.', 'error');
        return;
      }
      if (targetMs > maxMs) {
        showToast('O agendamento não pode exceder 75 dias no futuro.', 'error');
        return;
      }
      unixTimestamp = Math.floor(targetMs / 1000);
    }

    setConfirmPublishCarousel(null);
    setPublishingId(carouselId);
    if (isScheduleMode) setSchedulingId(carouselId);
    showToast(isScheduleMode ? '⏳ Agendando postagem no Instagram...' : '⏳ Iniciando publicação no Instagram...', 'info');

    try {
      if (!isScheduleMode) {
        await customFetch(`/api/carousels/${carouselId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'publicando' })
        }).catch(() => {});
        onLoadCarousels();
      }

      const res = await customFetch(`/api/carousels/${carouselId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(unixTimestamp ? { scheduled_publish_time: unixTimestamp } : {})
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(isScheduleMode ? '✓ Carrossel agendado com sucesso no Instagram!' : '✓ Publicado com sucesso no Instagram!', 'success');
        setPublishResultModal({
          success: true,
          isScheduled: isScheduleMode,
          scheduledDate: scheduledDateTime,
          carouselId,
          title: carouselTitle,
          log: data.log || '',
          postId: data.carousel?.instagramMediaId || ''
        });
        if (!isScheduleMode) {
          await customFetch(`/api/carousels/${carouselId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'publicado' })
          }).catch(() => {});
        }
        await onLoadCarousels();
      } else {
        const errorMsg = data.error || data.detail || (typeof data === 'string' ? data : 'Erro desconhecido ao tentar conectar ao Instagram.');
        showToast(isScheduleMode ? `Erro ao agendar no Instagram.` : `Erro ao publicar no Instagram.`, 'error');
        setPublishResultModal({
          success: false,
          carouselId,
          title: carouselTitle,
          error: errorMsg,
          log: data.log || ''
        });
        onLoadCarousels();
      }
    } catch (e) {
      showToast('Erro ao conectar com o servidor.', 'error');
      setPublishResultModal({
        success: false,
        carouselId,
        title: carouselTitle,
        error: e.message || 'Erro de conexão com o servidor. Verifique a internet e tente novamente.'
      });
    } finally {
      setPublishingId(null);
      setSchedulingId(null);
    }
  };

  const handleDownloadZip = async (carouselId) => {
    showToast('Preparando download do ZIP...');
    try {
      const res = await fetch(`/api/carousels/${carouselId}/download-zip`);
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `carrossel-${carouselId}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('✓ ZIP baixado com sucesso!');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('Erro ao baixar ZIP: ' + (err.error || 'sem slides'));
      }
    } catch (e) {
      showToast('Erro de conexão ao baixar ZIP.');
    }
  };

  const confirmDeleteIndividual = async () => {
    if (!deleteTargetId) return;
    try {
      const res = await fetch(`/api/carousels/${deleteTargetId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Carrossel excluído com sucesso.');
        setSelectedIds(prev => prev.filter(x => x !== deleteTargetId));
        setDeleteTargetId(null);
        onLoadCarousels();
        if (onLoadStats) onLoadStats();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || err.detail || 'Erro ao excluir carrossel.');
      }
    } catch (e) {
      showToast('Erro de conexão ao excluir carrossel.');
    }
  };

  const confirmDeleteBulk = async () => {
    if (selectedIds.length === 0) return;
    try {
      const res = await fetch('/api/carousels/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });
      if (res.ok) {
        showToast(`${selectedIds.length} carrosséis excluídos.`);
        setSelectedIds([]);
        setIsBulkDeleteModalOpen(false);
        onLoadCarousels();
        if (onLoadStats) onLoadStats();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || err.detail || 'Erro ao excluir carrosséis.');
      }
    } catch (e) {
      showToast('Erro de conexão ao excluir carrosséis.');
    }
  };

  const allFilteredIds = filtered.map(c => c.id);
  const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.includes(id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 120px)' }}>
      <div className="stats-row">
        <div className="stat-card" style={{ '--accent': 'var(--gold)' }}>
          <div className="stat-num">{stats?.total || 0}</div>
          <div className="stat-label">Carrosséis produzidos</div>
        </div>
        <div className="stat-card" style={{ '--accent': 'var(--cyan)' }}>
          <div className="stat-num">{stats?.slides || 0}</div>
          <div className="stat-label">Slides gerados</div>
        </div>
        <div className="stat-card" style={{ '--accent': 'var(--green)' }}>
          <div className="stat-num">{stats?.aprovados || 0}</div>
          <div className="stat-label">Aprovados / prontos</div>
        </div>
        <div className="stat-card" style={{ '--accent': 'var(--purple)' }}>
          <div className="stat-num">{stats?.publicados || 0}</div>
          <div className="stat-label">Publicados</div>
        </div>
        <div className="stat-card" style={{ '--accent': 'var(--green)' }}>
          <div className="stat-num" style={{ fontSize: stats?.cost && stats.cost > 0 ? '28px' : undefined }}>R$ {stats?.cost !== undefined && stats?.cost !== null ? Number(stats.cost).toFixed(2) : '0,00'}</div>
          <div className="stat-label">Custo total (BRL)</div>
        </div>
      </div>

      <div className="section" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'flex-start' }}>
          <div className="section-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="section-title">Carrosséis</div>
            {filtered.length > 0 && (
              <button 
                className="btn btn-outline btn-sm"
                onClick={handleSelectAll}
                style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}
              >
                {isAllSelected ? 'Desmarcar Todos' : 'Selecionar Todos'}
              </button>
            )}
            {selectedIds.length > 0 && (
              <button
                className="btn-danger btn-sm"
                onClick={() => setIsBulkDeleteModalOpen(true)}
                style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                🗑 Excluir Selecionados ({selectedIds.length})
              </button>
            )}
          </div>
          <div className="filter-row">
            {['all', 'rascunho', 'pronto', 'aprovado', 'agendado', 'publicando', 'publicado'].map(status => (
              <button
                key={status}
                className={`btn btn-outline btn-sm ${filterStatus === status ? 'active' : ''}`}
                onClick={() => { setFilterStatus(status); setCurrentPage(1); }}
                style={status === 'agendado' ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : (status === 'publicando' ? { borderColor: '#60a5fa', color: '#60a5fa' } : {})}
              >
                {status === 'all' ? 'Todos' : status.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="carousel-grid">
          {paginated.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">⏳</div>
              <div className="empty-text">Nenhum carrossel encontrado.</div>
            </div>
          ) : (
            paginated.map(c => {
              const isExpanded = expandedCards[c.id];
              const isSelected = selectedIds.includes(c.id);
              return (
                <div className={`carousel-card ${isSelected ? 'selected' : ''}`} key={c.id} style={{ position: 'relative' }}>
                  {/* Checkbox de seleção em lote */}
                  <div 
                    onClick={(e) => e.stopPropagation()} 
                    style={{ 
                      position: 'absolute', 
                      top: '12px', 
                      left: '12px', 
                      zIndex: 20, 
                      background: 'rgba(0, 0, 0, 0.75)', 
                      borderRadius: '4px', 
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid rgba(255, 255, 255, 0.15)'
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      onChange={() => handleSelectCard(c.id)}
                      style={{ 
                        width: '16px', 
                        height: '16px', 
                        cursor: 'pointer',
                        accentColor: 'var(--gold)'
                      }}
                    />
                  </div>

                  {/* Botão de Fixar no Topo */}
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePin(c.id, c.isPinned);
                    }}
                    title={c.isPinned ? "Desfixar do topo" : "Fixar no topo (máx 10)"}
                    style={{ 
                      position: 'absolute', 
                      top: '12px', 
                      right: '12px', 
                      zIndex: 20, 
                      background: c.isPinned ? 'rgba(234, 179, 8, 0.25)' : 'rgba(0, 0, 0, 0.75)', 
                      color: c.isPinned ? '#facc15' : '#9ca3af',
                      border: c.isPinned ? '1px solid rgba(250, 204, 21, 0.6)' : '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '6px', 
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      transition: 'all 0.2s ease-in-out'
                    }}
                  >
                    📌 {c.isPinned && <span>FIXADO</span>}
                  </button>

                  <div className="card-header" onClick={() => toggleExpand(c.id)}>
                    {c.slides && c.slides.length > 0 ? (
                      <img src={`/api/carousels/${c.id}/image/${c.slides[0]}?token=${encodeURIComponent(localStorage.getItem('fo_token') || '')}&v=${imageVersion}`} className="card-thumb" alt="" />
                    ) : (
                      <div className="card-thumb-placeholder">{c.status === 'generating' ? '⏳' : '🎨'}</div>
                    )}
                    <div className="card-meta">
                      <div className="card-title">{c.title}</div>
                      <div className="card-badges">
                        {c.isPinned && (
                          <span className="badge" style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#facc15', border: '1px solid rgba(250, 204, 21, 0.4)', fontWeight: 'bold' }}>
                            📌 FIXADO
                          </span>
                        )}
                        <span className="badge badge-format">F: {c.format}</span>
                        {c.status === 'generating' ? (
                          <GeneratingBadge startedAt={c.generationStartedAt} carousel={c} />
                        ) : c.status === 'queued' ? (
                          <span className="badge" style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#facc15', border: '1px solid rgba(250, 204, 21, 0.4)', fontWeight: 'bold' }}>
                            ⏳ em fila
                          </span>
                        ) : (
                          <span className={`badge badge-${c.status}`}>{c.status}</span>
                        )}
                        {(c.generationDuration || c.generationTimeSeconds) && c.status !== 'generating' && (
                          <span className="badge" title="Tempo gasto para gerar o carrossel" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(96, 165, 250, 0.3)', fontWeight: '500' }}>
                            ⏱️ {c.generationDuration || (c.generationTimeSeconds >= 60 ? `${Math.floor(c.generationTimeSeconds / 60)}m ${c.generationTimeSeconds % 60}s` : `${c.generationTimeSeconds}s`)}
                          </span>
                        )}
                        {c.preset === 'escala' && (
                          <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', fontWeight: 'bold' }}>MOCK</span>
                        )}
                      </div>
                      <div className="card-date">
                        {c.scheduledDate ? `📅 ${c.scheduledDate} ${c.scheduledTime || ''}` : new Date(c.createdAt || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <>
                      <div className="slide-strip open">
                        {Array.from({ length: c.status === 'generating' ? (c.totalSlides || 10) : (c.slides?.length || 0) }).map((_, idx) => {
                          const slide = c.slides && c.slides[idx];
                          if (slide) {
                            return (
                              <div className="slide-thumb-wrap" key={idx}>
                                <img
                                  src={`/api/carousels/${c.id}/image/${slide}?token=${encodeURIComponent(localStorage.getItem('fo_token') || '')}&v=${imageVersion}`}
                                  className="slide-thumb"
                                  alt=""
                                />
                                <div className="slide-thumb-num">{idx + 1}</div>
                                <div className="slide-actions-overlay" style={{ cursor: 'pointer' }} onClick={() => onOpenLightbox(c.id, c.slides, idx)}>
                                  <button className="slide-icon-btn" title="Visualizar/Maximizar" style={{ background: 'var(--green, #22c55e)', color: '#fff' }}>👁</button>
                                  <button className="slide-icon-btn slide-icon-btn-dl" title="Baixar" onClick={(e) => {
                                    e.stopPropagation();
                                    const a = document.createElement('a');
                                    a.href = `/api/carousels/${c.id}/image/${slide}?token=${encodeURIComponent(localStorage.getItem('fo_token') || '')}&v=${imageVersion}`;
                                    a.download = slide;
                                    a.click();
                                  }}>↓</button>
                                  <button className="slide-icon-btn slide-icon-btn-edit" title="Editar" onClick={(e) => {
                                     e.stopPropagation();
                                     onOpenEditModal(c.id, slide, c.slides);
                                   }}>✎</button>
                                </div>
                              </div>
                            );
                          } else {
                            return (
                              <div className="slide-thumb-wrap" key={idx}>
                                <div className="slide-thumb-loading">
                                  <div className="slide-thumb-spinner"></div>
                                </div>
                                <div className="slide-thumb-num">{idx + 1}</div>
                              </div>
                            );
                          }
                        })}
                      </div>
                      {c.caption && (
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', padding: '0 4px' }}>
                            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.05em' }}>Legenda</span>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{
                                fontSize: '10px',
                                padding: '2px 10px',
                                height: 'auto',
                                minHeight: 'auto',
                                borderColor: 'rgba(201, 168, 76, 0.4)',
                                color: 'var(--gold)',
                                backgroundColor: 'rgba(18, 18, 20, 0.85)'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenCaptionModal(c);
                              }}
                            >
                              ✏️ Editar Legenda
                            </button>
                          </div>
                          <div className="caption-box open" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleOpenCaptionModal(c); }}>
                            {c.caption_full || c.caption}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="card-footer">
                    <select
                      className="status-select"
                      value={c.status}
                      disabled={c.status === 'generating' || c.status === 'queued'}
                      onChange={(e) => handleStatusChange(c.id, e.target.value)}
                    >
                      <option value="rascunho">Rascunho</option>
                      <option value="pronto">Pronto</option>
                      <option value="aprovado">Aprovado</option>
                      <option value="agendado">Agendado</option>
                      <option value="publicando">Publicando</option>
                      <option value="publicado">Publicado</option>
                    </select>

                    <div className="card-actions">
                      {c.chatHistory && c.chatHistory.length > 0 && (
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ borderColor: 'var(--gold, #e0a96d)', color: 'var(--gold, #e0a96d)' }}
                          onClick={(e) => { e.stopPropagation(); onLoadChatHistory(c.chatHistory); }}
                        >
                          💬 Ver no Chat
                        </button>
                      )}

                      {c.status !== 'generating' && c.status !== 'queued' && (
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ borderColor: '#22c55e', color: '#22c55e', opacity: retryingId === c.id ? 0.6 : 1 }}
                          disabled={!!retryingId}
                          onClick={(e) => { e.stopPropagation(); handleRetryGeneration(c.id); }}
                          title="Recriar carrossel gerando as artes"
                        >
                          {retryingId === c.id ? '⏳ Recriando...' : '🔄 Recriar'}
                        </button>
                      )}

                      {c.status !== 'generating' && c.status !== 'queued' && (
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ borderColor: '#8b5cf6', color: '#a78bfa' }}
                          onClick={(e) => { e.stopPropagation(); setSelectedPipelineCarousel(c); }}
                          title="Ver todo o pipeline de criação e prompts utilizados"
                        >
                          ⚡ Pipeline
                        </button>
                      )}

                      {c.status !== 'generating' && c.status !== 'queued' && (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={(e) => { e.stopPropagation(); setSelectedDetailsCarousel(c); }}
                        >
                          🔎 Detalhes
                        </button>
                      )}

                      {c.slides && c.slides.length > 0 && (
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ borderColor: '#a855f7', color: '#a855f7' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const firstSlide = typeof c.slides[0] === 'string' ? c.slides[0] : c.slides[0].filename;
                            onOpenEditModal(c.id, firstSlide, c.slides);
                          }}
                        >
                          ✏️ Editar
                        </button>
                      )}

                      {c.status === 'publicando' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            className="btn-instagram btn-sm"
                            disabled={true}
                            style={{ opacity: 0.8 }}
                          >
                            ⏳ Publicando...
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ borderColor: '#ef4444', color: '#ef4444', padding: '4px 8px' }}
                            title="Cancelar modo de publicação e voltar para pronto"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(c.id, 'pronto');
                            }}
                          >
                            ✕ Cancelar
                          </button>
                        </div>
                      ) : (
                        c.status !== 'generating' && c.status !== 'queued' && c.status !== 'failed' && c.slides && c.slides.length > 0 && (
                          <button
                            className="btn-instagram btn-sm"
                            disabled={c.status === 'publicado' || c.status === 'agendado' || publishingId === c.id}
                            onClick={() => handlePublish(c)}
                          >
                            {c.status === 'publicado' ? '✓ Postado' : (c.status === 'agendado' ? '📅 Agendado' : (schedulingId === c.id ? '⏳ Agendando...' : (publishingId === c.id ? '⏳ Publicando...' : '✈ Postar')))}
                          </button>
                        )
                      )}
                      {c.slides && c.slides.length > 0 && c.totalSlides > 0 && c.slides.length === c.totalSlides && (
                        <button 
                          className="btn btn-outline btn-sm" 
                          onClick={(e) => { e.stopPropagation(); handleDownloadZip(c.id); }} 
                          title="Baixar todos os slides em ZIP"
                        >
                          Baixar
                        </button>
                      )}
                      <button className="btn-danger btn-sm" onClick={() => setDeleteTargetId(c.id)}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        </div>

        {filtered.length > 0 && (
          <div className="pagination" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="pagination-info" style={{ margin: 0 }}>Mostrar</span>
              <select
                value={pageSize}
                onChange={e => handlePageSizeChange(e.target.value)}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  outline: 'none',
                  fontFamily: 'inherit'
                }}
              >
                <option value="20">20 por página</option>
                <option value="50">50 por página</option>
                <option value="100">100 por página</option>
              </select>
            </div>

            {totalPages > 1 && (
              <div className="pagination-controls" style={{ margin: 0 }}>
                <button className="page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>Anterior</button>
                {Array.from({ length: totalPages }).map((_, idx) => (
                  <button
                    key={idx}
                    className={`page-btn ${currentPage === idx + 1 ? 'active' : ''}`}
                    onClick={() => setCurrentPage(idx + 1)}
                  >
                    {idx + 1}
                  </button>
                ))}
                <button className="page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Próxima</button>
              </div>
            )}

            <span className="pagination-info" style={{ margin: 0 }}>
              Página {currentPage} de {totalPages} ({filtered.length} no total)
            </span>
          </div>
        )}
      </div>

      {/* Modal de Confirmação de Exclusão Individual */}
      {deleteTargetId && (
        <div className="form-modal open">
          <div className="form-box">
            <h3 className="form-title" style={{ color: 'var(--red, #f43f5e)', fontSize: '16px' }}>Confirmar Exclusão</h3>
            <p style={{ margin: '14px 0 24px', color: '#e4e4e7', fontSize: '14px', lineHeight: '1.5' }}>
               Você tem certeza que deseja excluir permanentemente este carrossel? Esta ação não pode ser desfeita e removerá todos os arquivos físicos e registros.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-outline" onClick={() => setDeleteTargetId(null)}>Cancelar</button>
              <button className="btn btn-danger" style={{ backgroundColor: 'var(--red, #f43f5e)', color: '#ffffff', border: 'none' }} onClick={confirmDeleteIndividual}>Excluir permanentemente</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão em Lote */}
      {isBulkDeleteModalOpen && (
        <div className="form-modal open">
          <div className="form-box">
            <h3 className="form-title" style={{ color: 'var(--red, #f43f5e)', fontSize: '16px' }}>Confirmar Exclusão em Lote</h3>
            <p style={{ margin: '14px 0 24px', color: '#e4e4e7', fontSize: '14px', lineHeight: '1.5' }}>
              Você tem certeza que deseja excluir permanentemente os <strong>{selectedIds.length}</strong> carrosséis selecionados? Esta ação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-outline" onClick={() => setIsBulkDeleteModalOpen(false)}>Cancelar</button>
              <button className="btn btn-danger" style={{ backgroundColor: 'var(--red, #f43f5e)', color: '#ffffff', border: 'none' }} onClick={confirmDeleteBulk}>Excluir permanentemente</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Carrossel */}
      {selectedDetailsCarousel && (
        <div className="form-modal open">
          <div className="form-box" style={{ maxWidth: '550px', padding: '24px' }}>
            <h3 className="form-title" style={{ color: 'var(--gold, #C9A84C)', fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ℹ️ Detalhes do Carrossel
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', color: '#e4e4e7', fontSize: '13px' }}>
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
                <span style={{ color: 'var(--gold, #C9A84C)', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', letterSpacing: '0.5px' }}>
                  Título / Gancho
                  {selectedDetailsCarousel.preset === 'escala' && (
                    <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '1px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' }}>MOCK</span>
                  )}
                </span>
                <strong style={{ fontSize: '16px', color: '#ffffff', lineHeight: '1.4', display: 'block' }}>{selectedDetailsCarousel.title || 'Sem título'}</strong>
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
                  <span style={{ color: 'var(--gold, #C9A84C)', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' }}>Tema</span>
                  <span style={{ fontFamily: 'monospace', color: '#ffffff', fontSize: '14px', fontWeight: '600', background: 'rgba(56, 189, 248, 0.1)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.2)', display: 'inline-block' }}>{selectedDetailsCarousel.theme || 'Não definido'}</span>
                </div>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Slides</span>
                  <span style={{ fontWeight: '600' }}>{selectedDetailsCarousel.slides?.length || 0} / {selectedDetailsCarousel.totalSlides || 10}</span>
                </div>
              </div>

              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Qualidade / Resolução</span>
                <span style={{ textTransform: 'capitalize', fontWeight: '500' }}>
                  {(() => {
                    const q = selectedDetailsCarousel.imageQuality;
                    if (q === 'low') return 'Baixa (Low)';
                    if (q === 'medium') return 'Média (Medium)';
                    if (q === 'high') return 'Alta (High)';
                    if (q === 'hd') return 'HD (DALL-E 3)';
                    if (q === 'standard') return 'Padrão (DALL-E 3)';
                    if (q === 'auto') return 'Automático (Auto)';
                    return q || 'Alta (High)';
                  })()}
                </span>
              </div>

              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Criado em (Horário de Brasília)</span>
                <span style={{ fontWeight: '500' }}>
                  {new Date(selectedDetailsCarousel.createdAt || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </span>
              </div>

              {selectedDetailsCarousel.caption && (
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase' }}>Legenda (Caption)</span>
                    <button 
                      className="btn btn-outline btn-sm" 
                      style={{ fontSize: '10px', padding: '2px 8px', height: 'auto', minHeight: 'auto', border: '1px solid rgba(201, 168, 76, 0.4)', color: 'var(--gold)' }}
                      onClick={() => handleOpenCaptionModal(selectedDetailsCarousel)}
                    >
                      ✏️ Editar Legenda
                    </button>
                  </div>
                  <div style={{ 
                    maxHeight: '80px', 
                    overflowY: 'auto', 
                    backgroundColor: 'rgba(0,0,0,0.2)', 
                    padding: '8px', 
                    borderRadius: '4px', 
                    whiteSpace: 'pre-wrap', 
                    fontSize: '11px',
                    color: '#d4d4d8'
                  }}>
                    {selectedDetailsCarousel.caption_full || selectedDetailsCarousel.caption}
                  </div>
                </div>
              )}

              {selectedDetailsCarousel.notes && (
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Conteúdo / Roteiro (Slides e Prompts)</span>
                  <div style={{ 
                    maxHeight: '150px', 
                    overflowY: 'auto', 
                    backgroundColor: 'rgba(0,0,0,0.2)', 
                    padding: '8px', 
                    borderRadius: '4px', 
                    whiteSpace: 'pre-wrap', 
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    color: '#a1a1aa'
                  }}>
                    {selectedDetailsCarousel.notes}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Custo Total (USD)</span>
                  <span style={{ color: '#f43f5e', fontWeight: '600' }}>${Number(selectedDetailsCarousel.cost || 0).toFixed(2)}</span>
                </div>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Custo Total (BRL)</span>
                  <span style={{ color: '#22c55e', fontWeight: '600' }}>R$ {Number((selectedDetailsCarousel.cost || 0) * 5.60).toFixed(2)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Slides Gerados (API x Grátis)</span>
                  <span style={{ fontWeight: '500', color: '#e4e4e7' }}>
                    {selectedDetailsCarousel.costDetails ? (
                      <>
                        <span style={{ color: '#f43f5e' }}>{selectedDetailsCarousel.costDetails.paidSlides} pagos (API)</span>
                        {' · '}
                        <span style={{ color: '#22c55e' }}>{selectedDetailsCarousel.costDetails.freeSlides} grátis (text_only)</span>
                      </>
                    ) : (
                      `${selectedDetailsCarousel.totalSlides || 10} slides`
                    )}
                  </span>
                </div>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Economia com Text-Only</span>
                  <span style={{ fontWeight: '600', color: '#22c55e' }}>
                    {selectedDetailsCarousel.costDetails && selectedDetailsCarousel.costDetails.savedCost > 0 ? (
                      `R$ ${Number(selectedDetailsCarousel.costDetails.savedCost * 5.60).toFixed(2)} ($${Number(selectedDetailsCarousel.costDetails.savedCost).toFixed(2)})`
                    ) : (
                      'R$ 0,00'
                    )}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Custo / Slide Pago (USD)</span>
                  <span style={{ fontWeight: '500' }}>
                    ${Number(selectedDetailsCarousel.costDetails ? selectedDetailsCarousel.costDetails.costPerImage : (selectedDetailsCarousel.totalSlides > 0 ? (selectedDetailsCarousel.cost || 0) / selectedDetailsCarousel.totalSlides : 0)).toFixed(2)}
                  </span>
                </div>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Custo / Slide Pago (BRL)</span>
                  <span style={{ fontWeight: '500' }}>
                    R$ {Number((selectedDetailsCarousel.costDetails ? selectedDetailsCarousel.costDetails.costPerImage : (selectedDetailsCarousel.totalSlides > 0 ? (selectedDetailsCarousel.cost || 0) / selectedDetailsCarousel.totalSlides : 0)) * 5.60).toFixed(2)}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>IA dos Slides (Imagens)</span>
                  <span style={{ fontWeight: '500', color: '#06b6d4' }}>
                    {(() => {
                      const provider = selectedDetailsCarousel.imageProvider;
                      if (!provider || provider === 'gpt-image-2') return 'OpenAI GPT Image 2';
                      if (provider === 'dall-e-3') return 'OpenAI DALL-E 3';
                      if (provider === 'fal') return 'Flux Schnell (via Fal)';
                      if (provider === 'gemini') return 'Google Imagen 3';
                      if (provider === 'gpt-image-1-mini') return 'GPT Image 1 Mini';
                      if (provider === 'dall-e-2') return 'OpenAI DALL-E 2';
                      return provider.toUpperCase();
                    })()}
                  </span>
                </div>
                <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>LLM do Briefing, Prompt & Copy</span>
                  <span style={{ fontWeight: '500', color: 'var(--gold, #C9A84C)' }}>
                    {(() => {
                      const lastAssistantMsg = (selectedDetailsCarousel.chatHistory || []).slice().reverse().find(m => m.role === 'assistant' && m.model);
                      const model = lastAssistantMsg ? lastAssistantMsg.model : (selectedDetailsCarousel.copyModel || 'N/A');
                      return model.toUpperCase();
                    })()}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button className="btn btn-outline" style={{ padding: '8px 20px' }} onClick={() => setSelectedDetailsCarousel(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ampliado e Editável de Legenda (Caption) */}
      {isCaptionMaximized && selectedDetailsCarousel && (
        <div className="form-modal open" style={{ zIndex: 1100 }}>
          <div className="form-box" style={{ maxWidth: '720px', width: '90%', padding: '24px', background: '#121214' }}>
            <h3 className="form-title" style={{ color: 'var(--gold, #C9A84C)', fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
              📝 Editar Legenda
            </h3>
            
            <textarea
              className="form-textarea"
              style={{ 
                width: '100%', 
                minHeight: '240px', 
                maxHeight: '55vh',
                padding: '14px', 
                borderRadius: '6px', 
                backgroundColor: '#09090b', 
                color: '#f4f4f5', 
                border: '1px solid var(--border, rgba(255,255,255,0.15))',
                fontSize: '14px',
                lineHeight: '1.6',
                resize: 'vertical',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              value={editedCaption}
              onChange={(e) => setEditedCaption(e.target.value)}
              placeholder="Digite ou edite a legenda do carrossel..."
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', gap: '12px' }}>
              <button 
                type="button"
                className="btn btn-outline" 
                style={{ padding: '8px 16px' }} 
                onClick={() => {
                  navigator.clipboard.writeText(editedCaption);
                  showToast('Legenda copiada para a área de transferência!');
                }}
              >
                Copiar Texto
              </button>
              <button 
                type="button"
                className="btn btn-gold" 
                style={{ padding: '8px 20px', fontWeight: 'bold' }}
                onClick={handleSaveCaption}
                disabled={isSavingCaption}
              >
                {isSavingCaption ? '⏳ Salvando...' : '💾 Salvar Legenda'}
              </button>
              <button 
                type="button"
                className="btn btn-outline" 
                style={{ padding: '8px 16px', borderColor: 'rgba(255,255,255,0.2)' }} 
                onClick={() => setIsCaptionMaximized(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Publicação */}
      {confirmPublishCarousel && (
        <div className="form-modal open" style={{ zIndex: 12000 }}>
          <div 
            className="form-box" 
            style={{ 
              maxWidth: '520px', 
              width: '90%', 
              padding: '24px', 
              background: '#0c0d12', 
              border: '1px solid rgba(201, 168, 76, 0.4)', 
              borderRadius: '16px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.95), 0 0 30px rgba(201, 168, 76, 0.15)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 className="form-title" style={{ color: 'var(--gold, #c9a84c)', fontSize: '18px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                ✈️ Confirmar Publicação no Instagram
              </h3>
              <button 
                type="button" 
                onClick={() => setConfirmPublishCarousel(null)} 
                style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '14px', color: '#e4e4e7', margin: '0 0 16px 0', lineHeight: '1.5' }}>
              Tem certeza que deseja publicar o carrossel abaixo diretamente na sua conta do Instagram?
            </p>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Carrossel Selecionado</div>
              <div style={{ fontWeight: 'bold', color: '#ffffff', fontSize: '15px' }}>{confirmPublishCarousel.title}</div>
              <div style={{ fontSize: '12px', color: '#a1a1aa', marginTop: '6px' }}>
                📷 <strong>{confirmPublishCarousel.slides ? confirmPublishCarousel.slides.length : 0} slides</strong> salvos • ID: <code>{confirmPublishCarousel.id}</code>
              </div>
            </div>

            {/* Opções de Envio: Agora vs Agendado */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    border: !isScheduleMode ? '1px solid var(--gold, #c9a84c)' : '1px solid rgba(255,255,255,0.1)',
                    backgroundColor: !isScheduleMode ? 'rgba(201, 168, 76, 0.15)' : 'rgba(255,255,255,0.03)',
                    color: !isScheduleMode ? 'var(--gold, #c9a84c)' : '#a1a1aa'
                  }}
                  onClick={() => setIsScheduleMode(false)}
                >
                  🚀 Publicar Agora
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    border: isScheduleMode ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)',
                    backgroundColor: isScheduleMode ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                    color: isScheduleMode ? '#60a5fa' : '#a1a1aa'
                  }}
                  onClick={() => setIsScheduleMode(true)}
                >
                  📅 Agendar Publicação
                </button>
              </div>

              {isScheduleMode && (
                <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '10px', padding: '14px' }}>
                  <label style={{ display: 'block', fontSize: '12px', color: '#93c5fd', fontWeight: 'bold', marginBottom: '6px' }}>
                    Data e Hora do Disparo (Horário Local):
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: '#090a0f',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      color: '#ffffff',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  />
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px', lineHeight: '1.4' }}>
                    ℹ️ A Meta exige que postagens agendadas fiquem com no mínimo <strong>15 minutos</strong> de antecedência e no máximo <strong>75 dias</strong> no futuro.
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                type="button" 
                className="btn btn-outline" 
                style={{ padding: '8px 20px', fontSize: '13px', borderColor: 'rgba(255,255,255,0.2)', color: '#ffffff' }} 
                onClick={() => setConfirmPublishCarousel(null)}
              >
                Cancelar
              </button>
              <button 
                type="button" 
                className={isScheduleMode ? "btn btn-outline" : "btn btn-gold"} 
                style={{
                  padding: '8px 22px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  ...(isScheduleMode ? { borderColor: '#3b82f6', color: '#60a5fa', backgroundColor: 'rgba(59, 130, 246, 0.15)' } : {})
                }} 
                onClick={executePublish}
              >
                {isScheduleMode ? '📅 Agendar no Instagram' : '🚀 Confirmar e Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Resultado Explicito da Publicacao */}
      {publishResultModal && (
        <div className="form-modal open" style={{ zIndex: 12000 }}>
          <div 
            className="form-box" 
            style={{ 
              maxWidth: '680px', 
              width: '90%', 
              padding: '24px', 
              background: '#0c0d12', 
              border: publishResultModal.success ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(244, 63, 94, 0.4)', 
              borderRadius: '16px',
              boxShadow: publishResultModal.success 
                ? '0 20px 50px rgba(0, 0, 0, 0.95), 0 0 30px rgba(34, 197, 94, 0.15)'
                : '0 20px 50px rgba(0, 0, 0, 0.95), 0 0 30px rgba(244, 63, 94, 0.15)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 className="form-title" style={{ color: publishResultModal.success ? '#22c55e' : '#f43f5e', fontSize: '18px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {publishResultModal.success ? '🎉 Publicado com Sucesso!' : '⚠️ Erro na Publicação do Instagram'}
              </h3>
              <button 
                type="button" 
                onClick={() => setPublishResultModal(null)} 
                style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '18px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {publishResultModal.success ? (
              <>
                <p style={{ fontSize: '14px', color: '#e4e4e7', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                  O carrossel <strong>{publishResultModal.title}</strong> foi transmitido e publicado com sucesso no Instagram!
                </p>
                {publishResultModal.postId && (
                  <div style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#4ade80' }}>
                    ✅ <strong>ID da Mídia Gerada no Instagram:</strong> <code>{publishResultModal.postId}</code>
                  </div>
                )}
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: '#a1a1aa', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                  A tentativa de publicação do carrossel <strong>{publishResultModal.title}</strong> encontrou uma falha na comunicação com os servidores da Meta:
                </p>
                <pre 
                  className="custom-pipeline-scroll" 
                  style={{ 
                    margin: '0 0 20px 0', 
                    padding: '16px', 
                    fontSize: '12px', 
                    lineHeight: '1.6', 
                    fontFamily: 'Consolas, Monaco, monospace', 
                    whiteSpace: 'pre-wrap', 
                    color: '#f87171', 
                    backgroundColor: '#090a0f', 
                    border: '1px solid rgba(244, 63, 94, 0.2)',
                    borderRadius: '8px', 
                    maxHeight: '280px', 
                    overflowY: 'auto',
                    userSelect: 'text'
                  }}
                >
                  {publishResultModal.error || publishResultModal.log}
                </pre>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              {!publishResultModal.success && (
                <button 
                  type="button" 
                  className="btn btn-outline" 
                  style={{ 
                    padding: '8px 18px', 
                    fontSize: '13px', 
                    fontWeight: '600',
                    borderColor: copiedError ? '#22c55e' : 'var(--gold, #c9a84c)', 
                    color: copiedError ? '#22c55e' : 'var(--gold, #c9a84c)',
                    backgroundColor: copiedError ? 'rgba(34, 197, 94, 0.1)' : 'rgba(201, 168, 76, 0.1)'
                  }} 
                  onClick={() => {
                    navigator.clipboard.writeText(publishResultModal.error || publishResultModal.log);
                    setCopiedError(true);
                    showToast('✓ Erro completo copiado para a área de transferência!', 'success');
                    setTimeout(() => setCopiedError(false), 3000);
                  }}
                >
                  {copiedError ? '✓ Copiado!' : '📋 Copiar Erro Completo'}
                </button>
              )}
              <button 
                type="button" 
                className="btn btn-outline" 
                style={{ padding: '8px 20px', fontSize: '13px', borderColor: 'rgba(255,255,255,0.2)', color: '#ffffff' }} 
                onClick={() => setPublishResultModal(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
