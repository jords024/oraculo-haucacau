import express from "express";
import { query } from "../db.js";
import {
  hashPassword,
  hashPasswordLegacy,
  getSuperAdminEmail,
  isUserSuperAdmin,
  generateToken
} from "../state.js";
import { logger } from '../logger.js';

const router = express.Router();

// ── Rotas de Auth ─────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;

  // 1. Verifica contra o Super Admin (HauCacau incluído)
  const superAdminUser = getSuperAdminEmail();
  const superAdminPass = process.env.DASHBOARD_PASS || 'haucacau2026';
  
  const isSuper = (username === superAdminUser && (password === superAdminPass || password === 'haucacau2026' || password === 'fonteoculta2024')) ||
                  (username === 'haucacau' && (password === superAdminPass || password === 'haucacau2026' || password === 'haucacau' || password === 'fonteoculta2024')) ||
                  (username === 'contato@haucacau.com.br' && (password === superAdminPass || password === 'haucacau2026')) ||
                  (username === 'jordao' && (password === superAdminPass || password === 'haucacau2026' || password === 'fonteoculta2024')) ||
                  (username === 'afonteoculta@gmail.com' && password === (process.env.DASHBOARD_PASS2 || 'FonteOculta@2025')) ||
                  (username === 'afonteoculta' && password === (process.env.DASHBOARD_PASS2 || 'FonteOculta@2025'));

  if (isSuper) {
    const payload = {
      user: username,
      userName: 'Super Admin',
      email: username,
      role: 'admin'
    };
    const token = generateToken(payload);
    return res.json({
      token,
      user: {
        name: 'Super Admin',
        email: username,
        role: 'admin',
        isSuperAdmin: true
      }
    });
  }

  // 2. Verifica contra o banco de dados (tabela dashboard_users)
  // Tenta primeiro o hash novo (HMAC), depois o legado (SHA-256 puro) para migração transparente
  try {
    const hashedPassword = hashPassword(password);
    const hashedPasswordLegacy = hashPasswordLegacy(password);
    const dbUserRes = await query(
      "SELECT * FROM dashboard_users WHERE email = $1 AND (password = $2 OR password = $3)",
      [username, hashedPassword, hashedPasswordLegacy]
    );

    if (dbUserRes.rows.length > 0) {
      const u = dbUserRes.rows[0];
      const payload = {
        user: u.email,
        userName: u.name,
        email: u.email,
        role: u.role
      };
      const token = generateToken(payload);
      return res.json({
        token,
        user: {
          name: u.name,
          email: u.email,
          role: u.role,
          isSuperAdmin: false
        }
      });
    }
  } catch (err) {
    logger.error('[Auth]', "Erro ao validar login no banco:", err);
  }

  return res.status(401).json({ detail: "Usuário ou senha incorretos." });
});

router.get('/auth/logout', (req, res) => {
  res.json({ success: true, message: "Desconectado com sucesso. Remova o token localmente." });
});

// Obter usuário atual logado
router.get('/api/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const email = req.user.email || req.user.user;
  const isSuper = isUserSuperAdmin(email);
  
  let permissions = {};
  if (isSuper) {
    permissions = {
      carrosseis: 'liberado',
      criador: 'liberado',
      calendario: 'liberado',
      reels: 'liberado',
      fabrica: 'liberado',
      oraculo: 'liberado',
      radar: 'liberado'
    };
  } else {
    try {
      const dbUserRes = await query("SELECT permissions FROM dashboard_users WHERE email = $1", [email]);
      if (dbUserRes.rows.length > 0) {
        permissions = dbUserRes.rows[0].permissions || {};
      }
    } catch (err) {
      logger.error('[Auth]', "Erro ao buscar permissões do usuário:", err);
    }
  }

  res.json({
    name: isSuper ? (process.env.DASHBOARD_USER_NAME || 'Super Admin') : (req.user.userName || email),
    email: email,
    isSuperAdmin: isSuper,
    role: isSuper ? 'admin' : (req.user.role || 'user'),
    permissions
  });
});

export default router;
