const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { professorDaRequisicao, cabecalhoLogin, cabecalhoLogout } = require('./auth');

const CUSTO_HASH = 10; // fator de custo do bcrypt

// fabrica um limitador por IP isolado, cada rota com seu proprio balde
function criarLimitador(limite, janelaMs) {
  const tentativas = new Map(); // ip -> { contador, janela }
  setInterval(() => {
    const agora = Date.now();
    tentativas.forEach((registro, ip) => {
      if (agora - registro.janela > janelaMs) tentativas.delete(ip);
    });
  }, janelaMs).unref();

  return function limitar(ip) {
    const agora = Date.now();
    const registro = tentativas.get(ip) || { contador: 0, janela: agora };
    if (agora - registro.janela > janelaMs) {
      registro.contador = 0;
      registro.janela = agora;
    }
    registro.contador += 1;
    tentativas.set(ip, registro);
    return registro.contador <= limite;
  };
}

const limitarLogin = criarLimitador(8, 5 * 60 * 1000); // 8 tentativas / 5 min
const limitarCriarConta = criarLimitador(5, 10 * 60 * 1000); // 5 contas / 10 min, freia enumeracao de email

function emailValido(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

const router = express.Router();

router.post('/api/criar-conta', async (req, res) => {
  if (!limitarCriarConta(req.ip)) return res.status(429).json({ erro: 'muitas tentativas, espera um pouco' });

  const nome = String(req.body.nome || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');

  if (!nome) return res.status(400).json({ erro: 'digita seu nome' });
  if (!emailValido(email)) return res.status(400).json({ erro: 'email invalido' });
  if (senha.length < 6) return res.status(400).json({ erro: 'senha precisa de pelo menos 6 caracteres' });

  try {
    const hash = await bcrypt.hash(senha, CUSTO_HASH);
    const resultado = await pool.query(
      'INSERT INTO professores (email, nome, senha_hash) VALUES ($1, $2, $3) RETURNING id',
      [email, nome, hash]
    );
    res.setHeader('Set-Cookie', cabecalhoLogin(req, resultado.rows[0].id));
    res.json({ ok: true });
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'ja existe conta com esse email' });
    console.error(erro);
    res.status(500).json({ erro: 'nao consegui criar a conta, tenta de novo' });
  }
});

router.post('/api/entrar', async (req, res) => {
  if (!limitarLogin(req.ip)) return res.status(429).json({ erro: 'muitas tentativas, espera um pouco' });

  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const generico = { erro: 'email ou senha invalidos' };

  try {
    const resultado = await pool.query('SELECT id, senha_hash FROM professores WHERE email = $1', [email]);
    if (resultado.rows.length === 0) return res.status(401).json(generico);
    const confere = await bcrypt.compare(senha, resultado.rows[0].senha_hash);
    if (!confere) return res.status(401).json(generico);
    res.setHeader('Set-Cookie', cabecalhoLogin(req, resultado.rows[0].id));
    res.json({ ok: true });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'nao consegui entrar, tenta de novo' });
  }
});

router.post('/api/sair', (req, res) => {
  res.setHeader('Set-Cookie', cabecalhoLogout(req));
  res.json({ ok: true });
});

router.get('/api/eu', async (req, res) => {
  const id = professorDaRequisicao(req);
  if (!id) return res.status(401).json({ erro: 'sem sessao' });
  try {
    const resultado = await pool.query('SELECT id, nome, email, admin FROM professores WHERE id = $1', [id]);
    if (resultado.rows.length === 0) return res.status(401).json({ erro: 'sem sessao' });
    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'nao consegui buscar a conta' });
  }
});

module.exports = { router };
