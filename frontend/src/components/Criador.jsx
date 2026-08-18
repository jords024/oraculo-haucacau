import React, { useState, useEffect, useRef } from 'react';
import { parseCarouselText } from '../utils/carouselParser';

const IDEAS_PROMPT = `Como Diretor de Conteúdo e Estrategista Autônomo da @haucacau.brasil, analise o perfil da nossa audiência e sugira 5 ideias de carrosséis de altíssima performance para o Instagram.

Nicho: Ritmo circadiano, ansiedade velada, cansaço crônico que o sono não cura, foco limpo sem aceleração, cacau ancestral, presença no corpo.
Estrutura: Método Jordânico — ganchos populares do cotidiano, quebra de crenças e validação biológica.

Para cada uma das 5 ideias, entregue:
• **Tema**: [slug-do-tema]
• **Gancho de Parada de Scroll (S1)**: [frase humana e provocativa]
• **Formato Recomendado & Por que vai performar**: [explicação estratégica de retenção]

Seja provocativo, simples e direto.`;

export default function Criador({ onStartGeneration, showToast, shouldAddFormMessage, clearAddFormMessage, initialMessages, clearInitialMessages, isReadOnly, isMockFlow }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('criador_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [generating, setGenerating] = useState(false);
  const [lastCarouselText, setLastCarouselText] = useState(sessionStorage.getItem('criadorLastCarousel') || null);
  const [currentCarouselId, setCurrentCarouselId] = useState(null);
  const [activeBriefing, setActiveBriefing] = useState(null);
  const msgsRef = useRef(null);
  const scrollAnchorRef = useRef(null);

  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [visualStyle, setVisualStyle] = useState(() => localStorage.getItem('haucacau_visual_style') || 'identidade_oficial');

  const handleStyleChange = (styleKey) => {
    setVisualStyle(styleKey);
    localStorage.setItem('haucacau_visual_style', styleKey);
    const labels = {
      identidade_oficial: '🌿 Identidade HauCacau (Oficial)',
      criativo_papel: '📜 Criativo (Papel & Símbolos)',
      dramatico: '🌑 Realista (35mm)'
    };
    if (showToast) showToast(`Estilo visual alterado para: ${labels[styleKey] || styleKey}`);
  };

  useEffect(() => {
    fetch('/api/settings/keys')
      .then(res => res.json())
      .then(data => {
        if (data && data.activeCopyModel) {
          setSelectedModel(data.activeCopyModel);
        }
      })
      .catch(() => {});
  }, []);

  const handleModelChange = async (newModel) => {
    setSelectedModel(newModel);
    try {
      await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ COPY_GENERATION_MODEL: newModel })
      });
      if (showToast) showToast(`✓ Modelo de copy salvo: ${newModel.toUpperCase()}`);
    } catch (e) {}
  };

  useEffect(() => {
    try {
      if (messages.length > 0) {
        localStorage.setItem('criador_chat_history', JSON.stringify(messages));
      }
    } catch (e) {}
  }, [messages]);

  const handleClearChat = () => {
    setMessages([]);
    localStorage.removeItem('criador_chat_history');
    sessionStorage.removeItem('criadorLastCarousel');
    setLastCarouselText(null);
    setCurrentCarouselId(null);
    if (showToast) showToast('Histórico do chat limpo!');
  };

  const scrollToBottom = () => {
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const setLastCarousel = (text) => {
    setLastCarouselText(text);
    sessionStorage.setItem('criadorLastCarousel', text);
  };

  const isCriarIntent = (text) => {
    if (!lastCarouselText) return false;
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const verbo = /\b(criar|cria|crie|gerar|gera|gere|bora|faz|faca|fazer|produz|monta|execute|executa|dispara|ativa|roda|vai|cria)\b/;
    if (!verbo.test(t)) return false;
    const novoConteudo = /\b(sobre|com a|relacionado|baseado|partindo|a partir|novo|nova|diferente|outra|outro|tema|ideia|versao|variacao|gancho|hook|roteiro|legenda|caption|copy|texto)\b/;
    if (novoConteudo.test(t)) return false;
    return t.trim().split(/\s+/).length <= 6;
  };

  const handleSend = async (textToSend = null) => {
    const text = (textToSend || input).trim();
    if (!text || generating) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    setGenerating(true);
    const aiMessageId = 'ai-' + Date.now();
    setMessages(prev => [...prev, { role: 'ai', content: '', id: aiMessageId, streaming: true }]);

    let fullText = '';
    let responseModel = selectedModel || 'gpt-4o';
    let costUsd = 0;
    try {
      const chatHistory = messages.filter(m => m.role !== 'form');
      const token = localStorage.getItem('fo_token') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/criador/stream', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          messages: [...chatHistory, { role: 'user', content: text }],
          totalSlides: activeBriefing?.totalSlides || 10,
          noImageSlidesCount: activeBriefing?.noImageSlidesCount || 0,
          model: selectedModel
        }),
      });

      if (!res.ok) {
        setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, content: '⚠ Erro de conexão com a IA.', streaming: false } : m));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data: ')) continue;
          try {
            const json = JSON.parse(t.slice(6));
            if (json.error) {
              setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, content: '⚠ Erro: ' + json.error, streaming: false } : m));
              return;
            }
            if (json.token) {
              fullText += json.token;
              setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, content: fullText } : m));
            }
            if (json.done) {
              if (json.model) responseModel = json.model;
              const totalWords = fullText.split(/\s+/).length + text.split(/\s+/).length;
              const approxTokens = totalWords * 1.33;
              costUsd = approxTokens * 0.00001; 

              setMessages(prev => prev.map(m => m.id === aiMessageId ? { 
                ...m, 
                streaming: false,
                timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' de ' + new Date().toLocaleDateString('pt-BR'),
                costUSD: costUsd,
                model: responseModel
              } : m));
            }
          } catch {}
        }
      }
      if (fullText.includes('[S1') || fullText.includes('DISRUPÇÃO')) {
        setLastCarousel(fullText);
        
        let targetId = currentCarouselId;
        if (!targetId) {
          try {
            const parsed = parseCarouselText(fullText);
            const res = await fetch('/api/carousels', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: parsed.title || 'Novo Carrossel',
                theme: parsed.theme || '',
                format: parsed.format || 'A',
                caption: parsed.caption || '',
                notes: parsed.notes || '',
                totalSlides: parsed.slides?.length || 10,
                status: 'rascunho',
                chatHistory: [
                  ...messages.map(m => ({ role: m.role, content: m.content })),
                  { role: 'user', content: text },
                  { role: 'ai', content: fullText }
                ]
              })
            });
            if (res.ok) {
              const data = await res.json();
              setCurrentCarouselId(data.id);
              targetId = data.id;
            }
          } catch (err) {
            console.error('Erro ao salvar rascunho inicial do carrossel:', err);
          }
        }
      }

      if (currentCarouselId) {
        const updatedMessages = [
          ...messages.map(m => ({
            role: m.role,
            content: m.content,
            model: m.model,
            costUSD: m.costUSD,
            timestamp: m.timestamp
          })),
          { role: 'user', content: text },
          { 
            role: 'ai', 
            content: fullText,
            model: responseModel,
            costUSD: costUsd,
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' de ' + new Date().toLocaleDateString('pt-BR')
          }
        ];
        try {
          await fetch(`/api/carousels/${currentCarouselId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatHistory: updatedMessages })
          });
        } catch (err) {
          console.error('Erro ao atualizar histórico subsequente no Postgres:', err);
        }
      }
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, content: '⚠ Erro de rede.', streaming: false } : m));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateDesignClick = (messageContent) => {
    // 1. Tenta extrair slides da mensagem atual
    let parsed = parseCarouselText(messageContent, activeBriefing);
    if (parsed && parsed.slides && parsed.slides.length > 0) {
      onStartGeneration(messageContent, currentCarouselId, { visualStyle });
      return;
    }

    // 2. Se a mensagem atual não tiver slides, busca nas mensagens anteriores (do final para o início)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'ai' && msg.content) {
        parsed = parseCarouselText(msg.content, activeBriefing);
        if (parsed && parsed.slides && parsed.slides.length > 0) {
          onStartGeneration(msg.content, currentCarouselId, { visualStyle });
          return;
        }
      }
    }

    // 3. Se nenhuma mensagem tiver slides, solicita que o Diretor de Arte estruture os slides S1 a S10 para geração
    if (showToast) showToast('✦ Acionando o Diretor de Arte para estruturar os slides e artes...');
    handleSend('Excelente! Como Diretor de Arte e Criativo da HauCacau, entregue agora o roteiro completo dos 10 slides (S1 até S10) com a partitura emocional e as tags [SX — ESTADO | layout: LAYOUT], TÍTULO:, CORPO: e VISUAL: de cada slide para iniciarmos a criação das artes imediatamente.');
  };

  useEffect(() => {
    if (shouldAddFormMessage) {
      setMessages([]);
      setCurrentCarouselId(null);
      clearAddFormMessage();
    }
  }, [shouldAddFormMessage]);

  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
      clearInitialMessages();
    }
  }, [initialMessages]);




  const handleSaveDraft = async (text) => {
    const temaMatch = text.match(/TEMA:\s*(.+)/i);
    const bigIdeaMatch = text.match(/BIG IDEA:\s*(.+)/i);
    const title = temaMatch
      ? temaMatch[1].trim().slice(0, 80)
      : text.slice(0, 60).replace(/\n/g, ' ') + '...';

    try {
      const res = await fetch('/api/carousels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          theme: temaMatch?.[1]?.trim() || '',
          notes: text,
          status: 'rascunho',
          caption: bigIdeaMatch?.[1]?.trim() || '',
          chatHistory: messages
        })
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentCarouselId(data.id);
        showToast('Rascunho salvo!');
      } else {
        showToast('Erro ao salvar rascunho.');
      }
    } catch (e) {
      showToast('Erro ao salvar rascunho.');
    }
  };

  return (
    <div className="main-view active" id="view-criador" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.2)', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* SELETOR DE PRESETS VISUAIS HAUCACAU */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255, 255, 255, 0.04)', padding: '3px 6px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, paddingLeft: '4px' }}>ESTILO VISUAL:</span>
            <button
              type="button"
              onClick={() => handleStyleChange('identidade_oficial')}
              style={{
                background: visualStyle === 'identidade_oficial' ? 'rgba(78, 184, 172, 0.25)' : 'transparent',
                border: visualStyle === 'identidade_oficial' ? '1px solid #4EB8AC' : '1px solid transparent',
                color: visualStyle === 'identidade_oficial' ? '#4EB8AC' : 'rgba(255, 255, 255, 0.6)',
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s ease'
              }}
            >
              <span>🌿</span> Identidade HauCacau (Oficial)
            </button>
            <button
              type="button"
              onClick={() => handleStyleChange('criativo_papel')}
              style={{
                background: visualStyle === 'criativo_papel' ? 'rgba(205, 145, 60, 0.25)' : 'transparent',
                border: visualStyle === 'criativo_papel' ? '1px solid #CD913C' : '1px solid transparent',
                color: visualStyle === 'criativo_papel' ? '#F6D59A' : 'rgba(255, 255, 255, 0.6)',
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s ease'
              }}
            >
              <span>📜</span> Criativo (Fora da Caixa)
            </button>
            <button
              type="button"
              onClick={() => handleStyleChange('dramatico')}
              style={{
                background: visualStyle === 'dramatico' ? 'rgba(240, 91, 0, 0.25)' : 'transparent',
                border: visualStyle === 'dramatico' ? '1px solid #F05B00' : '1px solid transparent',
                color: visualStyle === 'dramatico' ? '#FF8C42' : 'rgba(255, 255, 255, 0.6)',
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s ease'
              }}
            >
              <span>🌑</span> Realista (Chiaroscuro)
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, letterSpacing: '0.5px' }}>MODELO:</span>
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              style={{
                background: 'rgba(240, 91, 0, 0.12)',
                border: '1px solid rgba(240, 91, 0, 0.4)',
                color: 'var(--gold, #F05B00)',
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '6px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="gpt-5.4" style={{ background: '#1c1c1e', color: '#fff' }}>GPT-5.4 (Mais Avançado &amp; Raciocínio de Elite)</option>
              <option value="gpt-5" style={{ background: '#1c1c1e', color: '#fff' }}>GPT-5 (Criatividade &amp; Profundidade Máxima)</option>
              <option value="gpt-5-mini" style={{ background: '#1c1c1e', color: '#fff' }}>GPT-5-mini (Veloz &amp; Inteligente)</option>
              <option value="gpt-5.4-mini" style={{ background: '#1c1c1e', color: '#fff' }}>GPT-5.4-mini (Próxima Geração Compacto)</option>
              <option value="gpt-4o" style={{ background: '#1c1c1e', color: '#fff' }}>GPT-4o (Completo &amp; Criativo)</option>
              <option value="gpt-4o-mini" style={{ background: '#1c1c1e', color: '#fff' }}>GPT-4o-mini (Econômico &amp; Rápido)</option>
              <option value="o3-mini" style={{ background: '#1c1c1e', color: '#fff' }}>o3-mini (Alta Precisão)</option>
              <option value="o1" style={{ background: '#1c1c1e', color: '#fff' }}>o1 (Raciocínio Profundo)</option>
            </select>
            {messages.length > 0 && (
              <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.4)', marginLeft: '6px' }}>({messages.length} msgs)</span>
            )}
          </div>
        </div>
        {messages.length > 0 && (
          <button 
            onClick={handleClearChat}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '6px',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '11px',
              padding: '5px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ff4d4d'; e.currentTarget.style.color = '#ff4d4d'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'; e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'; }}
          >
            <span>🗑️</span> Novo Chat / Limpar
          </button>
        )}
      </div>
      <div className="criador-wrap" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="criador-msgs" ref={msgsRef} style={{ flex: 1, overflowY: 'auto', padding: '32px 24px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {messages.length === 0 ? (
            <div className="criador-welcome">
              <div className="criador-welcome-icon">{isMockFlow ? '⚡' : '✦'}</div>
              <div className="criador-welcome-title">{isMockFlow ? 'TESTE DE ESCALA (MOCK)' : 'CRIADOR'}</div>
              <div className="criador-welcome-sub">
                {isMockFlow 
                  ? 'Gere o roteiro do carrossel usando IA e crie o design de teste instantaneamente e sem custos.'
                  : 'Traga um tema e receba o carrossel completo de 10 slides. Método Jordânico · Voz Oculta · Humanizador.'
                }
              </div>
              <div className="criador-chips">
                <button className="criador-chip" onClick={() => handleSend('O sistema nervoso calibrado para escassez antes dos 7 anos')}>Sistema nervoso + escassez</button>
                <button className="criador-chip" onClick={() => handleSend('Por que pessoas inteligentes continuam quebradas')}>Inteligentes e quebradas</button>
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              if (m.role === 'form') {
                return (
                  <div key={idx} className="criador-msg criador-msg--ai" style={{ alignSelf: 'flex-start' }}>
                    <div className="criador-avatar">◈</div>
                    <div className="criador-bubble" style={{ width: '100%', maxWidth: '480px', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: '12px', padding: '18px 20px', display: 'block' }}>
                      <ChatFormMessage onSubmit={handleSendFormBriefing} showToast={showToast} generating={generating} onRequestIdeas={() => handleSend(IDEAS_PROMPT)} />
                    </div>
                  </div>
                );
              }
              return (
                <div key={idx} className={`criador-msg criador-msg--${m.role}`}>
                  <div className="criador-avatar">{m.role === 'user' ? '✦' : '◈'}</div>
                  <div className="criador-bubble">
                    {(() => {
                      if (typeof m.content !== 'string') return m.content;
                      if (m.role === 'user') {
                        const urlRegex = /(https?:\/\/[^\s]+)/g;
                        const parts = m.content.split(urlRegex);
                        return parts.map((part, i) => {
                          if (part.match(urlRegex)) {
                            return <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)', textDecoration: 'underline', wordBreak: 'break-all' }}>{part}</a>;
                          }
                          return part;
                        });
                      }

                      // Para a IA: renderiza linha por linha sem botões de ação
                      const lines = m.content.split('\n');
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {lines.map((line, lIdx) => (
                            <div key={lIdx} style={{ minHeight: '22px' }}>
                              <span>{line}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {m.streaming && <span className="criador-cursor"></span>}
                    {m.role === 'ai' && !m.streaming && (
                      <div style={{ marginTop: '8px', fontSize: '10.5px', color: 'rgba(237, 232, 223, 0.45)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>
                          {m.timestamp || (new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' de ' + new Date().toLocaleDateString('pt-BR'))}
                        </span>
                        {m.costUSD !== undefined && (
                          <span style={{ color: 'var(--gold)', fontWeight: '500' }}>
                            Modelo: {(m.model || 'gpt-4o').toUpperCase()} | Custo: ${m.costUSD.toFixed(4)} USD (~R$ {(m.costUSD * 5).toFixed(3)} BRL)
                          </span>
                        )}
                      </div>
                    )}
                    {m.role === 'ai' && !m.streaming && m.content && (
                      <div className="criador-msg-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button className="criador-action-btn" onClick={() => { navigator.clipboard.writeText(m.content); showToast('✓ Copiado para a área de transferência!'); }}>Copiar tudo</button>
                        {!isReadOnly && (
                          <button 
                            className="criador-action-btn criador-action-btn--create" 
                            style={isMockFlow ? { background: 'var(--gold)', color: '#000' } : {}}
                            onClick={() => handleCreateDesignClick(m.content)}
                          >
                            {isMockFlow ? '⚡ Criar design rápido (Mock)' : '✦ Criar design'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollAnchorRef} style={{ height: '1px', flexShrink: 0 }} />
        </div>

        <div className="criador-input-row" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <button
              onClick={() => handleSend(IDEAS_PROMPT)}
              disabled={generating}
              style={{
                background: 'rgba(201, 168, 76, 0.12)',
                border: '1px solid rgba(201, 168, 76, 0.35)',
                borderRadius: '16px',
                color: 'var(--gold)',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
              }}
              onMouseEnter={e => { if (!generating) e.currentTarget.style.background = 'rgba(201, 168, 76, 0.22)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(201, 168, 76, 0.12)'; }}
            >
              💡 Dar ideias de Tema/Título
            </button>
          </div>

          <div className="criador-input-wrap">
            <textarea
              className="criador-textarea"
              placeholder={generating ? "Aguardando resposta do agente..." : "Digite o tema do carrossel ou faça uma pergunta..."}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !generating && (e.preventDefault(), handleSend())}
              disabled={generating}
              style={{
                opacity: generating ? 0.6 : 1,
                cursor: generating ? 'not-allowed' : 'text'
              }}
            />
            <button 
              className="criador-send-btn" 
              onClick={() => !generating && handleSend()} 
              disabled={generating}
              style={{
                opacity: generating ? 0.5 : 1,
                cursor: generating ? 'not-allowed' : 'pointer'
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
          <div className="criador-info">gpt-5.4 · Método Jordânico · {generating ? 'gerando...' : 'pronto'}</div>
        </div>
      </div>
    </div>
  );
}


