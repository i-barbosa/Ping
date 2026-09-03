require('dotenv').config({ quiet: true }); // sem isso o pacote imprime propaganda aleatoria no boot

const http = require('http');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');
const { migrar, ehAdmin } = require('./server/db');
const { professorDaRequisicao } = require('./server/auth');
const contas = require('./server/contas');
const temas = require('./server/temas');
const jogo = require('./server/jogo');

const PORTA = Number(process.env.PORT) || 3000;

// no Render usa a URL publica fixa; local (ou fora do Render) cai na URL da propria requisicao
function urlDeEntrada(req, pin) {
  const base = (process.env.RENDER_EXTERNAL_URL || req.protocol + '://' + (req.get('host') || '')) + '/play';
  return pin ? base + '?sala=' + pin : base;
}

/* ===================== HTTP ===================== */

const app = express();
app.set('trust proxy', 1); // Render fica atras de proxy, sem isso req.protocol vem http
app.use(express.json({ limit: '100kb' })); // tema com varias perguntas passa perto do limite antigo de 10kb

// sem no-cache o celular fica com a tela da versao anterior depois do deploy
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: 0,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
  })
);

app.get('/', (req, res) => res.redirect(professorDaRequisicao(req) ? '/painel' : '/entrar'));

app.get('/entrar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'entrar.html')));

app.get('/painel', (req, res) => {
  if (!professorDaRequisicao(req)) return res.redirect('/entrar');
  res.sendFile(path.join(__dirname, 'public', 'painel.html'));
});

app.get('/host', (req, res) => {
  if (!professorDaRequisicao(req)) return res.redirect('/entrar');
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/criar-tema', (req, res) => {
  if (!professorDaRequisicao(req)) return res.redirect('/entrar');
  res.sendFile(path.join(__dirname, 'public', 'criar-tema.html'));
});

app.get('/admin', async (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.redirect('/entrar');
  if (!(await ehAdmin(professorId))) return res.redirect('/painel');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));

app.get('/entrada.json', (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).json({ erro: 'entra na conta pra ver o link da sala' });
  const pin = jogo.pinDoProfessor(professorId);
  res.json({ url: urlDeEntrada(req, pin), pin });
});

app.get('/relatorio.csv', (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).send('entra na conta pra baixar o relatorio');
  const relatorio = jogo.obterRelatorio(professorId);
  if (!relatorio) return res.status(404).send('nenhuma partida terminada ainda');
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + relatorio.nome + '"');
  res.send(relatorio.csv);
});

app.get('/qr.svg', async (req, res) => {
  const professorId = professorDaRequisicao(req);
  if (!professorId) return res.status(403).send('entra na conta pra ver o qr da sala');
  try {
    const pin = jogo.pinDoProfessor(professorId);
    const svg = await QRCode.toString(urlDeEntrada(req, pin), {
      type: 'svg',
      margin: 1,
      color: { dark: '#151a1f', light: '#f2eee6' }
    });
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(svg);
  } catch (erro) {
    console.error(erro);
    res.status(500).send('erro ao gerar qr');
  }
});

app.use(contas.router);
app.use(temas.router);

const servidor = http.createServer(app);
const wss = new WebSocketServer({ server: servidor });

// o ws repassa o erro do http para o WebSocketServer, entao o tratamento precisa estar nos dois
function tratarErroDeBoot(erro) {
  if (erro.code === 'EADDRINUSE') {
    console.error('a porta ' + PORTA + ' ja esta em uso, provavelmente outro Ping aberto');
    console.error('feche a outra janela, ou rode em outra porta com PORT=3001 npm start');
    process.exit(1);
  }
  if (erro.code === 'EACCES') {
    console.error('sem permissao para usar a porta ' + PORTA + ', tente outra com PORT=3001 npm start');
    process.exit(1);
  }
  console.error(erro);
  process.exit(1);
}

servidor.on('error', tratarErroDeBoot);
wss.on('error', tratarErroDeBoot);

jogo.configurarWebSocket(wss);

/* ===================== BOOT ===================== */

async function iniciar() {
  if (!process.env.DATABASE_URL) {
    console.error('faltou DATABASE_URL: crie um Postgres gratuito (Neon ou Supabase) e defina a variavel de ambiente');
    process.exit(1);
  }

  try {
    await migrar();
    await temas.carregarDoBanco();
  } catch (erro) {
    console.error('nao consegui preparar o banco: ' + erro.message);
    process.exit(1);
  }

  servidor.listen(PORTA, '0.0.0.0', async () => {
    // Render preenche essa variavel sozinho; sem ela (dev local) cai no localhost
    const base = process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORTA;

    console.log('entrar:  ' + base + '/entrar');
    console.log('host:    ' + base + '/host');
    console.log('player:  ' + base + '/play');

    try {
      console.log(await QRCode.toString(base + '/play', { type: 'terminal', small: true }));
    } catch (erro) {
      console.error(erro);
    }
  });
}

iniciar();
