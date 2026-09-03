const fs = require('fs');
const path = require('path');
const express = require('express');
const { pool, ehAdmin } = require('./db');
const { professorDaRequisicao } = require('./auth');

const PASTA_QUIZZES = path.join(__dirname, '..', 'quizzes');

// lista fixa: evita "Historia" vs "História" vs "história do brasil" espalhado em topicos diferentes.
// mesma lista no criar-tema.js pro seletor; aqui so valida o que chega
const TOPICOS = ['Programação', 'Tecnologia', 'Matemática', 'Português', 'Ciências', 'História', 'Geografia', 'Diversos'];

function validarBanco(dados) {
  const erros = [];
  if (!dados || typeof dados !== 'object') return ['arquivo nao e um objeto JSON'];
  if (typeof dados.titulo !== 'string' || !dados.titulo.trim()) erros.push('falta o campo titulo');
  if (dados.descricao !== undefined && typeof dados.descricao !== 'string') erros.push('descricao precisa ser texto');
  if (!TOPICOS.includes(dados.topico)) erros.push('topico precisa ser um de: ' + TOPICOS.join(', '));
  if (!Array.isArray(dados.perguntas) || dados.perguntas.length === 0) {
    erros.push('falta a lista perguntas ou ela esta vazia');
    return erros;
  }

  dados.perguntas.forEach((p, i) => {
    const onde = 'pergunta ' + (i + 1);
    if (!p || typeof p !== 'object') {
      erros.push(onde + ': nao e um objeto');
      return;
    }
    if (typeof p.enunciado !== 'string' || !p.enunciado.trim()) erros.push(onde + ': enunciado vazio');
    if (!Array.isArray(p.alternativas) || p.alternativas.length < 2) {
      erros.push(onde + ': precisa de pelo menos 2 alternativas');
      return;
    }
    if (p.alternativas.length > 6) erros.push(onde + ': maximo de 6 alternativas, tem ' + p.alternativas.length);
    if (p.alternativas.some((a) => typeof a !== 'string' || !a.trim())) erros.push(onde + ': tem alternativa vazia');
    if (!Number.isInteger(p.correta) || p.correta < 0 || p.correta >= p.alternativas.length) {
      erros.push(onde + ': correta e ' + p.correta + ', mas precisa ser de 0 a ' + (p.alternativas.length - 1));
    }
    if (typeof p.tempo !== 'number' || p.tempo <= 0) erros.push(onde + ': tempo precisa ser numero maior que zero');
  });

  return erros;
}

// le a pasta uma vez no boot; arquivo com erro e reportado e pulado, nao derruba os outros
function carregarArquivos() {
  const mapa = new Map();
  let arquivos = [];

  try {
    arquivos = fs.readdirSync(PASTA_QUIZZES).filter((a) => a.endsWith('.json'));
  } catch {
    console.error('pasta quizzes nao encontrada em ' + PASTA_QUIZZES);
    process.exit(1);
  }

  for (const arquivo of arquivos) {
    let dados;
    try {
      dados = JSON.parse(fs.readFileSync(path.join(PASTA_QUIZZES, arquivo), 'utf8'));
    } catch (erro) {
      console.error('quizzes/' + arquivo + ': JSON invalido, ' + erro.message);
      continue;
    }

    const erros = validarBanco(dados);
    if (erros.length) {
      erros.forEach((e) => console.error('quizzes/' + arquivo + ': ' + e));
      console.error('quizzes/' + arquivo + ': tema ignorado');
      continue;
    }

    mapa.set(arquivo, {
      titulo: dados.titulo,
      descricao: dados.descricao || '',
      topico: dados.topico,
      perguntas: dados.perguntas,
      editavel: false,
      criadoPor: null
    });
    console.log('tema carregado: ' + dados.titulo + ', ' + dados.perguntas.length + ' perguntas');
  }

  return mapa;
}

const arquivos = carregarArquivos(); // chave = nome do arquivo, fixo desde o boot
const doBanco = new Map(); // chave = 'db:' + id, recarregado a cada mudanca

