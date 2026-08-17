import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { 
  slugify, 
  readData, 
  writeData, 
  readDataAsync, 
  writeDataAsync, 
  getLocalSlidesDir, 
  getSlidesForCarousel, 
  getSlidesFromDir,
  getCarouselCostDetails
} from "../helpers.js";
import { buildAgentPrompts } from "../agentPrompts.js";
import { enqueueCarouselTask } from "../services/rabbitmq.js";
import { 
  IS_PROD, 
  b2, 
  CLIENT, 
  generationJobs, 
  COMPOSE_SCRIPT, 
  REGEN_SCRIPT, 
  ZIP_SCRIPT,
  isUserSuperAdmin,
  sseClients
} from "../state.js";
import { logger } from '../logger.js';
import { query } from '../db.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.platform === "win32" ? "python" : "python3";

const router = express.Router();
const AGENT_SYSTEM_PROMPTS = buildAgentPrompts(CLIENT);

async function getAgentPromptAsync(agentId) {
  try {
    const dbRes = await query('SELECT content FROM agent_prompts WHERE id = $1', [agentId]);
    if (dbRes && dbRes.rows && dbRes.rows.length > 0 && dbRes.rows[0].content) {
      return dbRes.rows[0].content;
    }
  } catch (err) {
    logger.error('[Carousels]', `Erro ao buscar prompt '${agentId}' do BD: ${err.message}`);
  }

  const agentFilePath = path.join(__dirname, '..', '..', 'agents', `${agentId}.md`);
  if (fs.existsSync(agentFilePath)) {
    try {
      return fs.readFileSync(agentFilePath, 'utf-8');
    } catch (err) {
      logger.error('[Carousels]', `Erro ao ler arquivo de prompt ${agentFilePath}: ${err.message}`);
    }
  }

  return null;
}

// ── API: List all carousels ──────────────────────────────────────────────────
router.get("/api/carousels", async (req, res) => {
  const all = await readDataAsync();
  const carousels = all.map(c => {
    const slides = getSlidesForCarousel(c);
    const costDetails = getCarouselCostDetails(c);
    const activeJob = generationJobs.get(c.id);
    const generationStartedAt = activeJob?.startedAt || c.generationStartedAt || (c.status === 'generating' ? new Date(c.createdAt || Date.now()).getTime() : undefined);
    
    let generationDuration = c.generationDuration;
    let generationTimeSeconds = c.generationTimeSeconds;
    if (c.status !== 'generating') {
      if (!generationTimeSeconds && c.completedAt && (c.generationStartedAt || c.createdAt)) {
        const startMs = new Date(c.generationStartedAt || c.createdAt).getTime();
        const endMs = new Date(c.completedAt).getTime();
        if (startMs && endMs && endMs > startMs) {
          generationTimeSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));
        }
      }
      if (!generationDuration && generationTimeSeconds) {
        const mins = Math.floor(generationTimeSeconds / 60);
        const secs = generationTimeSeconds % 60;
        generationDuration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      }
    }
    
    return { 
      ...c, 
      slidesFound: slides.length, 
      slides, 
      cost: costDetails.cost, 
      costDetails, 
      generationStartedAt,
      generationDuration,
      generationTimeSeconds 
    };
  });
  res.json(carousels);
});

// ── API: Get single carousel ─────────────────────────────────────────────────
router.get("/api/carousels/:id", async (req, res) => {
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Carrossel não encontrado" });
  const slides = getSlidesForCarousel(c);
  const costDetails = getCarouselCostDetails(c);
  const activeJob = generationJobs.get(c.id);
  const generationStartedAt = activeJob?.startedAt || c.generationStartedAt || (c.status === 'generating' ? new Date(c.createdAt || Date.now()).getTime() : undefined);

  let generationDuration = c.generationDuration;
  let generationTimeSeconds = c.generationTimeSeconds;
  if (c.status !== 'generating') {
    if (!generationTimeSeconds && c.completedAt && (c.generationStartedAt || c.createdAt)) {
      const startMs = new Date(c.generationStartedAt || c.createdAt).getTime();
      const endMs = new Date(c.completedAt).getTime();
      if (startMs && endMs && endMs > startMs) {
        generationTimeSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));
      }
    }
    if (!generationDuration && generationTimeSeconds) {
      const mins = Math.floor(generationTimeSeconds / 60);
      const secs = generationTimeSeconds % 60;
      generationDuration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }
  }

  res.json({ 
    ...c, 
    slides, 
    cost: costDetails.cost, 
    costDetails, 
    generationStartedAt,
    generationDuration,
    generationTimeSeconds
  });
});

async function getAllAgentPrompts(client) {
  const AGENTS_DIR = path.join(__dirname, "..", "..", "agents");
  const NAMES_FILE = path.join(AGENTS_DIR, "display_names.json");
  let displayNames = {};
  try {
    if (fs.existsSync(NAMES_FILE)) {
      displayNames = JSON.parse(fs.readFileSync(NAMES_FILE, "utf-8"));
    }
  } catch {}

  let dbPromptsMap = {};
  try {
    const dbRes = await query('SELECT id, display_name, content FROM agent_prompts');
    if (dbRes && dbRes.rows) {
      for (const row of dbRes.rows) {
        dbPromptsMap[row.id] = {
          name: row.display_name,
          content: row.content
        };
      }
    }
  } catch {}

  const dynamicPrompts = buildAgentPrompts(client) || {};
  let list = [];

  try {
    if (fs.existsSync(AGENTS_DIR)) {
      const files = fs.readdirSync(AGENTS_DIR);
      list = files
        .filter(f => f.endsWith(".md"))
        .map(f => {
          const id = f.replace(".md", "");
          const fileContent = fs.readFileSync(path.join(AGENTS_DIR, f), "utf-8");
          const dbEntry = dbPromptsMap[id];
          let name = (dbEntry && dbEntry.name) || displayNames[id];
          if (!name) {
            name = id
              .split("-")
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ")
              .replace("Haucacau", "HauCacau")
              .replace("V2", "V2")
              .replace("Dna", "DNA")
              .replace("Cta", "CTA");
          }
          const content = (dbEntry && dbEntry.content) ? dbEntry.content : fileContent;
          return { id, name, content };
        });
    }
  } catch (e) {
    logger.error("[AgentPrompts]", "Erro ao ler pasta agents:", e.message);
  }

  for (const [key, text] of Object.entries(dynamicPrompts)) {
    if (!list.some(a => a.id === key)) {
      const formattedName = key
        .split("_")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      const dbEntry = dbPromptsMap[key];
      const content = (dbEntry && dbEntry.content) ? dbEntry.content : text;
      list.push({ id: key, name: formattedName, content });
    }
  }

  const map = Object.fromEntries(list.map(a => [a.id, a.content]));
  return { map, list };
}

