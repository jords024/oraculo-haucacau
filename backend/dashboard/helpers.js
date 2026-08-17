import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { query } from "./db.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === "production";
const DATA_FILE = path.join(__dirname, "data", "carousels.json");

let b2 = null;
if (IS_PROD) {
  try {
    b2 = await import("./b2.js");
  } catch (e) {
    logger.error('[B2]', 'Erro ao carregar módulo B2 em helpers:', e);
  }
}

export function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function mapCarouselFromDb(row) {
  return {
    id: row.id,
    title: row.title,
    theme: row.theme,
    praca: row.praca,
    format: row.format,
    preset: row.preset,
    status: row.status,
    createdAt: row.created_at,
    slidesDir: row.slides_dir,
    slidePrefix: row.slide_prefix,
    totalSlides: row.total_slides,
    caption: row.caption,
    notes: row.notes,
    imageQuality: row.image_quality || 'high',
    b2BaseUrl: row.b2_base_url || '',
    imageProvider: row.image_provider || 'gpt-image-2',
    copyModel: row.copy_model || 'gpt-4o',
    noImageSlidesCount: row.no_image_slides_count || 0,
    lastPayload: row.last_payload || null,
    isPinned: row.is_pinned || false,
    pinnedAt: row.pinned_at || null,
    generationDuration: row.generation_duration || null,
    generationTimeSeconds: row.generation_time_seconds || null,
    scheduledAt: row.scheduled_at || null,
    scheduledTimestamp: row.scheduled_timestamp || null,
    slides: typeof row.slides === 'string' ? JSON.parse(row.slides) : (row.slides || []),
    chatHistory: typeof row.chat_history === 'string' ? JSON.parse(row.chat_history) : (row.chat_history || [])
  };
}
export async function readData() {
  try {
    const res = await query("SELECT * FROM carousels ORDER BY is_pinned DESC, pinned_at DESC, created_at DESC");
    return res.rows.map(mapCarouselFromDb);
  } catch (err) {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(raw);
      } catch (e) {}
    }
    return [];
  }
}

export async function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (fsErr) {
    logger.error('[Helpers]', 'Erro ao salvar backup local em carousels.json:', fsErr);
  }

  try {
    await query("BEGIN");
    const currentIds = data.map(c => c.id).filter(Boolean);
    if (currentIds.length > 0) {
      await query("DELETE FROM carousels WHERE id NOT IN (" + currentIds.map((_, i) => `$${i + 1}`).join(",") + ")", currentIds);
    } else {
      await query("DELETE FROM carousels");
    }

    for (const c of data) {
      const upsertQuery = `
        INSERT INTO carousels (
          id, title, theme, praca, format, preset, status, created_at,
          slides_dir, slide_prefix, total_slides, caption, notes, slides, chat_history, image_quality, b2_base_url, image_provider, copy_model, no_image_slides_count, last_payload, is_pinned, pinned_at, generation_duration, generation_time_seconds, scheduled_at, scheduled_timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          theme = EXCLUDED.theme,
          praca = EXCLUDED.praca,
          format = EXCLUDED.format,
          preset = EXCLUDED.preset,
          status = EXCLUDED.status,
          created_at = EXCLUDED.created_at,
          slides_dir = EXCLUDED.slides_dir,
          slide_prefix = EXCLUDED.slide_prefix,
          total_slides = EXCLUDED.total_slides,
          caption = EXCLUDED.caption,
          notes = EXCLUDED.notes,
          slides = EXCLUDED.slides,
          chat_history = EXCLUDED.chat_history,
          image_quality = EXCLUDED.image_quality,
          b2_base_url = EXCLUDED.b2_base_url,
          image_provider = EXCLUDED.image_provider,
          copy_model = EXCLUDED.copy_model,
          no_image_slides_count = EXCLUDED.no_image_slides_count,
          last_payload = EXCLUDED.last_payload,
          is_pinned = EXCLUDED.is_pinned,
          pinned_at = EXCLUDED.pinned_at,
          generation_duration = EXCLUDED.generation_duration,
          generation_time_seconds = EXCLUDED.generation_time_seconds,
          scheduled_at = EXCLUDED.scheduled_at,
          scheduled_timestamp = EXCLUDED.scheduled_timestamp
      `;
      const params = [
        c.id,
        c.title || '',
        c.theme || '',
        c.praca || '',
        c.format || '',
        c.preset || '',
        c.status || '',
        c.createdAt || '',
        c.slidesDir || '',
        c.slidePrefix || '',
        c.totalSlides || 0,
        c.caption || '',
        c.notes || '',
        JSON.stringify(c.slides || []),
        JSON.stringify(c.chatHistory || []),
        c.imageQuality || 'high',
        c.b2BaseUrl || '',
        c.imageProvider || 'gpt-image-2',
        c.copyModel || 'gpt-4o',
        c.noImageSlidesCount || 0,
        c.lastPayload ? JSON.stringify(c.lastPayload) : null,
        c.isPinned || false,
        c.pinnedAt || null,
        c.generationDuration || null,
        c.generationTimeSeconds || null,
        c.scheduledAt || null,
        c.scheduledTimestamp || null
      ];
      await query(upsertQuery, params);
    }
    await query("COMMIT");
  } catch (err) {
    try { await query("ROLLBACK"); } catch (e) {}
    logger.warn('[Helpers]', "Postgres indisponível. Operando normalmente com persistência local carousels.json.");
  }
}