async function carregarDoBanco() {
  const resultado = await pool.query('SELECT id, titulo, descricao, topico, perguntas, criado_por, status FROM temas ORDER BY id');
  doBanco.clear();
  resultado.rows.forEach((linha) => {
    doBanco.set('db:' + linha.id, {
      titulo: linha.titulo,
      descricao: linha.descricao || '',
      topico: linha.topico,
      perguntas: linha.perguntas,
      editavel: true,
      criadoPor: linha.criado_por,
      status: linha.status
    });
  });
}

if (arquivos.size === 0) {
  console.error('nenhum tema em quizzes/, mas temas criados por professor no banco ainda podem existir');
}

function buscarTema(chave) {
  return arquivos.get(chave) || doBanco.get(chave) || null;
}

// aprovado vale pra qualquer um; pendente so pra quem criou usar enquanto espera revisao; rejeitado nao roda pra ninguem
function podeUsar(t, professorId) {
  if (t.status === 'aprovado') return true;
  return t.status === 'pendente' && t.criadoPor === professorId;
}

function temaExiste(chave, professorId) {
  return arquivos.has(chave) || (doBanco.has(chave) && podeUsar(doBanco.get(chave), professorId));
}

function listarTemas(professorId) {
  const lista = [];
  arquivos.forEach((t, chave) => {
    lista.push({ arquivo: chave, titulo: t.titulo, descricao: t.descricao, topico: t.topico, total: t.perguntas.length, editavel: false, criadoPor: null, status: 'aprovado' });
  });
  doBanco.forEach((t, chave) => {
    if (!podeUsar(t, professorId)) return;
    lista.push({ arquivo: chave, titulo: t.titulo, descricao: t.descricao, topico: t.topico, total: t.perguntas.length, editavel: true, criadoPor: t.criadoPor, status: t.status });
  });
  return lista;
}

// temas do proprio professor, qualquer status, pra ele acompanhar/editar o que mandou
function meusTemas(professorId) {
  const lista = [];
  doBanco.forEach((t, chave) => {
    if (t.criadoPor !== professorId) return;
    lista.push({ arquivo: chave, titulo: t.titulo, descricao: t.descricao, topico: t.topico, total: t.perguntas.length, status: t.status });
  });
  return lista;
}

async function temasPendentes() {
  const resultado = await pool.query(
    `SELECT temas.id, temas.titulo, temas.descricao, temas.topico, temas.perguntas, professores.nome AS criador_nome, professores.email AS criador_email
     FROM temas JOIN professores ON professores.id = temas.criado_por
     WHERE temas.status = 'pendente' ORDER BY temas.criado_em`
  );
  return resultado.rows.map((linha) => ({
    id: linha.id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    topico: linha.topico,
    total: linha.perguntas.length,
    perguntas: linha.perguntas,
    criadorNome: linha.criador_nome,
    criadorEmail: linha.criador_email
  }));
}

async function moderarTema(id, aprovar) {
  const resultado = await pool.query('UPDATE temas SET status = $1 WHERE id = $2 RETURNING id', [
    aprovar ? 'aprovado' : 'rejeitado',
    id
  ]);
  if (resultado.rowCount === 0) {
    const erro = new Error('tema nao encontrado');
    erro.naoEncontrado = true;
    throw erro;
  }
  await carregarDoBanco();
}

async function criarTema(professorId, dados) {
  const erros = validarBanco(dados);
  if (erros.length) {
    const erro = new Error(erros.join('; '));
    erro.validacao = true;
    throw erro;
  }
  const resultado = await pool.query(
    "INSERT INTO temas (titulo, descricao, topico, perguntas, criado_por, status) VALUES ($1, $2, $3, $4, $5, 'pendente') RETURNING id",
    [dados.titulo.trim(), (dados.descricao || '').trim(), dados.topico, JSON.stringify(dados.perguntas), professorId]
  );
  await carregarDoBanco();
  return 'db:' + resultado.rows[0].id;
}