// ── API: Get carousel pipeline details ───────────────────────────────────────
router.get("/api/carousels/:id/pipeline", async (req, res) => {
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Carrossel não encontrado" });

  const rawSlides = getSlidesForCarousel(c);
  const slidesDir = getLocalSlidesDir(c);
  const slides = rawSlides.map((s, idx) => {
    const filename = typeof s === 'string' ? s : (s.filename || s.name);
    const numStr = String(idx + 1).padStart(2, '0');
    let prompt = null;
    let layout = 'fullbleed';
    let title = '';
    
    if (slidesDir && fs.existsSync(slidesDir)) {
      const metaPath = path.join(slidesDir, `slide-${numStr}.meta.json`);
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          prompt = meta.prompt || meta.arte_prompt || null;
          layout = meta.layout || layout;
          title = meta.title || title;
        } catch (e) {}
      }
    }

    if (typeof s === 'object') {
      return {
        ...s,
        filename,
        num: s.num || idx + 1,
        prompt: s.prompt || prompt || (layout === 'text_only' ? '[ Slide de Fundo Preto / Sem Imagem ]' : null),
        layout: s.layout || layout,
        title: s.title || title
      };
    }
    return {
      filename,
      num: idx + 1,
      prompt: prompt || (layout === 'text_only' ? '[ Slide de Fundo Preto / Sem Imagem ]' : null),
      layout,
      title
    };
  });

  const costDetails = getCarouselCostDetails(c);
  const job = generationJobs.get(c.id);
  const { map: agentPromptsMap, list: agentPromptsList } = await getAllAgentPrompts(CLIENT);

  res.json({
    id: c.id,
    title: c.title,
    theme: c.theme || '',
    format: c.format || 'A',
    preset: c.preset || 'cinematografico',
    status: c.status,
    createdAt: c.createdAt,
    slidesDir: c.slidesDir,
    totalSlides: c.totalSlides || slides.length || 10,
    caption: c.caption || '',
    notes: c.notes || '',
    imageProvider: c.imageProvider || process.env.ACTIVE_IMAGE_PROVIDER || 'gpt-image-2',
    copyModel: c.copyModel || process.env.COPY_GENERATION_MODEL || 'gpt-4o',
    cost: c.cost || costDetails.cost || 0,
    costDetails,
    slides,
    slidesFound: slides.length,
    chatHistory: c.chatHistory || [],
    agentPrompts: agentPromptsMap,
    agentPromptsList,
    totalAgents: agentPromptsList.length,
    generationLogs: job ? job.logs : (c.generationLogs || c.logs || [
      'Iniciando pipeline de geração...',
      `Configuração: Formato ${c.format || 'A'}, Preset ${c.preset || 'cinematografico'}, Provedor: ${c.imageProvider || 'gpt-image-2'}`,
      `Processamento de ${slides.length || c.totalSlides || 10} slides concluído com status "${c.status}".`
    ]),
    pipelineData: {
      theme: c.theme || '',
      format: c.format || 'A',
      preset: c.preset || 'cinematografico',
      imageQuality: c.imageQuality || 'high',
      no_image_slides_count: c.no_image_slides_count || 0
    }
  });
});

// ── API: Create carousel ─────────────────────────────────────────────────────
router.post("/api/carousels", async (req, res) => {
  logger.info('[CarouselsAPI]', `CRIAR NOVO CARROSSEL (POST): ${JSON.stringify(req.body)}`);
  const all = await readDataAsync();
  let nextIdNum = all.length + 1;
  let newId = `carrossel-${String(nextIdNum).padStart(2, "0")}`;
  while (all.some(x => x.id === newId)) {
    nextIdNum++;
    newId = `carrossel-${String(nextIdNum).padStart(2, "0")}`;
  }

  const newCarousel = {
    id: newId,
    title: req.body.title || "Sem título",
    theme: req.body.theme || "",
    format: req.body.format || "A",
    status: "rascunho",
    createdAt: new Date().toISOString(),
    slidesDir: req.body.slidesDir || "",
    slidePrefix: "slide-",
    totalSlides: Number(req.body.totalSlides) || 10,
    imageQuality: req.body.imageQuality || "high",
    no_image_slides_count: Number(req.body.noImageSlidesCount || req.body.no_image_slides_count || 0),
    caption: req.body.caption || "",
    notes: req.body.notes || "",
    chatHistory: req.body.chatHistory || [],
  };
  all.push(newCarousel);
  await writeDataAsync(all);

  // Create folder if requested
  if (req.body.createFolder && req.body.slidesDir) {
    fs.mkdirSync(req.body.slidesDir, { recursive: true });
  }

  logger.info('[CarouselsAPI]', `CRIADO COM SUCESSO: ${newId} (${newCarousel.title})`);
  res.json(newCarousel);
});

// ── API: Update carousel status/fields ──────────────────────────────────────
router.put("/api/carousels/:id", async (req, res) => {
  logger.info('[CarouselsAPI]', `ATUALIZAR CARROSSEL (PUT ${req.params.id}): ${JSON.stringify(req.body)}`);
  const all = await readDataAsync();
  const idx = all.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Não encontrado" });
  all[idx] = { ...all[idx], ...req.body, id: all[idx].id };
  await writeDataAsync(all);
  logger.info('[CarouselsAPI]', `ATUALIZADO COM SUCESSO: ${req.params.id} (${all[idx].title})`);
  res.json(all[idx]);
});

// ── API: Pin / Unpin carousel (Max 10 pinned) ──────────────────────────────
router.post("/api/carousels/:id/pin", async (req, res) => {
  try {
    const { id } = req.params;
    const all = await readDataAsync();
    const carousel = all.find(x => x.id === id);

    if (!carousel) {
      return res.status(404).json({ error: "Carrossel não encontrado" });
    }

    let shouldPin;
    if (typeof req.body.isPinned !== 'undefined') {
      shouldPin = Boolean(req.body.isPinned);
    } else if (typeof req.body.is_pinned !== 'undefined') {
      shouldPin = Boolean(req.body.is_pinned);
    } else {
      shouldPin = !carousel.isPinned;
    }

    if (shouldPin) {
      const currentPinnedCount = all.filter(c => c.isPinned && c.id !== id).length;
      if (currentPinnedCount >= 10) {
        return res.status(400).json({ 
          error: "Limite de 10 carrosséis fixados atingido. Desfixe um carrossel antes de fixar outro." 
        });
      }
      carousel.isPinned = true;
      carousel.pinnedAt = new Date().toISOString();
    } else {
      carousel.isPinned = false;
      carousel.pinnedAt = null;
    }

    await writeDataAsync(all);
    logger.info('[CarouselsAPI]', `Carrossel ${id} ${shouldPin ? 'FIXADO' : 'DESFIXADO'}`);
    res.json({ ok: true, isPinned: carousel.isPinned, pinnedAt: carousel.pinnedAt, carousel });
  } catch (err) {
    logger.error('[CarouselsAPI]', 'Erro ao alternar pino do carrossel:', err);
    res.status(500).json({ error: "Erro interno do servidor ao fixar carrossel" });
  }
});

// ── API: Bulk Delete carousels ────────────────────────────────────────────────
router.post("/api/carousels/bulk-delete", async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: "Lista de ids inválida" });
  }

  let all = await readDataAsync();
  let deletedCount = 0;

  for (const id of ids) {
    const index = all.findIndex(x => x.id === id);
    if (index !== -1) {
      const c = all[index];
      try {
        const localDir = getLocalSlidesDir(c);
        if (localDir && fs.existsSync(localDir)) {
          fs.rmSync(localDir, { recursive: true, force: true });
        }
      } catch (e) {
        logger.error('[Carousel]', `Erro ao apagar pasta ${c.slidesDir}:`, e.message);
      }
      all.splice(index, 1);
      deletedCount++;
    }
  }

  await writeDataAsync(all);
  res.json({ ok: true, deletedCount, message: `${deletedCount} carrosséis apagados com sucesso` });
});