export async function readDataAsync() {
  if (IS_PROD && b2) return b2.readDataFromB2();
  return readData();
}

export async function writeDataAsync(data) {
  if (IS_PROD && b2) {
    await b2.writeDataToB2(data);
    return;
  }
  await writeData(data);
}

export function getLocalSlidesDir(c) {
  if (!c.slidesDir) return "";
  
  let dir = c.slidesDir;
  
  // Se estamos dentro do contêiner Linux e a pasta começa com formato do Windows
  if (process.platform !== 'win32' && (dir.includes("Desktop") || dir.includes("Área de Trabalho") || /^[a-zA-Z]:/i.test(dir))) {
    const parts = dir.replace(/\\/g, '/').split('/');
    const folderName = parts[parts.length - 1];
    return path.join("/app/backend/storage/carousels", folderName);
  }
  
  // Se for Windows mas o usuário atual for diferente de julia
  if (process.platform === 'win32' && dir.includes("julia")) {
    const userProfile = process.env.USERPROFILE || 'C:/Users/julia';
    const onedrivePath = path.join(userProfile, 'OneDrive', 'Área de Trabalho');
    const normalDesktop = path.join(userProfile, 'Desktop');
    const hasOneDrive = fs.existsSync(onedrivePath);
    const targetDesktop = hasOneDrive ? onedrivePath : normalDesktop;
    
    const parts = dir.replace(/\\/g, '/').split('/');
    const folderName = parts[parts.length - 1];
    return path.join(targetDesktop, folderName);
  }

  if (c.slidesDir.startsWith("b2://")) {
    const baseDir = process.platform === 'win32' 
      ? (fs.existsSync(path.join(process.env.USERPROFILE || 'C:/Users/julia', 'OneDrive', 'Área de Trabalho')) 
          ? path.join(process.env.USERPROFILE || 'C:/Users/julia', 'OneDrive', 'Área de Trabalho') 
          : path.join(process.env.USERPROFILE || 'C:/Users/julia', 'Desktop'))
      : "/app/backend/storage/carousels";
    return path.join(baseDir, `carrossel-${c.theme}`);
  }
  return dir;
}

export function getSlidesFromDir(dir, prefix = "slide-") {
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter(f => f.startsWith(prefix) && /\.(jpg|jpeg|png)$/i.test(f))
      .sort()
      .map(f => ({ filename: f, path: path.join(dir, f) }));
  } catch {
    return [];
  }
}

