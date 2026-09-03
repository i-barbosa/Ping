const crypto = require('crypto');

const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// sem segredo fixo, sessao cai a cada reinicio do processo; avisa uma vez no boot
if (!process.env.SESSAO_SEGREDO) {
  console.warn('SESSAO_SEGREDO nao definido: usando segredo aleatorio, todas as sessoes caem no proximo restart');
}
const SEGREDO = process.env.SESSAO_SEGREDO || crypto.randomBytes(32).toString('hex');

function assinar(base) {
  return crypto.createHmac('sha256', SEGREDO).update(base).digest('base64url');
}

function assinaturaValida(payload, assinatura) {
  const esperada = Buffer.from(assinar(payload));
  const recebida = Buffer.from(String(assinatura || ''));
  if (esperada.length !== recebida.length) return false;
  return crypto.timingSafeEqual(esperada, recebida);
}

// cookie carrega o id do professor e a validade, nao precisa de tabela de sessao
function criarCookie(professorId) {
  const payload = Buffer.from(JSON.stringify({ id: professorId, exp: Date.now() + DURACAO_SESSAO_MS })).toString(
    'base64url'
  );
  return payload + '.' + assinar(payload);
}

function lerCookie(valor) {
  if (!valor) return null;
  const ponto = valor.lastIndexOf('.');
  if (ponto === -1) return null;
  const payload = valor.slice(0, ponto);
  const assinatura = valor.slice(ponto + 1);
  if (!assinaturaValida(payload, assinatura)) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!dados.id || !dados.exp || dados.exp < Date.now()) return null;
    return dados.id;
  } catch {
    return null;
  }
}

function pegarCookies(cabecalho) {
  const mapa = {};
  String(cabecalho || '')
    .split(';')
    .forEach((par) => {
      const i = par.indexOf('=');
      if (i === -1) return;
      mapa[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
    });
  return mapa;
}

function professorDaRequisicao(req) {
  const cookies = pegarCookies(req.headers.cookie);
  return lerCookie(cookies.sessao);
}

// Secure so quando a conexao e https de verdade, senao teste local via http quebra
function cabecalhoLogin(req, professorId) {
  const partes = ['sessao=' + criarCookie(professorId), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  partes.push('Max-Age=' + Math.floor(DURACAO_SESSAO_MS / 1000));
  if (req.secure) partes.push('Secure');
  return partes.join('; ');
}

function cabecalhoLogout(req) {
  const partes = ['sessao=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (req.secure) partes.push('Secure');
  return partes.join('; ');
}

module.exports = {
  professorDaRequisicao,
  cabecalhoLogin,
  cabecalhoLogout
};