// ── API: Serve slide images ──────────────────────────────────────────────────
router.get("/api/carousels/:id/image/:filename", async (req, res) => {
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).send("Carrossel não encontrado");

  // Desabilitar cache se um parâmetro de versão (v ou t) for fornecido
  if (req.query.v || req.query.t) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  } else {
    res.setHeader("Cache-Control", "public, max-age=86400, must-revalidate");
  }

  // Se o carrossel foi de fato enviado ao MinIO (possui b2BaseUrl ou slides são objetos com url)
  const isUploadedToB2 = c.b2BaseUrl || (c.slides && c.slides.length > 0 && typeof c.slides[0] === 'object' && c.slides[0].url);

  if (isUploadedToB2 && b2) {
    // CORREÇÃO: Faz proxy da imagem internamente em vez de redirecionar o navegador
    // para a URL do MinIO, que pode ser interna do Docker e inacessível pelo cliente.
    try {
      const ext = path.extname(req.params.filename).toLowerCase();
      const contentType = ext === ".png" ? "image/png" : "image/jpeg";
      res.setHeader("Content-Type", contentType);

      const stream = await b2.getImageStream(req.params.id, req.params.filename);
      stream.pipe(res);
    } catch (e) {
      logger.error('[imagem]', `Erro ao fazer proxy da imagem do MinIO: ${e.message}`);
      // Fallback: tenta servir do disco local caso exista
      const imgPath = path.join(getLocalSlidesDir(c), req.params.filename);
      if (fs.existsSync(imgPath)) {
        return res.sendFile(imgPath);
      }
      return res.status(502).json({ error: "Imagem indisponível no armazenamento remoto." });
    }
    return;
  }

  // Local fallback: serve do disco
  const imgPath = path.join(getLocalSlidesDir(c), req.params.filename);
  if (!fs.existsSync(imgPath)) return res.status(404).send("Imagem não encontrada");
  res.sendFile(imgPath);
});

// ── API: Download single slide ───────────────────────────────────────────────
router.get("/api/carousels/:id/download/:filename", async (req, res) => {
  if (b2) {
    const url = b2.b2ImageUrl(req.params.id, req.params.filename);
    return res.redirect(302, url);
  }
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).send("Não encontrado");
  const imgPath = path.join(getLocalSlidesDir(c), req.params.filename);
  if (!fs.existsSync(imgPath)) return res.status(404).send("Imagem não encontrada");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.filename}"`);
  res.sendFile(imgPath);
});

// ── API: Read slide meta ─────────────────────────────────────────────────────
router.get("/api/carousels/:id/slide/:filename/meta", async (req, res) => {
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Não encontrado" });
  const metaPath = path.join(getLocalSlidesDir(c), req.params.filename.replace(/\.(jpg|jpeg|png)$/i, ".meta.json"));
  if (!fs.existsSync(metaPath)) return res.json({ title: "", body: "", layout: "fullbleed" });
  try {
    res.json(JSON.parse(fs.readFileSync(metaPath, "utf-8")));
  } catch {
    res.json({ title: "", body: "", layout: "fullbleed" });
  }
});

