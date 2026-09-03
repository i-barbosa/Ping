// mesma lista no server/temas.js; so define a ordem em que os grupos aparecem aqui
const TOPICOS = ['Programação', 'Tecnologia', 'Matemática', 'Português', 'Ciências', 'História', 'Geografia', 'Diversos'];

const el = (id) => document.getElementById(id);
const elSaudacao = el('saudacao');
const elSair = el('sair');
const elTemasCirculos = el('temas-circulos');
const elAbrirBolha = el('abrir-bolha');
const elBolhaFundo = el('bolha-fundo');
const elBolhaTemas = el('bolha-temas');
const elBolhaModos = el('bolha-modos');
const elBolhaErro = el('bolha-erro');
const elBolhaConfirmar = el('bolha-confirmar');
const elFecharBolha = el('fechar-bolha');
const elCardAdmin = el('card-admin');

let temas = [];
let temaEscolhido = null;
let modoEscolhido = 'solo';

elSair.addEventListener('click', () => {
  fetch('/api/sair', { method: 'POST' }).finally(() => {
    location.href = '/entrar';
  });
});

async function carregarEu() {
  try {
    const resposta = await fetch('/api/eu');
    const eu = await resposta.json();
    if (resposta.ok) {
      elSaudacao.textContent = ''; // nome do professor e texto livre, sempre por createTextNode
      elSaudacao.appendChild(document.createTextNode('Olá, ' + eu.nome + ' '));
      elSaudacao.insertAdjacentHTML('beforeend', icone('hand', 18));
    }
    if (eu.admin) elCardAdmin.hidden = false;
  } catch (erro) {
    console.error(erro);
  }
}

function iniciais(titulo) {
  return (titulo || '?').trim().charAt(0).toUpperCase();
}

function montarCirculo(tema, aoClicar) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'tema-circulo';
  item.title = tema.titulo + ', ' + tema.total + ' perguntas' + (tema.status === 'pendente' ? ' (em revisão, só você vê)' : '');

  const bola = document.createElement('span');
  bola.className = 'tema-bola';
  bola.textContent = iniciais(tema.titulo);
  if (tema.status === 'pendente') {
    const selo = document.createElement('span');
    selo.className = 'tema-selo-pendente';
    selo.innerHTML = icone('hourglass', 12);
    bola.appendChild(selo);
  }
  item.appendChild(bola);

  const label = document.createElement('span');
  label.className = 'tema-label';
  label.textContent = tema.titulo;
  item.appendChild(label);

  item.addEventListener('click', () => aoClicar(tema, item));
  return item;
}

// tema -> topico (Historia) -> temas de historia: agrupa mantendo a ordem fixa de TOPICOS, so mostra grupo com tema
function agruparPorTopico(lista) {
  const porTopico = new Map();
  lista.forEach((tema) => {
    const chave = tema.topico || 'Diversos';
    if (!porTopico.has(chave)) porTopico.set(chave, []);
    porTopico.get(chave).push(tema);
  });
  const ordem = [...TOPICOS, ...[...porTopico.keys()].filter((t) => !TOPICOS.includes(t))];
  return ordem.filter((topico) => porTopico.has(topico)).map((topico) => [topico, porTopico.get(topico)]);
}

function montarGrupoTopico(topico, temasDoTopico, aoClicar) {
  const grupo = document.createElement('div');
  grupo.className = 'topico-grupo';

  const titulo = document.createElement('h3');
  titulo.className = 'topico-titulo';
  titulo.textContent = topico;
  grupo.appendChild(titulo);

  const linha = document.createElement('div');
  linha.className = 'topico-linha';
  temasDoTopico.forEach((tema) => linha.appendChild(montarCirculo(tema, aoClicar)));
  grupo.appendChild(linha);

  return grupo;
}

