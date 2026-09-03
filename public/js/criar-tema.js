// mesma lista no server/temas.js pra validar; aqui so preenche o seletor
const TOPICOS = ['Programação', 'Tecnologia', 'Matemática', 'Português', 'Ciências', 'História', 'Geografia', 'Diversos'];

const el = (id) => document.getElementById(id);
const elForm = el('form-tema');
const elTemaId = el('tema-id');
const elTitulo = el('tema-titulo');
const elDescricao = el('tema-descricao');
const elTopico = el('tema-topico');
const elPerguntas = el('perguntas');
const elAdicionarPergunta = el('adicionar-pergunta');
const elErro = el('erro-tema');
const elCancelar = el('cancelar-edicao');
const elListaTemas = el('lista-temas');
const modeloPergunta = el('modelo-pergunta');
const modeloAlternativa = el('modelo-alternativa');

let contadorGrupo = 0;

function montarTopicos() {
  elTopico.innerHTML = '';
  TOPICOS.forEach((topico) => {
    const opcao = document.createElement('option');
    opcao.value = topico;
    opcao.textContent = topico;
    elTopico.appendChild(opcao);
  });
}
montarTopicos();

function mostrarErro(texto, sucesso) {
  elErro.textContent = texto;
  elErro.hidden = false;
  elErro.classList.toggle('sucesso', !!sucesso);
}

function renumerar() {
  elPerguntas.querySelectorAll('.pergunta-card').forEach((card, i) => {
    card.querySelector('.pergunta-numero').textContent = 'Pergunta ' + (i + 1);
  });
}

function criarLinhaAlternativa(grupo, texto, marcada) {
  const linha = modeloAlternativa.content.firstElementChild.cloneNode(true);
  const radio = linha.querySelector('.alternativa-correta');
  radio.name = grupo;
  radio.checked = !!marcada;
  linha.querySelector('.alternativa-texto').value = texto || '';
  return linha;
}

function criarCardPergunta(dados) {
  const card = modeloPergunta.content.firstElementChild.cloneNode(true);
  const grupo = 'correta-' + contadorGrupo++;
  const listaAlt = card.querySelector('.alternativas-lista');

  const alternativas = dados ? dados.alternativas : ['', ''];
  const correta = dados ? dados.correta : 0;
  alternativas.forEach((texto, i) => listaAlt.appendChild(criarLinhaAlternativa(grupo, texto, i === correta)));

  if (dados) {
    card.querySelector('.campo-enunciado').value = dados.enunciado;
    card.querySelector('.campo-tempo').value = dados.tempo;
    card.querySelector('.campo-dobro').checked = !!dados.dobro;
  }

  card.querySelector('.remover-pergunta').addEventListener('click', () => {
    if (elPerguntas.querySelectorAll('.pergunta-card').length <= 1) {
      mostrarErro('precisa ter pelo menos 1 pergunta');
      return;
    }
    card.remove();
    renumerar();
  });

  card.querySelector('.add-alternativa').addEventListener('click', () => {
    if (listaAlt.children.length >= 6) return;
    listaAlt.appendChild(criarLinhaAlternativa(grupo, '', false));
  });

  card.querySelector('.rem-alternativa').addEventListener('click', () => {
    if (listaAlt.children.length <= 2) return;
    const removida = listaAlt.lastElementChild;
    const eraCorreta = removida.querySelector('.alternativa-correta').checked;
    removida.remove();
    if (eraCorreta) listaAlt.querySelector('.alternativa-correta').checked = true;
  });

  return card;
}

elAdicionarPergunta.addEventListener('click', () => {
  elPerguntas.appendChild(criarCardPergunta());
  renumerar();
});

function resetarFormulario() {
  elTemaId.value = '';
  elTitulo.value = '';
  elDescricao.value = '';
  elTopico.value = TOPICOS[0];
  elPerguntas.innerHTML = '';
  elPerguntas.appendChild(criarCardPergunta());
  renumerar();
  elCancelar.hidden = true;
  elErro.hidden = true;
}