// ── API: Recompose slide ─────────────────────────────────────────────────────
router.post("/api/carousels/:id/slide/:filename/recompose", async (req, res) => {
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Não encontrado" });
  
  const imgPath = path.join(getLocalSlidesDir(c), req.params.filename);
  const rawFilename = req.params.filename.replace(/^slide-/, 'raw-');
  const rawPath = path.join(getLocalSlidesDir(c), rawFilename);

  // Se o MinIO/B2 estiver ativo e a imagem não estiver localmente, baixa do bucket
  if (!fs.existsSync(imgPath) && b2) {
    try {
      await b2.downloadImageFromB2(c.id, req.params.filename, imgPath);
      try {
        await b2.downloadImageFromB2(c.id, rawFilename, rawPath);
      } catch {}
    } catch (err) {
      logger.warn('[Carousel recompose]', `Falha ao baixar imagem do B2 para recompor localmente: ${err.message}`);
    }
  }

  if (!fs.existsSync(imgPath)) return res.status(404).json({ error: "Imagem não encontrada" });
  
  // Buscar a imagem limpa do Raw Cache se disponível
  const baseImgPath = fs.existsSync(rawPath) ? rawPath : imgPath;

  let { 
    title, 
    body, 
    layout = "fullbleed",
    title_y,
    body_y,
    watermark_pos = "top_left",
    watermark_x,
    watermark_y,
    watermark_text,
    title_px,
    body_px
  } = req.body;

  const validLayouts = ["fullbleed", "dramatico", "etereo", "card", "text_only"];
  if (!validLayouts.includes(String(layout).toLowerCase())) {
    layout = "fullbleed";
  }
  
  if (!title || !body) return res.status(400).json({ error: "title e body são obrigatórios" });
  
  const metaPath = imgPath.replace(/\.(jpg|jpeg|png)$/i, ".meta.json");
  let preset = "sagrado";
  if (fs.existsSync(metaPath)) {
    try {
      const slideMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      if (slideMeta.preset) {
        preset = slideMeta.preset;
      } else if (c.preset) {
        preset = c.preset;
      }
    } catch {}
  } else if (c.preset) {
    preset = c.preset;
  }

  if (preset === "manuscrito_sagrado" || preset === "escala" || !preset) {
    preset = "sagrado";
  }

  try {
    const pythonArgs = [
      COMPOSE_SCRIPT,
      "--image", baseImgPath, "--title", title, "--body", body,
      "--layout", layout, "--preset", preset, "--output", imgPath
    ];

    if (title_y !== undefined && title_y !== null && String(title_y).trim() !== "") {
      pythonArgs.push("--title_y", String(title_y));
    }
    if (body_y !== undefined && body_y !== null && String(body_y).trim() !== "") {
      pythonArgs.push("--body_y", String(body_y));
    }
    if (watermark_pos) {
      pythonArgs.push("--watermark_pos", watermark_pos);
    }
    if (watermark_x !== undefined && watermark_x !== null && String(watermark_x).trim() !== "") {
      pythonArgs.push("--watermark_x", String(watermark_x));
    }
    if (watermark_y !== undefined && watermark_y !== null && String(watermark_y).trim() !== "") {
      pythonArgs.push("--watermark_y", String(watermark_y));
    }
    if (watermark_text !== undefined && watermark_text !== null && String(watermark_text).trim() !== "") {
      pythonArgs.push("--watermark_text", String(watermark_text));
    }
    if (title_px !== undefined && title_px !== null && String(title_px).trim() !== "") {
      pythonArgs.push("--title_px", String(title_px));
    }
    if (body_px !== undefined && body_px !== null && String(body_px).trim() !== "") {
      pythonArgs.push("--body_px", String(body_px));
    }

    const { stdout } = await execFileAsync(PYTHON, pythonArgs, {
      timeout: 60000,
      cwd: path.join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PYTHONPATH: [
          path.join(__dirname, '..', '..'),
          path.join(__dirname, '..', '..', 'python_packages'),
        ].join(process.platform === 'win32' ? ';' : ':'),
      }
    });
    
    logger.info('[Carousel]', "recompose:", stdout.trim());
    fs.writeFileSync(metaPath, JSON.stringify({ 
      title, 
      body, 
      layout, 
      preset,
      title_y,
      body_y,
      watermark_pos,
      watermark_x,
      watermark_y,
      watermark_text,
      title_px,
      body_px
    }, null, 2));

    // Se o MinIO/B2 estiver ativo, envia de volta para o bucket
    if (b2) {
      try {
        await b2.uploadImageToB2(c.id, req.params.filename, imgPath);
        if (IS_PROD) {
          try { fs.unlinkSync(imgPath); } catch {}
          try { fs.unlinkSync(rawPath); } catch {}
        }
      } catch (uploadErr) {
        logger.error('[Carousel recompose upload]', `Erro ao reenviar slide atualizado para o B2: ${uploadErr.message}`);
      }
    }

    res.json({ ok: true, message: stdout.trim() });
  } catch (e) {
    logger.error('[Carousel]', "recompose error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: Excluir carrossel inteiro ─────────────────────────────────────────────
router.delete("/api/carousels/:id", async (req, res) => {
  let all = await readDataAsync();
  const index = all.findIndex(x => x.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Não encontrado" });
  
  const c = all[index];
  
  try {
    const localDir = getLocalSlidesDir(c);
    if (localDir && fs.existsSync(localDir)) {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  } catch (e) {
    logger.error('[Carousel]', `Erro ao apagar pasta ${c.slidesDir}:`, e.message);
  }

  all.splice(index, 1);
  await writeDataAsync(all);
  res.json({ ok: true, message: "Carrossel apagado com sucesso" });
});

// ── API: Excluir slide individual ─────────────────────────────────────────────
router.delete("/api/carousels/:id/slide/:filename", async (req, res) => {
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Carrossel não encontrado" });
  
  const imgPath = path.join(getLocalSlidesDir(c), req.params.filename);
  try {
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
      res.json({ ok: true, message: "Slide apagado com sucesso" });
    } else {
      res.status(404).json({ error: "Arquivo do slide não encontrado" });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Regenerate image ────────────────────────────────────────────────────
router.post("/api/carousels/:id/slide/:filename/regen", async (req, res) => {
  const all = await readDataAsync();
  const c = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Não encontrado" });
  const imgPath = path.join(getLocalSlidesDir(c), req.params.filename);
  const { prompt, title, body, layout = "fullbleed" } = req.body;
  if (!prompt || !title || !body) return res.status(400).json({ error: "prompt, title e body são obrigatórios" });
  const activeProvider = c.imageProvider || process.env.ACTIVE_IMAGE_PROVIDER || 'gpt-image-2';
  try {
    const { stdout } = await execFileAsync(PYTHON, [
      REGEN_SCRIPT,
      "--prompt", prompt, "--title", title, "--body", body,
      "--layout", layout, "--provider", activeProvider, "--output", imgPath
    ], {
      timeout: 180000,
      cwd: path.join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PYTHONPATH: [
          path.join(__dirname, '..', '..'),
          path.join(__dirname, '..', '..', 'python_packages'),
        ].join(process.platform === 'win32' ? ';' : ':'),
      }
    });
    logger.info('[Carousel]', "regen:", stdout.trim());
    
    // Salvar/atualizar o prompt e metadados no arquivo .meta.json
    const metaPath = imgPath.replace(/\.(jpg|jpeg|png)$/i, ".meta.json");
    let currentMeta = {};
    if (fs.existsSync(metaPath)) {
      try { currentMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch {}
    }
    fs.writeFileSync(metaPath, JSON.stringify({
      ...currentMeta,
      prompt,
      title,
      body,
      layout
    }, null, 2));

    res.json({ ok: true, message: stdout.trim() });
  } catch (e) {
    logger.error('[Carousel]', "regen error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: Download ZIP ────────────────────────────────────────────────────────
router.get("/api/carousels/:id/download-zip", async (req, res) => {
  const all = await readDataAsync();
  const c   = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Carrossel não encontrado" });

  const slides = getSlidesFromDir(getLocalSlidesDir(c), c.slidePrefix);
  if (slides.length === 0) return res.status(404).json({ error: "Nenhum slide encontrado na pasta" });

  const payload  = [{ ...c, slides: slides.map(s => s.filename) }];
  const safeName = c.id.replace(/[^a-z0-9-]/gi, "-");
  const tmpFile  = path.join(os.tmpdir(), `${safeName}-${Date.now()}.zip`);

  try {
    const { stdout } = await execFileAsync(PYTHON, [
      ZIP_SCRIPT,
      "--data",   JSON.stringify(payload),
      "--output", tmpFile,
    ], { timeout: 60000 });
    logger.info('[Carousel]', "zip-carousel:", stdout.trim());

    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);
    res.setHeader("Content-Type", "application/zip");
    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on("close", () => fs.unlink(tmpFile, () => {}));
  } catch (e) {
    logger.error('[Carousel]', "zip-carousel error:", e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── API: Download ZIP — TODOS ────────────────────────────────────────────────
router.get("/api/download-all", async (req, res) => {
  const all  = await readDataAsync();
  const payload = all.map(c => {
    const slides = getSlidesFromDir(getLocalSlidesDir(c), c.slidePrefix);
    return { ...c, slides: slides.map(s => s.filename) };
  }).filter(c => c.slides.length > 0);

  if (payload.length === 0) {
    return res.status(404).json({ error: "Nenhum slide encontrado em nenhum carrossel" });
  }

  const tmpFile = path.join(os.tmpdir(), `afonteoculta-todos-${Date.now()}.zip`);

  try {
    const { stdout } = await execFileAsync(PYTHON, [
      ZIP_SCRIPT,
      "--data",   JSON.stringify(payload),
      "--output", tmpFile,
    ], { timeout: 180000 });
    logger.info('[Carousel]', "download-all:", stdout.trim());

    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Disposition", `attachment; filename="afonteoculta-carrosseis-${date}.zip"`);
    res.setHeader("Content-Type", "application/zip");
    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on("close", () => fs.unlink(tmpFile, () => {}));
  } catch (e) {
    logger.error('[Carousel]', "download-all error:", e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── API: Publicar no Instagram ───────────────────────────────────────────────
const handlePublishInstagram = async (req, res) => {
  const all = await readDataAsync();
  const c   = all.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Carrossel não encontrado" });

  const PUBLISH_SCRIPT = path.join(__dirname, "..", "..", "infra", "social", "publish_instagram.py");
  const caption = req.body?.caption || c.caption || "";

  const args = [
    "-X", "utf8", PUBLISH_SCRIPT,
    "--id",      req.params.id,
  ];
  if (caption) {
    args.push("--caption", caption);
  }
  if (req.body?.stories) {
    args.push("--stories");
  }
  const sched = req.body?.scheduled_publish_time || req.body?.schedule;
  if (sched) {
    args.push("--schedule", String(sched));
    c.status = "agendado";
    c.scheduledTimestamp = parseInt(sched, 10);
    c.scheduledAt = new Date(parseInt(sched, 10) * 1000).toISOString();
    await writeDataAsync(all);
  }

  try {
    const { stdout, stderr } = await execFileAsync(PYTHON, args, { 
      timeout: 300000,
      cwd: path.join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PYTHONPATH: [
          path.join(__dirname, '..', '..'),
          path.join(__dirname, '..', '..', 'python_packages'),
        ].join(process.platform === 'win32' ? ';' : ':'),
      }
    });
    logger.info('[Carousel]', "publish-instagram:", stdout.trim());
    if (stderr) logger.warn('[Carousel]', "publish-instagram stderr:", stderr.trim());

    if (!sched) {
      c.status = "publicado";
      c.publishedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const allUpdated = await readDataAsync();
      const target = allUpdated.find(x => x.id === req.params.id);
      if (target) {
        target.status = "publicado";
        target.publishedAt = c.publishedAt;
        await writeDataAsync(allUpdated);
      }
    }

    const updated = (await readDataAsync()).find(x => x.id === req.params.id);
    res.json({ ok: true, log: stdout, carousel: updated });
  } catch (e) {
    const stdoutStr = e.stdout || "";
    const stderrStr = e.stderr || "";
    const wasPublished = stdoutStr.includes("PUBLICADO COM SUCESSO") || stdoutStr.includes("AGENDADO COM SUCESSO");

    logger.error('[Carousel]', "publish-instagram error:", e.message);
    if (stderrStr) logger.error('[Carousel]', "publish-instagram stderr:", stderrStr.trim());

    // Mesmo com exit code != 0, se o post foi confirmado como publicado no stdout,
    // tratamos como sucesso e atualizamos o status no banco via Node.js
    if (wasPublished) {
      logger.info('[Carousel]', "Publicação confirmada no stdout apesar de exit code != 0. Atualizando status...");
      try {
        if (!sched) {
          c.status = "publicado";
          c.publishedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
          const allUpdated = await readDataAsync();
          const target = allUpdated.find(x => x.id === req.params.id);
          if (target) {
            target.status = "publicado";
            target.publishedAt = c.publishedAt;
            await writeDataAsync(allUpdated);
          }
        }
        const updated = (await readDataAsync()).find(x => x.id === req.params.id);
        return res.json({ ok: true, log: stdoutStr, carousel: updated });
      } catch (updateErr) {
        logger.error('[Carousel]', "Erro ao atualizar status após publicação confirmada:", updateErr.message);
      }
    }

    const errOutput = stdoutStr + " " + stderrStr + " " + e.message;
    res.status(500).json({ error: errOutput.trim() || e.message, log: stdoutStr });
  }
};

router.post("/api/carousels/:id/publish-instagram", handlePublishInstagram);
router.post("/api/carousels/:id/publish", handlePublishInstagram);

// ── API: Criador — Capacidades do ambiente ────────────────────────────────────
router.get('/api/criador/capabilities', (req, res) => {
  res.json({ canGenerateImages: true, isProd: IS_PROD });
});

function parseCarouselTextNode(text) {
  if (!text || typeof text !== 'string') return [];
  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const slides = [];
  const lines = t.split('\n');
  const slideHeader = /^(?:\[S(\d+)\s*[—–\-]?\s*([^\]|]*?)(?:\s*\|\s*layout:\s*([^\]\s|]+))?\s*\]|SLIDE\s*(\d+)\b)/i;
  let current = null;
  let field = null;

  const flush = () => {
    if (current && (current.title || current.body)) {
      slides.push({
        num: current.num,
        estado: current.estado || `S${current.num}`,
        layout: current.layout || 'fullbleed',
        title: (current.title || '').trim(),
        body: (current.body || '').trim(),
        prompt: (current.prompt || '').trim(),
      });
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const hm = line.match(slideHeader);
    if (hm) {
      flush();
      const num = (hm[1] || hm[4] || '').padStart(2, '0');
      const estado = hm[2] ? hm[2].trim().replace(/[^\w\s]/g, '').trim().toUpperCase() : `S${num}`;
      let layout = (hm[3] || 'fullbleed').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      current = { num, estado, layout, title: '', body: '', prompt: '' };
      field = null;
      continue;
    }

    if (!current) continue;

    const lower = line.toLowerCase();
    if (lower.startsWith('título:') || lower.startsWith('titulo:') || lower.startsWith('gancho:')) {
      field = 'title';
      current.title = line.replace(/^(título|titulo|gancho):\s*/i, '');
    } else if (lower.startsWith('corpo:') || lower.startsWith('texto:')) {
      field = 'body';
      current.body = line.replace(/^(corpo|texto):\s*/i, '');
    } else if (lower.startsWith('prompt:') || lower.startsWith('prompt visual:')) {
      field = 'prompt';
      current.prompt = line.replace(/^prompt(\s*visual)?:\s*/i, '');
    } else if (field && line) {
      current[field] += '\n' + line;
    }
  }
  flush();
  return slides;
}

// ── API: Retry carousel generation ──────────────────────────────────────────
router.post('/api/carousels/:id/retry', async (req, res) => {
  const { id } = req.params;
  const all = await readDataAsync();
  const carousel = all.find(c => c.id === id);

  if (!carousel) {
    return res.status(404).json({ error: 'Carrossel não encontrado' });
  }

  let payload = carousel.lastPayload;

  // Fallback: se não houver lastPayload ou lastPayload.slides estiver vazio, tenta extrair das notas ou do histórico de chat
  if (!payload || !Array.isArray(payload.slides) || payload.slides.length === 0) {
    let textToParse = carousel.notes || '';
    if (!textToParse && carousel.chatHistory && Array.isArray(carousel.chatHistory)) {
      const lastAiMsg = [...carousel.chatHistory].reverse().find(m => m.role === 'ai' && m.content && m.content.includes('[S1'));
      if (lastAiMsg) textToParse = lastAiMsg.content;
    }

    const extractedSlides = parseCarouselTextNode(textToParse);
    if (extractedSlides.length > 0) {
      payload = {
        id: carousel.id,
        title: carousel.title,
        theme: carousel.theme,
        format: carousel.format || 'A',
        totalSlides: extractedSlides.length,
        slides: extractedSlides,
        caption: carousel.caption || ''
      };
    }
  }

  if (!payload || !Array.isArray(payload.slides) || payload.slides.length === 0) {
    return res.status(400).json({ error: 'Não há roteiro de slides salvo para recriar este carrossel. Por favor, gere o roteiro no Criador.' });
  }

  const retryPayload = { ...payload, id };
  const newStartTime = Date.now();
  const newCarousel = {
    ...carousel,
    id:          id,
    title:       payload.title || carousel?.title || 'Carrossel',
    theme:       payload.theme || carousel?.theme || 'sem-titulo',
    format:      payload.format || carousel?.format || 'B',
    status:      'queued',
    generationStartedAt: newStartTime,
    generationDuration: undefined,
    generationTimeSeconds: undefined,
    completedAt: undefined,
    createdAt:   carousel?.createdAt || new Date().toISOString(),
    slidesDir:   carousel?.slidesDir || '',
    slidePrefix: 'slide-',
    totalSlides: Number(payload.totalSlides) || payload.slides?.length || 10,
    imageQuality: payload.imageQuality || carousel?.imageQuality || 'high',
    caption:     payload.caption || carousel?.caption || '',
    notes:       payload.notes || carousel?.notes || '',
    chatHistory: carousel?.chatHistory || [],
    slides:      [],
    noImageSlidesCount: payload.noImageSlidesCount || carousel?.noImageSlidesCount || 0,
    imageProvider: process.env.ACTIVE_IMAGE_PROVIDER || carousel?.imageProvider || 'gpt-image-2',
    copyModel:     process.env.COPY_GENERATION_MODEL || carousel?.copyModel || 'gpt-4o',
    lastPayload: { ...payload, slidesDir: undefined }
  };
  
  const allCarousels = await readDataAsync();
  const idx = allCarousels.findIndex(c => c.id === id);
  if (idx >= 0) {
    allCarousels[idx] = newCarousel;
    await writeDataAsync(allCarousels);
  }

  logger.info('[Retry]', `Retentativa de geração para carrossel ${id}`);

  const taskPayload = {
    carouselId: id,
    payload: { ...payload, slidesDir: '' },
    noImageSlidesCount: newCarousel.noImageSlidesCount,
    startTime: newStartTime
  };

  const queueResult = await enqueueCarouselTask(taskPayload);

  res.json({
    ok: true,
    id: id,
    status: 'queued',
    queuePosition: queueResult.queuePosition || 1,
    message: 'Carrossel enfileirado no RabbitMQ com sucesso'
  });
});

// ── API: Criador — Gerar carrossel completo ───────────────────────────────────
router.post('/api/criador/generate', async (req, res) => {
  const payload = req.body;
  if (!payload || !Array.isArray(payload.slides) || payload.slides.length === 0) {
    return res.status(400).json({ error: 'slides é obrigatório' });
  }

  let allCarousels = [];
  try {
    allCarousels = await readDataAsync();
  } catch (err) {
    logger.error('[Carousel]', "Erro ao ler carrosséis para determinar ID:", err);
  }

  let newId = payload.id;
  let existingCarousel = null;
  if (newId) {
    existingCarousel = allCarousels.find(c => c.id === newId);
  }

  if (!existingCarousel) {
    const nums = allCarousels.map(c => parseInt(c.id?.split('-').pop()) || 0).filter(Boolean);
    const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
    newId = `carrossel-${String(nextNum).padStart(2, '0')}`;
  }

  const slug = payload.title ? slugify(payload.title) : 'sem-titulo';
  let outDir;
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || 'C:/Users/julia';
    const onedrivePath = path.join(userProfile, 'OneDrive', 'Área de Trabalho');
    const hasOneDrive = fs.existsSync(onedrivePath);
    outDir = hasOneDrive
      ? path.join(onedrivePath, `${newId}-${slug}`).replace(/\\/g, '/')
      : path.join(userProfile, 'Desktop', `${newId}-${slug}`).replace(/\\/g, '/');
  } else {
    outDir = `/app/backend/storage/carousels/${newId}-${slug}`;
  }

  const noImageSlidesCount = payload.noImageSlidesCount !== undefined ? Number(payload.noImageSlidesCount) : (existingCarousel?.noImageSlidesCount || 0);

  const newCarousel = {
    id:          newId,
    title:       payload.title || existingCarousel?.title || 'Carrossel',
    theme:       payload.theme || existingCarousel?.theme || slug,
    format:      payload.format || existingCarousel?.format || 'B',
    status:      'queued',
    createdAt:   existingCarousel?.createdAt || new Date().toISOString(),
    slidesDir:   outDir,
    slidePrefix: 'slide-',
    totalSlides: Number(payload.totalSlides) || payload.slides.length || 10,
    imageQuality: payload.imageQuality || existingCarousel?.imageQuality || 'high',
    caption:     payload.caption || existingCarousel?.caption || '',
    notes:       payload.notes || existingCarousel?.notes || '',
    chatHistory: existingCarousel?.chatHistory || [],
    slides:      existingCarousel?.slides || [],
    noImageSlidesCount: noImageSlidesCount,
    imageProvider: process.env.ACTIVE_IMAGE_PROVIDER || existingCarousel?.imageProvider || 'gpt-image-2',
    copyModel:     process.env.COPY_GENERATION_MODEL || existingCarousel?.copyModel || 'gpt-4o',
    lastPayload: { ...payload, slidesDir: undefined }
  };

  if (existingCarousel) {
    const idx = allCarousels.findIndex(c => c.id === newId);
    allCarousels[idx] = newCarousel;
  } else {
    allCarousels.push(newCarousel);
  }
  await writeDataAsync(allCarousels);

  const taskPayload = {
    carouselId: newId,
    payload: { ...payload, slidesDir: newCarousel.slidesDir },
    noImageSlidesCount,
    startTime: Date.now()
  };

  const queueResult = await enqueueCarouselTask(taskPayload);

  res.json({
    ok: true,
    id: newId,
    status: 'queued',
    queuePosition: queueResult.queuePosition || 1,
    message: 'Carrossel enfileirado no RabbitMQ com sucesso'
  });
});

// ── API: Obter histórico de criação em tempo real ────────────────────────────
router.get('/api/carousels/:id/history', (req, res) => {
  const { id } = req.params;
  const job = generationJobs.get(id);
  if (!job) {
    return res.json({
      id,
      status: 'done',
      logs: ['Histórico de log em tempo real indisponível para este carrossel.'],
      slides: []
    });
  }
  res.json(job);
});

router.get('/api/debug-jobs', (req, res) => {
  res.json(Array.from(generationJobs.entries()));
});

// ── API: Criador — Chat unificado com streaming SSE ──────────────────────────
router.post('/api/criador/stream', async (req, res) => {
  const { messages, totalSlides, noImageSlidesCount } = req.body;
  let system = await getAgentPromptAsync('criador');
  if (!system) return res.status(500).json({ error: 'Agente criador não configurado' });

  // Injeta dinamicamente a quantidade de slides configurada no formulário dentro do System Prompt
  const numSlides = Number(totalSlides) || 10;
  if (numSlides !== 10) {
    system = system
      .replace(/completo de 10 slides/g, `completo de ${numSlides} slides`)
      .replace(/ESTRUTURA DOS 10 SLIDES/g, `ESTRUTURA DOS ${numSlides} SLIDES`)
      .replace(/10 ESTADOS:/g, `${numSlides} ESTADOS:`)
      .replace(/S10/g, `S${numSlides}`)
      .replace(/S9/g, `S${numSlides - 1}`)
      .replace(/S8/g, `S${numSlides - 2}`)
      .replace(/S10 \[CTA FIXO\]/g, `S${numSlides} [CTA FIXO]`)
      .replace(/S9 \[SETUP CTA\]/g, `S${numSlides - 1} [SETUP CTA]`)
      .replace(/S8 \[CRISTALIZAÇÃO\]/g, `S${numSlides - 2} [CRISTALIZAÇÃO]`);
    
    // Adiciona uma instrução clara no topo do system prompt instruindo a IA sobre a restrição de tamanho
    system = `IMPORTANTE: Para esta geração, o usuário configurou e deseja estritamente um carrossel de exatamente ${numSlides} slides. Adapte o Método Jordânico de Curva Dramática e sintetize as etapas para caberem exatamente em ${numSlides} slides (S1 até S${numSlides}), garantindo que o slide final S${numSlides} seja o CTA FIXO.\n\n` + system;
  }

  // Injeta automaticamente a regra innegociável de formato para garangir a estrutura de TÍTULO, CORPO e VISUAL
  const mandatoryFormatInstruction = `\n\n⚠️ REGRA INNEGOCIÁVEL DE FORMATO DE SAÍDA DE SLIDES (APLICAR SEMPRE QUE GERAR ROTEIRO DE SLIDES):
Ao gerar o roteiro final de slides, cada slide DEVE ser obrigatoriamente estruturado usando a tag exata (substituindo LAYOUT pelo tipo exato: fullbleed, dramatico, etereo, card ou text_only):
[SX — ESTADO | layout: LAYOUT]
TÍTULO: [conteúdo do título do slide]
CORPO: [conteúdo do texto/copy do slide]
VISUAL: [descrição da imagem visual do slide]

Jamais entregue os slides apenas como texto corrido ou apenas **SX:** sem as chaves TÍTULO:, CORPO: e VISUAL:.\n\n`;

  system = system + mandatoryFormatInstruction;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages é obrigatório' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ error: 'OPENAI_API_KEY não configurada' })}\n\n`);
    return res.end();
  }

  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  let rawModel = (req.body.model || process.env.COPY_GENERATION_MODEL || 'gpt-4o').trim();
  let OPENAI_MODEL = rawModel;
  
  const modelMap = {
    'gpt-5.4': 'gpt-5.4',
    'gpt-5': 'gpt-5',
    'gpt-5-mini': 'gpt-5-mini',
    'gpt-5.4-mini': 'gpt-5.4-mini',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'o1-mini': 'o1-mini',
    'o3-mini': 'o3-mini',
    'o1': 'o1'
  };
  if (modelMap[rawModel.toLowerCase()]) {
    OPENAI_MODEL = modelMap[rawModel.toLowerCase()];
  }

  try {
    const formattedMessages = messages.map(msg => ({
      role: msg.role === 'ai' ? 'assistant' : msg.role,
      content: msg.content || ''
    }));

    let response;
    try {
      const payload = {
        model: OPENAI_MODEL,
        messages: [{ role: 'system', content: system }, ...formattedMessages],
        max_completion_tokens: 4000,
        stream: true,
      };

      // Modelos o1, o3, gpt-5 não suportam alteração de temperatura na API da OpenAI (apenas default 1)
      const isReasoningModel = OPENAI_MODEL.includes('o1') || OPENAI_MODEL.includes('o3') || OPENAI_MODEL.includes('gpt-5') || OPENAI_MODEL.includes('5');
      if (!isReasoningModel) {
        payload.temperature = 0.88;
      }

      response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Se a OpenAI retornar HTTP 400 por parâmetro de temperatura, tenta novamente sem a temperatura
      if (!response.ok && response.status === 400 && payload.temperature) {
        delete payload.temperature;
        response = await fetch(OPENAI_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    } catch (fetchErr) {
      // Erro de rede (DNS, conexão recusada, timeout, etc.)
      const cause = fetchErr.cause?.message || fetchErr.cause?.code || '';
      const detail = cause ? ` (causa: ${cause})` : '';
      logger.error('[Carousel]', `criador/stream — falha de rede ao conectar com a OpenAI${detail}. URL: ${OPENAI_URL}. Erro: ${fetchErr.message}. Stack: ${fetchErr.stack}`);
      const userMsg = `Erro de conexão com a OpenAI: não foi possível alcançar ${OPENAI_URL}.${detail} Verifique a conexão de rede do servidor ou se a API da OpenAI está fora do ar.`;
      res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
      return res.end();
    }

    if (!response.ok) {
      let errText = `HTTP ${response.status}`;
      let rawBody = '';
      try {
        const j = await response.json();
        rawBody = JSON.stringify(j);
        errText = j.error?.message || errText;
      } catch {}

      logger.error('[Carousel]', `criador/stream — OpenAI retornou erro HTTP ${response.status}. Modelo: ${OPENAI_MODEL}. Corpo: ${rawBody}`);

      if (response.status === 401) {
        errText = 'A OPENAI_API_KEY configurada é inválida ou expirou. Verifique a chave no arquivo .env do servidor.';
      } else if (response.status === 403) {
        errText = 'Acesso negado pela OpenAI (403). A chave pode não ter permissão para usar o modelo ' + OPENAI_MODEL + '.';
      } else if (response.status === 404) {
        errText = `Modelo "${OPENAI_MODEL}" não encontrado na OpenAI (404). Verifique se o nome do modelo está correto ou se sua conta tem acesso a ele.`;
      } else if (errText.includes('quota') || errText.includes('billing') || response.status === 429) {
        errText = 'Você excedeu sua cota atual na OpenAI ou atingiu o limite de requisições. Adicione créditos em: https://platform.openai.com/settings/organization/billing/overview';
      } else if (response.status >= 500) {
        errText = `A OpenAI retornou um erro interno (${response.status}). Tente novamente em alguns instantes.`;
      }

      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === 'data: [DONE]') continue;
        if (t.startsWith('data: ')) {
          try {
            const json = JSON.parse(t.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
          } catch {}
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, model: OPENAI_MODEL })}\n\n`);
    res.end();
  } catch (e) {
    const cause = e.cause?.message || e.cause?.code || '';
    logger.error('[Carousel]', `criador/stream — erro inesperado: ${e.message}${cause ? ' | causa: ' + cause : ''}. Stack: ${e.stack}`);
    const userMsg = `Erro inesperado ao processar resposta da IA: ${e.message}${cause ? ' (' + cause + ')' : ''}`;
    if (!res.headersSent) res.status(500).json({ error: userMsg });
    else { res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`); res.end(); }
  }
});

router.post("/api/escala/criar-mock", async (req, res) => {
  if (!req.user || !isUserSuperAdmin(req.user.email)) {
    return res.status(403).json({ error: "Acesso negado. Apenas super admins podem usar o teste de escala." });
  }

  const payload = req.body;
  if (!payload || !Array.isArray(payload.slides) || payload.slides.length === 0) {
    return res.status(400).json({ error: "slides é obrigatório" });
  }

  let allCarousels = [];
  try {
    allCarousels = await readDataAsync();
  } catch (err) {
    logger.error('[Carousel]', "Erro ao ler carrosséis para determinar ID:", err);
  }

  // Se o carrossel do rascunho com o ID anterior já existe, atualizamos ele em vez de duplicar
  const targetId = payload.id;
  let existingIndex = -1;
  if (targetId) {
    existingIndex = allCarousels.findIndex(c => c.id === targetId);
  }

  const finalId = existingIndex >= 0 ? targetId : (() => {
    const nums = allCarousels.map(c => parseInt(c.id?.split('-').pop()) || 0).filter(Boolean);
    const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
    return `carrossel-${String(nextNum).padStart(2, '0')}`;
  })();

  const slug = payload.title ? slugify(payload.title) : 'sem-titulo';
  const outDir = path.join(__dirname, '..', '..', 'storage', `carrossel-${slug}`);

  const slidesData = payload.slides.map((s, idx) => ({
    num: idx + 1,
    title_text: s.title || s.title_text || `Slide ${idx + 1}`,
    text: s.body || s.text || ""
  }));

  const estimatedCost = slidesData.length * 0.08;
  const baseCarousel = existingIndex >= 0 ? allCarousels[existingIndex] : {};

  // Formata os slides em markdown legível para o campo notes
  const notesContent = slidesData.map(s => `[Slide ${s.num}]\nTítulo: ${s.title_text}\nCorpo: ${s.text}`).join('\n\n');

  const updatedCarousel = {
    ...baseCarousel,
    id:          finalId,
    title:       payload.title || baseCarousel.title || 'Carrossel em Escala',
    theme:       payload.title || baseCarousel.theme || 'Geração Automática',
    format:      payload.format || baseCarousel.format || 'B',
    status:      'generating',
    preset:      'escala',
    cost:        estimatedCost,
    createdAt:   baseCarousel.createdAt || new Date().toISOString(),
    slidesDir:   outDir.replace(/\\/g, '/'),
    slidePrefix: 'slide-',
    totalSlides: payload.totalSlides || slidesData.length || baseCarousel.totalSlides || 10,
    imageQuality: payload.imageQuality || baseCarousel.imageQuality || 'high',
    caption:     payload.caption || baseCarousel.caption || '',
    notes:       notesContent,
    chatHistory: baseCarousel.chatHistory || [],
    slides:      [], // Inicia vazio para preencher progressivamente com os delays!
  };

  if (existingIndex >= 0) {
    allCarousels[existingIndex] = updatedCarousel;
  } else {
    allCarousels.push(updatedCarousel);
  }
  
  await writeDataAsync(allCarousels);

  res.json({ ok: true, carousel: updatedCarousel });

  (async () => {
    try {
      // Carrega as configurações de branding salvas no banco/JSON
      let branding = {
        logoText: "FONTE OCULTA",
        logoColor: "#ffffff",
        carouselTextColor: "#e4e4e7"
      };
      try {
        const resBranding = await query('SELECT data FROM branding WHERE id = 1');
        if (resBranding.rows.length > 0 && resBranding.rows[0].data && Object.keys(resBranding.rows[0].data).length > 0) {
          branding = resBranding.rows[0].data;
        } else {
          const brandingPath = path.join(__dirname, '..', 'data', 'branding.json');
          if (fs.existsSync(brandingPath)) {
            branding = JSON.parse(fs.readFileSync(brandingPath, 'utf-8'));
          }
        }
      } catch (err) {
        logger.error('[Carousel mock branding]', "Erro ao ler branding do DB/arquivo:", err.message);
      }

      const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
      const PIPELINE = path.join(__dirname, '..', '..', 'core', 'generate_mock_slides.py');
      
      const child = spawn(PYTHON, ['-X', 'utf8', PIPELINE, '--data', JSON.stringify({
        id: finalId,
        title: updatedCarousel.title,
        slidesDir: updatedCarousel.slidesDir,
        format: updatedCarousel.format,
        slides: slidesData,
        logoText: branding.logoText || "FONTE OCULTA",
        logoColor: branding.logoColor || "#ffffff",
        logoSize: branding.logoSize || "22px",
        carouselTextColor: branding.carouselTextColor || "#e4e4e7",
        titleTextSize: branding.titleTextSize || "40px",
        bodyTextSize: branding.bodyTextSize || "24px",
        titleTextColor: branding.titleTextColor || "#ffffff",
        bodyTextColor: branding.bodyTextColor || branding.carouselTextColor || "#e4e4e7",
        logoPosition: branding.logoPosition || "left"
      })], {
        shell: false,
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env }
      });

      const generatedFiles = [];
      let donePayload = null;

      child.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'slide' && obj.status === 'ok') {
              // No script python, o campo filename retornado não tem o path completo
              const fileAbsPath = path.join(outDir, obj.filename);
              generatedFiles.push({
                num: obj.num,
                estado: obj.estado || 'PRODUÇÃO',
                file: fileAbsPath,
                filename: obj.filename
              });
              
              // Notificar progresso de geração do slide via SSE
              sseClients.forEach(send => send({
                type: 'slide',
                carouselId: finalId,
                num: obj.num,
                total: slidesData.length,
                estado: obj.estado || 'PRODUÇÃO',
                status: 'generating_image',
                filename: obj.filename,
                title_text: slidesData[obj.num - 1]?.title_text || ''
              }));
            } else if (obj.type === 'done') {
              donePayload = obj;
            }
          } catch (e) {}
        }
      });

      child.stderr.on('data', (chunk) => {
        logger.error('[Carousel mock stderr]', chunk.toString().trim());
      });

      // Aguarda o encerramento do processo python
      const code = await new Promise((resolve) => {
        child.on('close', resolve);
      });

      logger.info('[Carousel mock]', `Script Python finalizou com código ${code}. Arquivos gerados: ${generatedFiles.length}`);

      if (generatedFiles.length > 0) {
        const currentSlidesList = [];

        if (b2) {
          sseClients.forEach(send => send({
            type: 'log',
            carouselId: finalId,
            msg: '☁ Enviando slides gerados para o MinIO...'
          }));

          const slideUrls = [];
          for (const { num, estado, file, filename } of generatedFiles) {
            try {
              // Upload direto para o bucket do MinIO
              const url = await b2.uploadImageToB2(finalId, filename, file);
              slideUrls.push({ num, estado, filename, url });
              currentSlidesList.push(filename);
              
              sseClients.forEach(send => send({
                type: 'log',
                carouselId: finalId,
                msg: `☁ ${filename} → MinIO ✓`
              }));

              // Adiciona o slide criado no banco progressivamente para atualizar a interface
              const localCarousels = await readDataAsync();
              const idx = localCarousels.findIndex(c => c.id === finalId);
              if (idx >= 0) {
                localCarousels[idx].slides = [...currentSlidesList];
                await writeDataAsync(localCarousels);
              }

              // Avisa o frontend que este slide está com imagem pronta (Mock)
              sseClients.forEach(send => send({
                type: 'slide',
                carouselId: finalId,
                num: num,
                total: slidesData.length,
                estado: estado,
                status: 'ok',
                filename: filename
              }));

            } catch (err) {
              logger.error('[Carousel mock upload]', `Falha no upload de ${filename} para o MinIO: ${err.message}`);
            }

            // Limpa arquivo temporário local no container para não acumular lixo
            try { fs.unlinkSync(file); } catch {}
          }

          // Limpa pasta temporária local do container
          try { fs.rmdirSync(outDir); } catch {}
        } else {
          // Local fallback: files are stored on disk in outDir
          for (const { num, estado, filename } of generatedFiles) {
            currentSlidesList.push(filename);
            
            // Avisa o frontend que este slide está pronto localmente
            sseClients.forEach(send => send({
              type: 'slide',
              carouselId: finalId,
              num: num,
              total: slidesData.length,
              estado: estado,
              status: 'ok',
              filename: filename
            }));
          }
        }

        // Atualiza status final do carrossel no banco local de dados
        const localCarousels = await readDataAsync();
        const idx = localCarousels.findIndex(c => c.id === finalId);
        if (idx >= 0) {
          localCarousels[idx].status = 'pronto';
          localCarousels[idx].totalSlides = currentSlidesList.length;
          localCarousels[idx].slides = currentSlidesList;
          if (b2) {
            localCarousels[idx].b2BaseUrl = b2.b2ImageUrl(finalId, '');
          }
          if (!localCarousels[idx].cost || localCarousels[idx].cost === 0) {
            localCarousels[idx].cost = slidesData.length * 0.08;
          }
          await writeDataAsync(localCarousels);
        }
      }

      await new Promise(r => setTimeout(r, 1000));

      sseClients.forEach(send => send({
        type: 'done',
        carouselId: finalId
      }));

    } catch (err) {
      logger.error('[Carousel mock simulation]', `Erro na simulação e upload do mock: ${err.message}`);
    }
  })();
});

export default router;