function desenharCirculosPrincipais() {
  elTemasCirculos.innerHTML = '';
  if (temas.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'temas-vazio';
    vazio.textContent = 'Nenhum tema ainda. Crie o primeiro em "Criar tema".';
    elTemasCirculos.appendChild(vazio);
    return;
  }
  agruparPorTopico(temas).forEach(([topico, temasDoTopico]) => {
    elTemasCirculos.appendChild(montarGrupoTopico(topico, temasDoTopico, (t) => abrirBolha(t)));
  });
}

function desenharCirculosBolha() {
  elBolhaTemas.innerHTML = '';
  agruparPorTopico(temas).forEach(([topico, temasDoTopico]) => {
    const grupo = montarGrupoTopico(topico, temasDoTopico, (t, elemento) => {
      temaEscolhido = t;
      elBolhaTemas.querySelectorAll('.tema-circulo').forEach((c) => c.classList.remove('escolhido'));
      elemento.classList.add('escolhido');
      elBolhaConfirmar.disabled = false;
    });
    grupo.querySelectorAll('.tema-circulo').forEach((circulo, i) => {
      if (temaEscolhido && temasDoTopico[i].arquivo === temaEscolhido.arquivo) circulo.classList.add('escolhido');
    });
    elBolhaTemas.appendChild(grupo);
  });
}

async function carregarTemas() {
  try {
    const resposta = await fetch('/api/temas');
    temas = await resposta.json();
    if (!Array.isArray(temas)) temas = [];
    desenharCirculosPrincipais();
  } catch (erro) {
    console.error(erro);
  }
}

function abrirBolha(temaInicial) {
  temaEscolhido = temaInicial || null;
  modoEscolhido = 'solo';
  elBolhaModos.querySelectorAll('.bolha-modo').forEach((b) => b.classList.toggle('escolhido', b.dataset.modo === 'solo'));
  elBolhaErro.hidden = true;
  elBolhaConfirmar.disabled = !temaEscolhido;
  desenharCirculosBolha();
  elBolhaFundo.hidden = false;
}

function fecharBolha() {
  elBolhaFundo.hidden = true;
}

elAbrirBolha.addEventListener('click', () => abrirBolha(temaEscolhido));
elFecharBolha.addEventListener('click', fecharBolha);
elBolhaFundo.addEventListener('click', (evento) => {
  if (evento.target === elBolhaFundo) fecharBolha();
});

elBolhaModos.querySelectorAll('.bolha-modo').forEach((botao) => {
  botao.addEventListener('click', () => {
    modoEscolhido = botao.dataset.modo;
    elBolhaModos.querySelectorAll('.bolha-modo').forEach((b) => b.classList.toggle('escolhido', b === botao));
  });
});

// abre uma conexao curta so pra criar a sala, depois manda pro host
function criarSala() {
  if (!temaEscolhido) return;
  elBolhaConfirmar.disabled = true;
  elBolhaErro.hidden = true;

  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  const tempo = setTimeout(() => {
    ws.close();
    elBolhaErro.textContent = 'Demorou demais pra responder, tenta de novo';
    elBolhaErro.hidden = false;
    elBolhaConfirmar.disabled = false;
  }, 8000);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ tipo: 'entrar_host' }));
    ws.send(JSON.stringify({ tipo: 'tema', arquivo: temaEscolhido.arquivo }));
    ws.send(JSON.stringify({ tipo: 'modo', modo: modoEscolhido }));
    ws.send(JSON.stringify({ tipo: 'proxima' }));
  });

  ws.addEventListener('message', (evento) => {
    try {
      const dados = JSON.parse(evento.data);
      if (dados.estado === 'aguardando') {
        clearTimeout(tempo);
        ws.close();
        location.href = '/host';
      }
    } catch (erro) {
      console.error(erro);
    }
  });

  ws.addEventListener('error', () => {
    clearTimeout(tempo);
    elBolhaErro.textContent = 'Não consegui conectar, tenta de novo';
    elBolhaErro.hidden = false;
    elBolhaConfirmar.disabled = false;
  });
}

elBolhaConfirmar.addEventListener('click', criarSala);

carregarEu();
carregarTemas();