// editar manda de volta pra revisao, mesmo se ja estava aprovado
async function editarTema(id, dados) {
  const erros = validarBanco(dados);
  if (erros.length) {
    const erro = new Error(erros.join('; '));
    erro.validacao = true;
    throw erro;
  }
  const resultado = await pool.query(
    "UPDATE temas SET titulo = $1, descricao = $2, topico = $3, perguntas = $4, status = 'pendente' WHERE id = $5 RETURNING id",
    [dados.titulo.trim(), (dados.descricao || '').trim(), dados.topico, JSON.stringify(dados.perguntas), id]
  );
  if (resultado.rowCount === 0) {
    const erro = new Error('tema nao encontrado');
    erro.naoEncontrado = true;
    throw erro;
  }
  await carregarDoBanco();
}

async function removerTema(id) {
  await pool.query('DELETE FROM temas WHERE id = $1', [id]);
  await carregarDoBanco();
}

/* ===================== ROTAS ===================== */

const router = express.Router();

router.get('/api/temas', (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta pra ver os temas' });
  res.json(listarTemas(professorId));
});

router.get('/api/temas/meus', (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta pra ver os temas' });
  res.json(meusTemas(professorId));
});

router.get('/api/temas/pendentes', async (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta' });
  if (!(await ehAdmin(professorId))) return res.status(403).json({ erro: 'so admin ve isso' });
  try {
    res.json(await temasPendentes());
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'nao consegui buscar os temas pendentes' });
  }
});

router.post('/api/temas/:id/moderar', async (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta' });
  if (!(await ehAdmin(professorId))) return res.status(403).json({ erro: 'so admin faz isso' });
  const aprovar = req.body.aprovar === true;
  try {
    await moderarTema(Number(req.params.id), aprovar);
    res.json({ ok: true });
  } catch (erro) {
    if (erro.naoEncontrado) return res.status(404).json({ erro: 'tema nao encontrado' });
    console.error(erro);
    res.status(500).json({ erro: 'nao consegui moderar o tema' });
  }
});

router.get('/api/temas/:id', (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta' });
  const tema = doBanco.get('db:' + Number(req.params.id));
  if (!tema) return res.status(404).json({ erro: 'tema nao encontrado' });
  if (tema.criadoPor !== professorId) return res.status(403).json({ erro: 'so quem criou pode editar' });
  res.json({ id: Number(req.params.id), titulo: tema.titulo, descricao: tema.descricao, topico: tema.topico, perguntas: tema.perguntas });
});

router.post('/api/temas', async (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta' });
  try {
    const arquivo = await criarTema(professorId, req.body);
    res.json({ ok: true, arquivo });
  } catch (erro) {
    if (erro.validacao) return res.status(400).json({ erro: erro.message });
    console.error(erro);
    res.status(500).json({ erro: 'nao consegui salvar o tema' });
  }
});

router.put('/api/temas/:id', async (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta' });
  const id = Number(req.params.id);
  const tema = doBanco.get('db:' + id);
  if (!tema) return res.status(404).json({ erro: 'tema nao encontrado' });
  if (tema.criadoPor !== professorId) return res.status(403).json({ erro: 'so quem criou pode editar' });
  try {
    await editarTema(id, req.body);
    res.json({ ok: true });
  } catch (erro) {
    if (erro.validacao) return res.status(400).json({ erro: erro.message });
    console.error(erro);
    res.status(500).json({ erro: 'nao consegui salvar o tema' });
  }
});

router.delete('/api/temas/:id', async (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta' });
  const id = Number(req.params.id);
  const tema = doBanco.get('db:' + id);
  if (!tema) return res.status(404).json({ erro: 'tema nao encontrado' });
  if (tema.criadoPor !== professorId) return res.status(403).json({ erro: 'so quem criou pode remover' });
  await removerTema(id);
  res.json({ ok: true });
});

module.exports = { router, buscarTema, temaExiste, listarTemas, carregarDoBanco };