export function getSlidesForCarousel(c) {
  if (c.slides && c.slides.length > 0) {
    return c.slides.map(s => typeof s === 'string' ? s : (s.filename || s.name));
  }
  return getSlidesFromDir(getLocalSlidesDir(c), c.slidePrefix).map(s => s.filename);
}

export function getCarouselCostDetails(c) {
  const slides = getSlidesForCarousel(c);
  const slidesDir = getLocalSlidesDir(c);
  const imageProvider = c.imageProvider || process.env.ACTIVE_IMAGE_PROVIDER || 'gpt-image-2';

  let costPerImage = 0.08;
  if (imageProvider === 'fal') costPerImage = 0.003;
  else if (imageProvider === 'gemini') costPerImage = 0.015;
  else if (imageProvider === 'gpt-image-1-mini' || imageProvider === 'dall-e-2') costPerImage = 0.02;

  let paidSlides = 0;
  let freeSlides = 0;

  if (slides.length > 0) {
    // Para carrosséis que possuem slides gerados/cadastrados
    for (let i = 0; i < slides.length; i++) {
      const numStr = String(i + 1).padStart(2, '0');
      let isTextOnly = false;
      if (slidesDir && fs.existsSync(slidesDir)) {
        const metaPath = path.join(slidesDir, `slide-${numStr}.meta.json`);
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.layout === 'text_only') isTextOnly = true;
          } catch (e) {}
        }
      }

      if (isTextOnly) {
        freeSlides++;
      } else {
        paidSlides++;
      }
    }
  } else if (slidesDir && fs.existsSync(slidesDir)) {
    // Se a pasta existe, verifica se há arquivos de imagem reais gerados no disco
    try {
      const files = fs.readdirSync(slidesDir);
      const rawFiles = files.filter(f => /^raw-.*\.jpg$/i.test(f));
      const slideFiles = files.filter(f => /^slide-.*\.jpg$/i.test(f));
      const totalCount = Math.max(rawFiles.length, slideFiles.length);

      for (let i = 1; i <= totalCount; i++) {
        const numStr = String(i).padStart(2, '0');
        const metaPath = path.join(slidesDir, `slide-${numStr}.meta.json`);
        let isTextOnly = false;
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.layout === 'text_only') isTextOnly = true;
          } catch (e) {}
        }

        if (isTextOnly) {
          freeSlides++;
        } else {
          paidSlides++;
        }
      }
    } catch (e) {}
  }
  // Se slides.length === 0 e nenhum arquivo existir, paidSlides e freeSlides permanecem 0!

  const cost = paidSlides * costPerImage;
  const savedCost = freeSlides * costPerImage;

  return {
    cost,
    costPerImage,
    paidSlides,
    freeSlides,
    totalSlidesCount: slides.length || (paidSlides + freeSlides),
    savedCost
  };
}

export async function readReelsHistory() {
  try {
    const res = await query("SELECT * FROM reels_history ORDER BY id DESC");
    return res.rows;
  } catch (err) {
    logger.error('[Helpers]',"Erro ao ler reels do banco:", err);
    return [];
  }
}

export async function writeReelsHistory(data) {
  try {
    await query("BEGIN");
    await query("DELETE FROM reels_history");
    for (const r of data) {
      const insQuery = `
        INSERT INTO reels_history (
          gancho_original, padrao_psicologico, roteiro_fonte_oculta,
          transcricao_original, url, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;
      const params = [
        r.gancho_original || '',
        r.padrao_psicologico || '',
        r.roteiro_fonte_oculta || '',
        r.transcricao_original || '',
        r.url || '',
        r.timestamp || ''
      ];
      await query(insQuery, params);
    }
    await query("COMMIT");
  } catch (err) {
    await query("ROLLBACK");
    logger.error('[Helpers]',"Erro ao salvar reels no banco:", err);
    throw err;
  }
}
