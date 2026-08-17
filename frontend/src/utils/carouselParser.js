/**
 * Parses the raw AI generated text for a carousel into a structured payload.
 * Handles markdown formatting (###, **, 1., etc.) gracefully.
 * Used by the Criador component to send data to the backend generation pipeline.
 * 
 * @param {string} text Raw markdown/text from the AI
 * @param {object} fallbackData Fallback metadata if fields are missing
 * @returns {object} Parsed carousel payload
 */
export function parseCarouselText(text, fallbackData = null) {
  if (!text || typeof text !== 'string') {
    return {
      title: fallbackData?.title || 'Carrossel HauCacau',
      theme: fallbackData?.theme || 'novo-carrossel',
      format: fallbackData?.format || 'B',
      caption: fallbackData?.caption || '',
      notes: fallbackData?.notes || '',
      revisor_score: '',
      slides: [],
      totalSlides: 0,
      imageQuality: 'high',
      noImageSlidesCount: 0
    };
  }

  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const temaMatch = t.match(/TEMA:\s*(.+)/i);
  const pracaMatch = t.match(/PRA[ÇC]A:\s*(.+)/i);
  const bigIdea = t.match(/BIG IDEA:\s*(.+)/i);
  const revisorMatch = t.match(/TOTAL:\s*([\d]+\/15)/i);
  const captionMatch = t.match(/CAPTION[^:\n]*:\s*\n([\s\S]+?)(?=\n━|\nCTA TRIBAL|\nREVISÃO AUTÔNOMA|\n---|$)/i);
  const ctaMatch = t.match(/CTA TRIBAL:\s*"([^"\n]+)"/i);

  const slides = [];
  const lines = t.split('\n');

  // Regex flexível que aceita [S1 — DISRUPÇÃO | layout: dramatico] mesmo dentro de markdown (###, **, etc)
  const slideHeader = /(?:\[S(\d+)\s*[—–\-]?\s*([^\]|]*?)(?:\s*\|\s*layout:\s*([^\]\s|]+))?\s*\]|\*\*S(\d+)\s*[:—–\-]?\*\*|\bSLIDE\s*(\d+)\b|\bS(\d+)\s*[:—–\-]\s*)/i;

  let current = null;
  let field = null;

  const flush = () => {
    if (current && (current.title || current.body)) {
      slides.push({
        num: current.num,
        estado: current.estado,
        layout: current.layout,
        title: current.title.trim(),
        body: current.body.trim(),
        prompt: current.prompt.trim(),
      });
    }
  };

  for (const raw of lines) {
    let line = raw.trim();
    // Limpa prefixos de cabeçalho Markdown como ###, **, 1., -, * antes de testar o regex
    const cleanLine = line.replace(/^[\s#*>\-\d.]+(?=\[|\bS\d|\bSLIDE)/i, '').trim();
    const targetLine = cleanLine || line;

    const hm = targetLine.match(slideHeader);
    if (hm) {
      flush();
      const num = (hm[1] || hm[4] || hm[5] || hm[6] || '').padStart(2, '0');
      const estado = hm[2] ? hm[2].trim().replace(/[^\w\s]/g, '').trim().toUpperCase() : `SLIDE ${num}`;
      let layout = (hm[3] || 'fullbleed').trim().toLowerCase();
      layout = layout.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const validLayouts = ['fullbleed', 'dramatico', 'etereo', 'card', 'text_only'];
      if (!validLayouts.includes(layout)) {
        layout = 'fullbleed';
      }
      current = {
        num,
        estado,
        layout,
        title: '', body: '', prompt: '',
      };
      field = null;
      continue;
    }

    if (!current) continue;

    // Normaliza linhas que usam markdown como **TÍTULO:** ou **CORPO:**
    const strippedLine = line.replace(/^\*\*|\*\*$/g, '').trim();

    if (/^(?:\*\*|\*)?T[IÍ]TULO:?\*?\*?\s*/i.test(strippedLine)) {
      field = 'title';
      current.title = strippedLine.replace(/^(?:\*\*|\*)?T[IÍ]TULO:?\*?\*?\s*/i, '');
      continue;
    }
    if (/^(?:\*\*|\*)?CORPO:?\*?\*?\s*/i.test(strippedLine)) {
      field = 'body';
      current.body = strippedLine.replace(/^(?:\*\*|\*)?CORPO:?\*?\*?\s*/i, '');
      continue;
    }
    if (/^(?:\*\*|\*)?VISUAL:?\*?\*?\s*/i.test(strippedLine)) {
      field = 'prompt';
      current.prompt = strippedLine.replace(/^(?:\*\*|\*)?VISUAL:?\*?\*?\s*/i, '');
      continue;
    }
    if (strippedLine === '') {
      if (field === 'prompt') field = null;
      if (field === 'title') current.title += '\n';
      if (field === 'body') current.body += '\n';
      continue;
    }
    if (field === 'title') current.title += (current.title ? '\n' : '') + strippedLine;
    if (field === 'body') current.body += (current.body ? '\n' : '') + strippedLine;
    if (field === 'prompt') current.prompt += (current.prompt ? ' ' : '') + strippedLine;
  }
  flush();

  const finalTitle = temaMatch 
    ? temaMatch[1].trim().slice(0, 80) 
    : (fallbackData?.title || slides[0]?.title?.replace(/\n/g, ' ') || 'Carrossel HauCacau');

  let caption = (captionMatch?.[1] || '').trim();
  if (!caption) {
    if (bigIdea?.[1]) {
      caption = bigIdea[1].trim();
    } else if (slides.length > 0) {
      caption = slides.map(s => s.body).filter(Boolean).join('\n\n');
    }
  }

  const rawTheme = temaMatch
    ? temaMatch[1].trim()
    : (fallbackData?.theme || fallbackData?.title || finalTitle);

  const cleanTheme = rawTheme.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, '-').slice(0, 48);

  return {
    title: finalTitle,
    theme: cleanTheme || 'novo-carrossel',
    format: pracaMatch?.[1]?.trim().slice(0, 20) || (fallbackData?.format || 'B'),
    caption: caption || (fallbackData?.caption || ''),
    notes: ctaMatch?.[1]?.trim() || (fallbackData?.notes || ''),
    revisor_score: revisorMatch?.[1] || '',
    slides,
    totalSlides: slides.length || fallbackData?.totalSlides || 10,
    imageQuality: fallbackData?.imageQuality || 'high',
    noImageSlidesCount: slides.filter(s => s.layout === 'text_only').length,
  };
}
