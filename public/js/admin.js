const el = (id) => document.getElementById(id);
const elLista = el('lista-pendentes');
const elVazio = el('vazio');
const modelo = el('modelo-pendente');

function montarPergunta(p) {
  const li = document.createElement('li');
  li.textContent = p.enunciado + ' — ' + p.alternativas.join(' / ') + ' (correta: ' + p.alternativas[p.correta] + ')';
  return li;
}

async function moderar(id, aprovar, item) {
  try {
    const resposta = await fetch('/api/temas/' + id + '/moderar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aprovar })
    });
    if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).erro || 'nao consegui moderar');
    item.remove();
    if (!elLista.children.length) elVazio.hidden = false;
  } catch (erro) {
    alert(erro.message);
  }
}

function montarPendente(tema) {
  const item = modelo.content.firstElementChild.cloneNode(true);
  item.querySelector('.pendente-titulo').textContent = tema.titulo;
  item.querySelector('.pendente-meta').textContent =
    tema.topico + ' · ' + tema.total + ' perguntas · enviado por ' + tema.criadorNome + ' (' + tema.criadorEmail + ')';
  item.querySelector('.pendente-descricao').textContent = tema.descricao || '(sem descrição)';

  const listaPerguntas = item.querySelector('.pendente-perguntas');
  tema.perguntas.forEach((p) => listaPerguntas.appendChild(montarPergunta(p)));

  item.querySelector('.ver-perguntas').addEventListener('click', (evento) => {
    listaPerguntas.hidden = !listaPerguntas.hidden;
    evento.target.textContent = listaPerguntas.hidden ? 'Ver perguntas' : 'Esconder perguntas';
  });

  item.querySelector('.aprovar').addEventListener('click', () => moderar(tema.id, true, item));
  item.querySelector('.rejeitar').addEventListener('click', () => {
    if (confirm('Rejeitar "' + tema.titulo + '"? O professor continua vendo ele como rejeitado no /criar-tema.')) {
      moderar(tema.id, false, item);
    }
  });

  return item;
}

async function carregar() {
  try {
    const resposta = await fetch('/api/temas/pendentes');
    if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).erro || 'nao consegui carregar');
    const temas = await resposta.json();
    elLista.innerHTML = '';
    temas.forEach((tema) => elLista.appendChild(montarPendente(tema)));
    elVazio.hidden = temas.length > 0;
  } catch (erro) {
    elVazio.textContent = erro.message;
    elVazio.hidden = false;
  }
}

carregar();
