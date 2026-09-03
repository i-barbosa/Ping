const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { professorDaRequisicao } = require('./auth');
const { buscarTema, temaExiste } = require('./temas');

const PASTA_RELATORIOS = path.join(__dirname, '..', 'relatorios');

const LIMITE_MENSAGENS = 25; // por segundo, por conexao
const JANELA_MS = 1000;
const TAMANHO_MAXIMO = 2000; // bytes por mensagem
const LIMITE_JOGADORES = 300;

// tempo de leitura antes das alternativas aparecerem, estilo Kahoot: da pra ler a pergunta sem ja sair caçando resposta
const LEITURA_MINIMA_MS = 2500;
const LEITURA_MAXIMA_MS = 7000;
const LEITURA_MS_POR_CARACTERE = 60;

// depois do resultado, tempo de comentar a resposta antes da proxima pergunta abrir sozinha
const RESULTADO_MS = 5000;

const TAMANHO_PIN = 6;
// sem I/O/0/1: letra e numero parecido demais de longe, projetado, confunde o aluno digitando
const CARACTERES_PIN = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// mesma lista no play.js pro seletor; aqui so valida o que chega
const AVATARES = ['🦊', '🐼', '🐸', '🐵', '🐨', '🦁', '🐯', '🐰', '🐺', '🦄', '🐙', '🦖', '🐧', '🦉', '🐝', '🦋', '🐳', '🐢', '🐲', '👾', '🤖', '👻', '🐔', '🐴'];
// nome do icone lucide (renderizado no play.js/host.js via lucide.createIcons()), nao emoji
const ICONES_REACAO = ['thumbs-up', 'heart', 'smile', 'star', 'zap', 'party-popper'];
const REACAO_INTERVALO_MS = 1200; // trava spam de reacao por jogador

// duo e squad tem tamanho de time fixo; a quantidade de times e calculada de quem esta na sala
const TAMANHOS_TIME = { duo: 2, squad: 4 };
const PREFIXO_TIME = { duo: 'Dupla', squad: 'Squad' };
const MODOS_VALIDOS = ['solo', 'duo', 'squad', 'battleroyale'];

// nome do aluno vai pro projetor, entao tira emoji, simbolo solto e espaco repetido
function limparNome(bruto) {
  const limpo = String(bruto || '')
    .normalize('NFC')
    .replace(/[\p{Extended_Pictographic}\u200D\uFE0F\u20E3]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  return limpo || 'sem nome';
}

function enviar(ws, dados) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(dados));
}

/* ===================== SALAS ===================== */

const salas = new Map(); // pin -> sala
const salaDoProfessor = new Map(); // professorId -> pin

// pin alfanumerico curto tipo ABC123, cabe na tela e da pra escrever na lousa
function gerarPin() {
  let pin;
  do {
    pin = Array.from({ length: TAMANHO_PIN }, () => CARACTERES_PIN[crypto.randomInt(0, CARACTERES_PIN.length)]).join('');
  } while (salas.has(pin));
  return pin;
}

