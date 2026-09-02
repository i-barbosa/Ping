# Ping

https://ping-gg26.onrender.com

Quiz ao vivo para sala de aula. O professor projeta a tela do host, os alunos entram pelo celular lendo um QR code e respondem em botões grandes e coloridos. Acerto pontua, quem responde mais rápido pontua mais.

Alternativa livre ao Kahoot: sem licença paga, sem limite de participantes. O aluno entra sem conta, só com nome e avatar; o professor precisa de login pra abrir a sala.

## Finalidade

O Ping existe pra dar ao professor uma ferramenta de revisão de conteúdo em tempo real, com toda a turma participando ao mesmo tempo pelo próprio celular, sem depender de plataforma paga ou de criar conta pra cada aluno. A ideia é o professor escolher um tema de perguntas, projetar a tela pra turma toda ver, e conduzir a dinâmica: quem acerta primeiro pontua mais, o placar anima em tempo real, e no fim sai um pódio e um relatório da partida.

## Como funciona

1. O professor faz login em `/entrar` e cai no `/painel`: seus temas em círculo, e cards de ação (`Criar sala`, `Criar tema`, `Baixar relatório`). Clicar num tema ou em `Criar sala` abre uma bolha flutuante pra escolher o tema e o modo — `Solo`, `Duo`, `Squad` ou `Battle Royale`.
2. Escolhido tema e modo, a bolha cria a sala e manda o professor pro `/host`, já com QR e link ativos pra aluno entrar. Quem tenta entrar antes fica esperando e cai na sala sozinho assim que ela abre. `/host` sem sala criada redireciona de volta pro `/painel`.
3. Aluno entra pelo QR, escolhe um nome e um avatar (emoji), e aparece no lobby da projeção conforme entra. Em `Duo` (duplas) ou `Squad` (grupos de 4), `Sortear times` distribui os presentes automaticamente pelo tamanho de time escolhido, e clicar no nome do aluno troca o time dele na mão.
4. `Iniciar`: cada pergunta abre em duas fases. Primeiro só o enunciado aparece na projeção (fase de leitura, com barra de tempo proporcional ao tamanho da pergunta) — dá tempo de ler antes de sair caçando resposta. Depois as alternativas aparecem e o cronômetro de pontuação começa. O professor pode pular a leitura a qualquer momento.
5. Antes de responder, o aluno pode apostar uma % dos pontos que já tem: acerta e ganha o valor apostado a mais, erra e perde esse valor.
6. A pergunta fecha quando todos que estavam na sala responderem, ou o professor encerra antes pelo botão. Em `Battle Royale`, quem errou ou não respondeu sai da rodada e só acompanha o resto da partida.
7. `Resultado`: aparece a alternativa correta, quantos marcaram cada opção, quem acertou primeiro, e o placar anima os pontos e a troca de posições. A projeção mostra o top 3 com avatar e emblema de sequência.
8. A qualquer momento o aluno pode mandar uma reação (emoji), que flutua na tela da projeção.
9. `Próxima pergunta` até acabar o tema. No fim, o pódio é revelado do terceiro para o primeiro, junto com a pergunta que mais derrubou a turma e o link pra baixar o relatório. `Recomeçar` zera os pontos e libera trocar de tema, sem fechar a sala.

Pontuação: acerto vale de 500 a 1000 pontos, caindo conforme a fração do tempo gasta. Pergunta marcada como `dobro` vale o dobro. Acertos seguidos rendem um emblema de sequência (🔥) na tela, mas não multiplicam mais pontos — isso evita que quem acerta tudo dispare sozinho no placar.

## Relatório da partida

No fim de cada partida o Ping gera um CSV com nome, equipe, pontos, acertos, maior sequência e o resultado de cada pergunta (`C` certo, `X` errado, `-` sem resposta), mais qual pergunta mais derrubou a turma. Fica em `relatorios/` na máquina que roda o servidor, e também pode ser baixado pelo link na tela do host. Tem nome de aluno, então é seu — a pasta já está no `.gitignore` pra não subir pro GitHub sem querer.

## Criar um tema

Professor logado pode criar tema direto pelo app, em `/criar-tema` (card "Criar tema" no `/painel`): título, descrição, e quantas perguntas quiser, cada uma com enunciado, de 2 a 6 alternativas, tempo de resposta e se vale o dobro. Fica salvo no Postgres como **pendente**, mas já dá pra usar na hora: quem criou vê o próprio tema pendente (com um selo ⏳) no `/painel` e consegue criar sala com ele normalmente, só que só ele — pra qualquer outro professor da instância ver e usar esse tema, precisa passar pela aprovação de um admin primeiro. Quem criou acompanha o status (`⏳ Em revisão`, `✅ Aprovado`, `❌ Rejeitado`) na lista "Meus temas" da mesma página, e pode editar ou excluir o que é seu a qualquer momento — editar manda de volta pra revisão, mesmo se já estava aprovado. Tema rejeitado para de funcionar até ser corrigido e reenviado.

### Admin

Quem tem a flag `admin` na conta vê o card "Moderar temas" no `/painel` e a página `/admin`: lista todo tema pendente de qualquer professor, com botão pra ver as perguntas, aprovar ou rejeitar. Nenhuma conta nasce admin — a primeira precisa ser promovida direto no Postgres:

```sql
UPDATE professores SET admin = true WHERE email = 'seu-email@exemplo.com';
```

Dali em diante quem já é admin pode continuar administrando só pela UI, sem precisar voltar no banco.

## Como colocar no ar

Quem sobe a instância no Render é o professor (ou quem for administrar a turma) — cada instância atende uma turma por vez, com sua própria conta de login.

Precisa de um Postgres antes do deploy pra guardar as contas de professor (o Postgres do próprio Render expira em 30 dias no plano grátis, então use um separado que não expira):

1. Crie um projeto grátis em [neon.tech](https://neon.tech) ou [supabase.com](https://supabase.com) e copie a connection string (Neon: botão `Connect` → `Direct connection`).
2. Faça um fork deste repositório.
3. Em `render.com`, `New` → `Web Service`, escolha o fork. Com o `render.yaml` do repositório, Runtime/Build/Start Command e a `SESSAO_SEGREDO` já vêm preenchidos sozinhos.
4. Em `Environment`, cole a connection string do passo 1 em `DATABASE_URL`.
5. `Deploy`. Sai um endereço fixo, tipo `https://seu-ping.onrender.com`.

Endereços: login em `/entrar`, painel do professor em `/painel`, moderação (admin) em `/admin`, projeção em `/host`, alunos em `/play` (ou só o QR da tela).

Do plano gratuito do Render: o serviço dorme depois de 15 minutos sem tráfego (abra a tela do host antes da aula pra já estar acordado); reinício ou queda zera a **partida em andamento**, mas não a conta do professor, que fica salva no Postgres.

Pra rodar localmente (testar antes de subir):

```bash
git clone https://github.com/i-barbosa/Ping.git
cd Ping
npm install
cp .env.example .env   # preenche DATABASE_URL com o mesmo Postgres do passo 1
npm start
```

Abre em `http://localhost:3000`. Sem `DATABASE_URL` o servidor nem sobe.

### Variáveis de ambiente

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `PORT` | Porta do servidor | `3000` |
| `DATABASE_URL` | Connection string do Postgres (contas de professor) | obrigatória, sem ela o servidor não sobe |
| `SESSAO_SEGREDO` | Assina o cookie de login. Sem valor fixo, todo mundo desloga a cada reinício | aleatório a cada boot |

## Estrutura

```
Ping/
├── render.yaml
├── package.json
├── .env.example
├── db.js
├── auth.js
├── contas.js
├── temas.js
├── jogo.js
├── server.js
├── quizzes/
│   ├── c.json
│   ├── css.json
│   ├── git.json
│   ├── html.json
│   └── js.json
└── public/
    ├── painel.html
    ├── host.html
    ├── play.html
    ├── entrar.html
    ├── criar-tema.html
    ├── admin.html
    ├── css/
    │   ├── painel.css
    │   ├── host.css
    │   ├── play.css
    │   ├── auth.css
    │   ├── criar-tema.css
    │   └── admin.css
    ├── img/
    │   ├── ping-logo.png
    │   └── ping-logo.svg
    └── js/
        ├── painel.js
        ├── host.js
        ├── play.js
        ├── auth.js
        ├── criar-tema.js
        └── admin.js
```

`server.js` só faz o bootstrap (Express, WebSocket, boot); a lógica fica separada por assunto: `contas.js` (login/cadastro), `temas.js` (banco de perguntas, arquivo e Postgres) e `jogo.js` (estado da partida e toda a troca de mensagens por WebSocket).

Stack: Node com Express, WebSocket pela biblioteca `ws`, Postgres pela `pg`, senha com `bcryptjs`, front em HTML, CSS e JavaScript puro. Sem framework e sem etapa de build.

## Limitações conhecidas

- Uma sala por instância, sem PIN pra várias salas simultâneas
- A partida em si não é salva em banco, o placar vive na memória do servidor
- Aluno não tem conta: pontuação e rank não persistem de uma partida pra outra
- Empate não tem critério de desempate
- Tema criado por um professor fica visível pra qualquer professor logado na mesma instância, não só pra quem criou
- Perguntas e alternativas não são embaralhadas entre turmas

## Próximos passos

- **Multi-sala**: várias salas simultâneas na mesma instância, cada uma com seu PIN, ao invés de uma sala global por deploy
- **Conta de aluno**: login simples (usuário e senha, sem email) pra manter identidade entre partidas
- **Rank global**: contagem de salas vencidas (1º lugar) por aluno, persistindo no mesmo Postgres das contas de professor

## Contribuir

Criar tema pelo app (acima) é pra uso na sua própria instância. Já contribuir um tema pro repositório — via PR, documentado em `CONTRIBUTING.md` — é diferente: passa por revisão antes de virar padrão, e todo mundo que clonar o Ping ganha o tema pronto, sem precisar recriar nada. As duas formas convivem: uma resolve o uso imediato, a outra melhora o projeto pra quem vem depois.

Leia `CONTRIBUTING.md`. Banco de perguntas revisado, correção de texto e melhoria de acessibilidade são as contribuições mais úteis agora.

## Licença

GPL-3.0. Veja `LICENSE`.