elCancelar.addEventListener('click', resetarFormulario);

function lerFormulario() {
  const perguntas = [...elPerguntas.querySelectorAll('.pergunta-card')].map((card) => {
    const radios = [...card.querySelectorAll('.alternativa-correta')];
    const correta = radios.findIndex((r) => r.checked);
    return {
      enunciado: card.querySelector('.campo-enunciado').value.trim(),
      alternativas: [...card.querySelectorAll('.alternativa-texto')].map((i) => i.value.trim()),
      correta: correta === -1 ? 0 : correta,
      tempo: Number(card.querySelector('.campo-tempo').value) || 20,
      dobro: card.querySelector('.campo-dobro').checked
    };
  });
  return {
    titulo: elTitulo.value.trim(),
    descricao: elDescricao.value.trim(),
    topico: elTopico.value,
    perguntas
  };
}

elForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const dados = lerFormulario();
  const id = elTemaId.value;
  try {
    const resposta = await fetch(id ? '/api/temas/' + id : '/api/temas', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.erro || 'nao consegui salvar');
    resetarFormulario();
    mostrarErro('Tema salvo!', true);
    carregarMeusTemas();
  } catch (erro) {
    mostrarErro(erro.message, false);
  }
});

async function editarTema(id) {
  try {
    const resposta = await fetch('/api/temas/' + id);
    const tema = await resposta.json();
    if (!resposta.ok) throw new Error(tema.erro || 'nao consegui carregar');
    elTemaId.value = tema.id;
    elTitulo.value = tema.titulo;
    elDescricao.value = tema.descricao || '';
    elTopico.value = tema.topico || TOPICOS[0];
    elPerguntas.innerHTML = '';
    tema.perguntas.forEach((p) => elPerguntas.appendChild(criarCardPergunta(p)));
    renumerar();
    elCancelar.hidden = false;
    elErro.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (erro) {
    mostrarErro(erro.message, false);
  }
}

async function excluirTema(id) {
  if (!confirm('Excluir esse tema? Não dá pra desfazer.')) return;
  try {
    const resposta = await fetch('/api/temas/' + id, { method: 'DELETE' });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo.erro || 'nao consegui excluir');
    }
    carregarMeusTemas();
  } catch (erro) {
    mostrarErro(erro.message, false);
  }
}

const rotuloStatus = {
  pendente: icone('hourglass', 13) + ' Em revisão',
  aprovado: icone('circle-check', 13) + ' Aprovado',
  rejeitado: icone('circle-x', 13) + ' Rejeitado'
};

async function carregarMeusTemas() {
  try {
    const temas = await (await fetch('/api/temas/meus')).json();

    elListaTemas.innerHTML = '';
    temas.forEach((t) => {
        const id = t.arquivo.replace('db:', '');
        const item = document.createElement('li');
        item.className = 'status-' + t.status;

        // titulo do tema e texto livre do professor: fica em createTextNode, o rotulo de status (fixo) vai em innerHTML
        const nome = document.createElement('span');
        nome.className = 'meu-tema-nome';
        nome.appendChild(document.createTextNode(t.titulo + ' (' + t.topico + '), ' + t.total + ' perguntas — '));
        nome.insertAdjacentHTML('beforeend', rotuloStatus[t.status] || t.status);
        item.appendChild(nome);

        const botoes = document.createElement('span');
        botoes.className = 'meu-tema-botoes';

        const editar = document.createElement('button');
        editar.type = 'button';
        editar.textContent = 'Editar';
        editar.addEventListener('click', () => editarTema(id));
        botoes.appendChild(editar);

        const excluir = document.createElement('button');
        excluir.type = 'button';
        excluir.className = 'excluir';
        excluir.textContent = 'Excluir';
        excluir.addEventListener('click', () => excluirTema(id));
        botoes.appendChild(excluir);

        item.appendChild(botoes);
        elListaTemas.appendChild(item);
      });
  } catch (erro) {
    console.error(erro);
  }
}

resetarFormulario();
carregarMeusTemas();