function criarSala(professorId) {
  const pin = gerarPin();
  const hosts = new Set();
  const jogadores = new Map(); // id -> jogador
  let ultimoRelatorio = null; // { nome, csv }

  const jogo = {
    estado: 'configurando', // configurando | aguardando | leitura | pergunta | resultado | fim
    modo: 'solo', // solo | duo | squad | battleroyale
    equipes: [],
    tema: null,
    indice: -1,
    abertaEm: 0,
    leituraAte: 0, // timestamp em que a leitura acaba e as alternativas aparecem
    perguntaAte: 0, // timestamp em que a pergunta fecha sozinha, 0 se auto-avancar desligado
    resultadoAte: 0, // timestamp em que a proxima pergunta abre sozinha, 0 se auto-avancar desligado
    autoAvancar: true // host pode desligar e voltar a avançar so no clique
  };

  let timerLeitura = null;
  let timerPergunta = null;
  let timerResultado = null;

  function pararTimers() {
    clearTimeout(timerLeitura);
    clearTimeout(timerPergunta);
    clearTimeout(timerResultado);
    timerLeitura = null;
    timerPergunta = null;
    timerResultado = null;
  }

  function banco() {
    return jogo.tema ? buscarTema(jogo.tema) : null;
  }

  function perguntas() {
    const atual = banco();
    return atual ? atual.perguntas : [];
  }

  function perguntaAtual() {
    return perguntas()[jogo.indice] || null;
  }

  function online(j) {
    return j.ws && j.ws.readyState === j.ws.OPEN;
  }

  function modoDeTimes(modo) {
    return modo === 'duo' || modo === 'squad';
  }

  // so conta quem esta conectado agora, ja estava dentro quando a pergunta abriu e nao foi eliminado
  function elegiveis() {
    return [...jogadores.values()].filter(
      (j) => online(j) && j.entrouEm < jogo.abertaEm && !(jogo.modo === 'battleroyale' && j.eliminado)
    );
  }

  // pergunta curta le rapido, pergunta longa precisa de mais tempo antes das alternativas aparecerem
  function duracaoLeitura(pergunta) {
    const estimativa = LEITURA_MINIMA_MS + pergunta.enunciado.length * LEITURA_MS_POR_CARACTERE;
    return Math.min(LEITURA_MAXIMA_MS, Math.max(LEITURA_MINIMA_MS, estimativa));
  }

  // base cai com o tempo gasto, pergunta de dobro dobra tudo; sequencia nao multiplica mais (so emblema visual)
  function pontuar(pergunta, ms) {
    const fracao = Math.min(ms / (pergunta.tempo * 1000), 1);
    const base = 1000 * (1 - fracao / 2);
    return Math.round(base * (pergunta.dobro ? 2 : 1));
  }

  // pergunta que mais derrubou a turma, pra puxar assunto no fim da aula
  function perguntaMaisErrada() {
    const atual = banco();
    if (!atual) return null;
    const erros = atual.perguntas.map(() => 0);
    jogadores.forEach((j) => {
      j.respostas.forEach((r, i) => {
        if (r === 'X' || r === '-') erros[i] += 1;
      });
    });
    let pior = -1;
    erros.forEach((n, i) => {
      if (n > 0 && (pior === -1 || n > erros[pior])) pior = i;
    });
    return pior === -1 ? null : { enunciado: atual.perguntas[pior].enunciado, erros: erros[pior] };
  }

  function distribuicao() {
    const p = perguntaAtual();
    if (!p) return null;
    const contagem = p.alternativas.map(() => 0);
    elegiveis().forEach((j) => {
      if (j.escolha !== null) contagem[j.escolha] += 1;
    });
    return contagem;
  }

  function maisRapido() {
    const p = perguntaAtual();
    if (!p) return '';
    const certos = elegiveis()
      .filter((j) => j.escolha === p.correta)
      .sort((a, b) => a.respondeuEm - b.respondeuEm);
    return certos.length ? certos[0].nome : '';
  }

  // leva a posicao anterior junto, e o que a tela do host usa pra animar a subida
  function placar() {
    const lista = [...jogadores.values()];
    const ordemAntes = [...lista].sort((a, b) => b.pontosAntes - a.pontosAntes).map((j) => j.id);
    return lista
      .sort((a, b) => b.pontos - a.pontos)
      .map((j, i) => ({
        id: j.id,
        nome: j.nome,
        avatar: j.avatar,
        pontos: j.pontos,
        antes: j.pontosAntes,
        ganhou: j.ganhou,
        sequencia: j.sequencia,
        eliminado: j.eliminado,
        posicao: i + 1,
        posicaoAntes: ordemAntes.indexOf(j.id) + 1
      }));
  }

  function placarEquipes() {
    if (!modoDeTimes(jogo.modo)) return [];
    return jogo.equipes
      .map((nome, i) => {
        const membros = [...jogadores.values()].filter((j) => j.equipe === i);
        return { nome, membros: membros.length, pontos: membros.reduce((soma, j) => soma + j.pontos, 0) };
      })
      .sort((a, b) => b.pontos - a.pontos);
  }

  function estadoHost() {
    const p = perguntaAtual();
    const naRodada =
      jogo.estado === 'pergunta' || jogo.estado === 'resultado'
        ? elegiveis()
        : [...jogadores.values()].filter(online);
    return {
      pin,
      estado: jogo.estado,
      autoAvancar: jogo.autoAvancar,
      modo: jogo.modo,
      equipes: jogo.equipes,
      equipesPlacar: placarEquipes(),
      tema: jogo.tema,
      tituloTema: banco() ? banco().titulo : '',
      jogadores: [...jogadores.values()]
        .filter(online)
        .map((j) => ({ id: j.id, nome: j.nome, avatar: j.avatar, equipe: j.equipe, eliminado: j.eliminado })),
      numero: jogo.indice + 1,
      total: perguntas().length,
      enunciado: p ? p.enunciado : '',
      alternativas: p ? p.alternativas : [],
      correta: jogo.estado === 'resultado' && p ? p.correta : null,
      dobro: !!(p && p.dobro),
      leituraAte: jogo.estado === 'leitura' ? jogo.leituraAte : 0,
      perguntaAte: jogo.estado === 'pergunta' ? jogo.perguntaAte : 0,
      resultadoAte: jogo.estado === 'resultado' ? jogo.resultadoAte : 0,
      distribuicao: jogo.estado === 'resultado' ? distribuicao() : null,
      maisRapido: jogo.estado === 'resultado' ? maisRapido() : '',
      respondidas: naRodada.filter((j) => j.escolha !== null).length,
      conectados: naRodada.length,
      conectadosTotal: [...jogadores.values()].filter(online).length,
      relatorio: !!ultimoRelatorio,
      perguntaDificil: jogo.estado === 'fim' ? perguntaMaisErrada() : null,
      placar: placar()
    };
  }

  function estadoJogador(j) {
    const p = perguntaAtual();
    const ordenados = [...jogadores.values()].sort((a, b) => b.pontos - a.pontos);
    return {
      estado: jogo.estado,
      numero: jogo.indice + 1,
      token: j.token,
      nome: j.nome,
      avatar: j.avatar,
      equipe: j.equipe === null ? '' : jogo.equipes[j.equipe] || '',
      posicao: ordenados.findIndex((x) => x.id === j.id) + 1,
      total: ordenados.length,
      sequencia: j.sequencia,
      dobro: !!(p && p.dobro),
      eliminado: j.eliminado,
      leituraAte: jogo.estado === 'leitura' ? jogo.leituraAte : 0,
      perguntaAte: jogo.estado === 'pergunta' ? jogo.perguntaAte : 0,
      alternativas:
        jogo.estado === 'pergunta' && p && j.entrouEm < jogo.abertaEm && !j.eliminado ? p.alternativas : [],
      escolha: j.escolha,
      acertou: jogo.estado === 'resultado' && p ? j.escolha === p.correta : null,
      ganhou: j.ganhou,
      perdeu: j.perdeu,
      pontos: j.pontos
    };
  }

  function transmitir() {
    const paraHost = estadoHost();
    hosts.forEach((ws) => enviar(ws, paraHost));
    jogadores.forEach((j) => {
      if (online(j)) enviar(j.ws, estadoJogador(j));
    });
  }

  /* ===================== PARTIDA ===================== */

  function gerarRelatorio() {
    const atual = banco();
    if (!atual) return;

    const cabecalho = ['nome', 'equipe', 'pontos', 'acertos', 'total_perguntas', 'maior_sequencia'];
    atual.perguntas.forEach((p, i) => cabecalho.push('p' + (i + 1)));

    const linhas = [cabecalho.join(';')];
    [...jogadores.values()]
      .sort((a, b) => b.pontos - a.pontos)
      .forEach((j) => {
        const campos = [
          j.nome.replace(/;/g, ','),
          j.equipe === null ? '' : jogo.equipes[j.equipe] || '',
          j.pontos,
          j.acertos,
          atual.perguntas.length,
          j.melhorSequencia
        ];
        atual.perguntas.forEach((p, i) => campos.push(j.respostas[i] || '-'));
        linhas.push(campos.join(';'));
      });

    const pior = perguntaMaisErrada();
    if (pior) {
      linhas.push('');
      linhas.push('pergunta que mais derrubou a turma;' + pior.enunciado.replace(/;/g, ',') + ';' + pior.erros + ' erros');
    }

    // BOM na frente, senao o Excel abre acento errado
    const csv = '﻿' + linhas.join('\n') + '\n';
    const carimbo = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
    const nome = 'ping_' + carimbo + '_' + String(jogo.tema).replace(/[:/\\]/g, '_') + '.csv';
    ultimoRelatorio = { nome, csv };

    try {
      fs.mkdirSync(PASTA_RELATORIOS, { recursive: true });
      fs.writeFileSync(path.join(PASTA_RELATORIOS, nome), csv, 'utf8');
      console.log('relatorio salvo em relatorios/' + nome);
    } catch (erro) {
      console.error('nao consegui salvar o relatorio em disco: ' + erro.message);
    }
  }

  function abrirPergunta() {
    clearTimeout(timerResultado);
    timerResultado = null;
    jogo.resultadoAte = 0;

    jogo.indice += 1;
    if (jogo.indice >= perguntas().length) {
      jogo.estado = 'fim';
      gerarRelatorio();
      transmitir();
      return;
    }
    jogadores.forEach((j) => {
      j.pontosAntes = j.pontos; // guarda o valor de onde a animacao do placar sai
      j.escolha = null;
      j.ganhou = 0;
      j.perdeu = 0;
      j.respondeuEm = 0;
    });
    jogo.estado = 'leitura';
    jogo.abertaEm = 0; // so passa a valer quando as alternativas abrirem de verdade
    jogo.leituraAte = Date.now() + duracaoLeitura(perguntaAtual());
    transmitir();
    clearTimeout(timerLeitura);
    timerLeitura = setTimeout(iniciarRespostas, jogo.leituraAte - Date.now());
  }

  // leitura acabou (por tempo ou porque o host pulou): abre pra responder e liga o cronometro
  function iniciarRespostas() {
    clearTimeout(timerLeitura);
    timerLeitura = null;
    if (jogo.estado !== 'leitura') return;
    jogo.estado = 'pergunta';
    jogo.leituraAte = 0;
    jogo.abertaEm = Date.now();
    const p = perguntaAtual();
    clearTimeout(timerPergunta);
    timerPergunta = null;
    if (jogo.autoAvancar) {
      jogo.perguntaAte = jogo.abertaEm + p.tempo * 1000;
      timerPergunta = setTimeout(fecharPergunta, p.tempo * 1000);
    } else {
      jogo.perguntaAte = 0;
    }
    transmitir();
  }

  function fecharPergunta() {
    clearTimeout(timerPergunta);
    timerPergunta = null;
    if (jogo.estado !== 'pergunta') return;
    jogo.perguntaAte = 0;
    jogadores.forEach((j) => {
      if (j.escolha === null) {
        j.sequencia = 0; // ficou sem responder, perde a sequencia
        if (j.entrouEm < jogo.abertaEm) {
          j.respostas[jogo.indice] = '-';
          if (jogo.modo === 'battleroyale') j.eliminado = true;
        }
      }
    });
    jogo.estado = 'resultado';
    clearTimeout(timerResultado);
    timerResultado = null;
    if (jogo.autoAvancar) {
      jogo.resultadoAte = Date.now() + RESULTADO_MS;
      timerResultado = setTimeout(abrirPergunta, RESULTADO_MS);
    } else {
      jogo.resultadoAte = 0;
    }
    transmitir();
  }

  // volta pro comeco sem reiniciar o servico, e libera trocar de tema
  function reiniciar() {
    pararTimers();
    jogo.estado = 'aguardando';
    jogo.tema = null;
    jogo.indice = -1;
    jogo.abertaEm = 0;
    jogo.leituraAte = 0;
    jogo.perguntaAte = 0;
    jogo.resultadoAte = 0;
    jogadores.forEach((j) => {
      j.pontos = 0;
      j.pontosAntes = 0;
      j.ganhou = 0;
      j.perdeu = 0;
      j.escolha = null;
      j.respondeuEm = 0;
      j.sequencia = 0;
      j.melhorSequencia = 0;
      j.acertos = 0;
      j.eliminado = false;
      j.respostas = [];
      j.entrouEm = Date.now();
    });
    transmitir();
  }

  function fecharSeTodosResponderam() {
    const dentro = elegiveis();
    // dentro.length 0 acontece quando o ultimo sobrevivente acabou de ser eliminado
    if (jogo.estado === 'pergunta' && (dentro.length === 0 || dentro.every((j) => j.escolha !== null))) {
      fecharPergunta();
    } else {
      transmitir();
    }
  }

  function receberMensagem(ws, msg) {
    if (msg.tipo === 'tema') {
      if (!hosts.has(ws) || (jogo.estado !== 'aguardando' && jogo.estado !== 'configurando')) return;
      if (!temaExiste(msg.arquivo, ws.professorId)) return;
      jogo.tema = msg.arquivo;
      transmitir();
      return;
    }

    if (msg.tipo === 'modo') {
      if (!hosts.has(ws) || (jogo.estado !== 'aguardando' && jogo.estado !== 'configurando')) return;
      if (!MODOS_VALIDOS.includes(msg.modo)) return;
      jogo.modo = msg.modo;
      jogo.equipes = [];
      jogadores.forEach((j) => {
        j.eliminado = false; // troca de modo comeca do zero
        j.equipe = null;
      });
      transmitir();
      return;
    }

    if (msg.tipo === 'auto_avancar') {
      if (!hosts.has(ws)) return;
      jogo.autoAvancar = !!msg.ativo;
      if (jogo.autoAvancar) {
        // religou no meio da rodada: reaproveita o prazo que ja estava correndo, ou abre um novo pro resultado
        if (jogo.estado === 'pergunta' && !timerPergunta) {
          const p = perguntaAtual();
          const restante = Math.max(0, jogo.abertaEm + p.tempo * 1000 - Date.now());
          jogo.perguntaAte = Date.now() + restante;
          timerPergunta = setTimeout(fecharPergunta, restante);
        } else if (jogo.estado === 'resultado' && !timerResultado) {
          jogo.resultadoAte = Date.now() + RESULTADO_MS;
          timerResultado = setTimeout(abrirPergunta, RESULTADO_MS);
        }
      } else {
        clearTimeout(timerPergunta);
        clearTimeout(timerResultado);
        timerPergunta = null;
        timerResultado = null;
        jogo.perguntaAte = 0;
        jogo.resultadoAte = 0;
      }
      transmitir();
      return;
    }

    if (msg.tipo === 'sortear') {
      if (!hosts.has(ws) || jogo.estado !== 'aguardando' || !modoDeTimes(jogo.modo)) return;
      const lista = [...jogadores.values()].filter(online);
      const tamanho = TAMANHOS_TIME[jogo.modo];
      const quantidade = Math.max(1, Math.ceil(lista.length / tamanho));
      jogo.equipes = Array.from({ length: quantidade }, (nada, i) => (PREFIXO_TIME[jogo.modo] || 'Time') + ' ' + (i + 1));
      for (let i = lista.length - 1; i > 0; i -= 1) {
        const troca = Math.floor(Math.random() * (i + 1));
        [lista[i], lista[troca]] = [lista[troca], lista[i]];
      }
      lista.forEach((jogador, i) => {
        jogador.equipe = i % quantidade; // reparte parelho depois de embaralhar
      });
      transmitir();
      return;
    }

    if (msg.tipo === 'equipe_jogador') {
      if (!hosts.has(ws) || jogo.estado !== 'aguardando' || !modoDeTimes(jogo.modo)) return;
      const j = jogadores.get(String(msg.id || ''));
      if (!j) return;
      const equipe = Number(msg.equipe);
      j.equipe = Number.isInteger(equipe) && equipe >= 0 && equipe < jogo.equipes.length ? equipe : null;
      transmitir();
      return;
    }

    if (msg.tipo === 'entrar_jogador') {
      if (jogo.estado === 'configurando') {
        enviar(ws, { tipo: 'sala_fechada' });
        return;
      }
      const id = String(msg.id || '').slice(0, 40);
      if (!id) return;
      const nome = limparNome(msg.nome);
      const avatar = AVATARES.includes(msg.avatar) ? msg.avatar : AVATARES[0];
      const antigo = jogadores.get(id);
      if (antigo) {
        // id sozinho nao prova posse (aparece pro host); token secreto e quem decide
        if (String(msg.token || '') !== antigo.token) return;
        antigo.ws = ws; // voltou depois de cair, mantem pontos e resposta da rodada
        antigo.nome = nome;
        antigo.avatar = avatar;
      } else {
        if (jogadores.size >= LIMITE_JOGADORES) return; // sala cheia
        jogadores.set(id, {
          id,
          token: crypto.randomBytes(16).toString('hex'),
          nome,
          avatar,
          equipe: null,
          pontos: 0,
          pontosAntes: 0,
          ganhou: 0,
          perdeu: 0,
          escolha: null,
          respondeuEm: 0,
          sequencia: 0,
          melhorSequencia: 0,
          acertos: 0,
          eliminado: false,
          ultimaReacao: 0,
          respostas: [],
          entrouEm: Date.now(),
          ws
        });
      }
      ws.idJogador = id;
      transmitir();
      return;
    }

    if (msg.tipo === 'responder') {
      const j = jogadores.get(ws.idJogador);
      const p = perguntaAtual();
      if (!j || !p || jogo.estado !== 'pergunta' || j.escolha !== null || j.entrouEm > jogo.abertaEm) return;
      if (jogo.modo === 'battleroyale' && j.eliminado) return;
      const i = Number(msg.indice);
      if (!Number.isInteger(i) || i < 0 || i >= p.alternativas.length) return;
      const apostaPct = Math.min(Math.max(Number(msg.aposta) || 0, 0), 100);
      const apostaValor = Math.round(j.pontos * (apostaPct / 100));
      j.escolha = i;
      j.respondeuEm = Date.now() - jogo.abertaEm;
      if (i === p.correta) {
        j.ganhou = pontuar(p, j.respondeuEm) + apostaValor;
        j.pontos += j.ganhou;
        j.sequencia += 1;
        j.melhorSequencia = Math.max(j.melhorSequencia, j.sequencia);
        j.acertos += 1;
        j.respostas[jogo.indice] = 'C';
      } else {
        j.sequencia = 0;
        j.respostas[jogo.indice] = 'X';
        if (apostaValor > 0) {
          j.perdeu = apostaValor;
          j.pontos = Math.max(0, j.pontos - apostaValor);
        }
        if (jogo.modo === 'battleroyale') j.eliminado = true;
      }
      fecharSeTodosResponderam();
      return;
    }

    if (msg.tipo === 'reacao') {
      const j = jogadores.get(ws.idJogador);
      if (!j || !online(j)) return;
      if (!ICONES_REACAO.includes(msg.icone)) return;
      const agora = Date.now();
      if (agora - j.ultimaReacao < REACAO_INTERVALO_MS) return;
      j.ultimaReacao = agora;
      const evento = { tipo: 'reacao', icone: msg.icone, nome: j.nome };
      hosts.forEach((h) => enviar(h, evento));
      return;
    }

    if (msg.tipo === 'proxima') {
      if (!hosts.has(ws)) return;
      if (jogo.estado === 'fim') reiniciar();
      else if (jogo.estado === 'configurando') {
        if (!jogo.tema) return;
        jogo.estado = 'aguardando';
        transmitir();
      } else if (jogo.estado === 'leitura') iniciarRespostas();
      else if (jogo.estado === 'pergunta') fecharPergunta();
      else if (jogo.estado === 'aguardando' && !jogo.tema) return;
      else abrirPergunta();
    }
  }

  function entrarHost(ws) {
    hosts.add(ws);
    enviar(ws, { tipo: 'sala_criada', pin });
    enviar(ws, estadoHost());
  }

  function desconectar(ws) {
    hosts.delete(ws);
    const j = jogadores.get(ws.idJogador);
    if (!j) return;
    if (j.ws === ws) j.ws = null; // guarda os pontos ate ele voltar
    fecharSeTodosResponderam();
  }

  const sala = { pin, professorId, entrarHost, receberMensagem, desconectar, obterRelatorio: () => ultimoRelatorio };
  salas.set(pin, sala);
  return sala;
}

// uma sala persistente por professor: reconectar (recarregar o /host) volta pra mesma sala e pin
function obterOuCriarSalaDoProfessor(professorId) {
  const pinExistente = salaDoProfessor.get(professorId);
  const existente = pinExistente && salas.get(pinExistente);
  if (existente) return existente;
  const sala = criarSala(professorId);
  salaDoProfessor.set(professorId, sala.pin);
  return sala;
}

/* ===================== WEBSOCKET ===================== */

function configurarWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    ws.contador = 0;
    ws.janela = Date.now();
    ws.professorId = professorDaRequisicao(req); // cookie da mesma conexao http que fez o upgrade
    ws.sala = null;

    ws.on('message', (bruto) => {
      // janela deslizante simples: passou do limite, derruba a conexao
      const agora = Date.now();
      if (agora - ws.janela > JANELA_MS) {
        ws.janela = agora;
        ws.contador = 0;
      }
      ws.contador += 1;
      if (ws.contador > LIMITE_MENSAGENS) {
        ws.close(1008, 'excesso de mensagens');
        return;
      }
      if (typeof bruto.length === 'number' && bruto.length > TAMANHO_MAXIMO) return;

      let msg;
      try {
        msg = JSON.parse(bruto);
      } catch {
        return;
      }

      if (msg.tipo === 'ping') return; // so segura a conexao e o servico acordado

      if (msg.tipo === 'entrar_host') {
        if (!ws.professorId) return;
        ws.sala = obterOuCriarSalaDoProfessor(ws.professorId);
        ws.sala.entrarHost(ws);
        return;
      }

      if (!ws.sala) {
        // so entrar_jogador pode abrir sala pra uma conexao ainda sem sala: o pin decide qual
        if (msg.tipo !== 'entrar_jogador') return;
        const pin = String(msg.sala || '').trim().toUpperCase();
        const sala = salas.get(pin);
        if (!sala) {
          enviar(ws, { tipo: 'sala_nao_existe' });
          return;
        }
        ws.sala = sala;
      }

      ws.sala.receberMensagem(ws, msg);
    });

    ws.on('close', () => {
      if (ws.sala) ws.sala.desconectar(ws);
    });
  });

  // proxy corta conexao parada, entao manda quadro de ping de tempos em tempos
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) ws.ping();
    });
  }, 30000);
}

function obterRelatorio(professorId) {
  const pin = salaDoProfessor.get(professorId);
  const sala = pin && salas.get(pin);
  return sala ? sala.obterRelatorio() : null;
}

function pinDoProfessor(professorId) {
  const sala = salaDoProfessor.get(professorId) && salas.get(salaDoProfessor.get(professorId));
  return sala ? sala.pin : null;
}

module.exports = { configurarWebSocket, obterRelatorio, pinDoProfessor };
