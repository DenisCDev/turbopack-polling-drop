# O watcher de polling do Turbopack perde edições de arquivo permanentemente no Windows

[English](README.md) · **Português**

<p align="center">
  <img src="assets/mtg-lost-to-legend.jpg" width="640" alt="Uma lâmina lendária afundando entre algas e bolhas — arte de Kasia Kafis Zielinska, Tales of Middle-earth (2023)">
</p>

> *"Lost to Legend"*, impressa no Brasil como **"Perdido para as Lendas"**. Arte de Kasia 'Kafis' Zielinska para **Magic: The Gathering**,
> Tales of Middle-earth (2023). A lâmina afunda e não volta. Esse é o bug.

Um app App Router mínimo e um script. Com `watchOptions.pollIntervalMs`
configurado, o `next dev` perde edições de arquivo de forma silenciosa e
permanente. O watcher nativo da plataforma, rodando o mesmo padrão de edição
na mesma máquina, não perde nenhuma.

Medido **apenas no Windows nativo** — win32/x64, Windows 11, Node 22.22.0,
`next@16.3.1-canary.8`. macOS e Linux não foram testados.

Reportado em https://github.com/vercel/next.js/issues/96982

## Como rodar

```bash
npm install

# watcher de polling
POLL_MS=1000 SESSIONS=5 EDITS=5 npm run probe

# mesmo padrão de edição, watcher nativo, como controle
POLL_MS=0 SESSIONS=5 EDITS=5 npm run probe
```

PowerShell: `$env:POLL_MS="1000"; $env:SESSIONS="5"; $env:EDITS="5"; node probe.mjs`

Cada sessão remove `.next`, sobe um `next dev` novo, reescreve `lib/mod.ts`
`EDITS` vezes e registra quanto tempo leva até a página servida refletir cada
valor novo — ou `X` se isso nunca aconteceu dentro de `WINDOW_MS` (padrão
8000 ms, oito intervalos completos de poll). A saída do dev server é guardada
por sessão em `probe-logs/`.

## Resultados

```
watcher=polling 1000ms | 5 sessions x 5 edits | window 8000ms

session  1:  889  763 1028 1044 1053
session  2:  801    X  287 1052 1075
session  3:  691 1021 1037 1029 1060
session  4:  665    X  264 1021 1036
session  5:  739    X  218 1046 1037

detected: 22/25
file mtime advanced on 25/25 writes
```

```
watcher=native | 5 sessions x 5 edits | window 8000ms

session  1:  374   95   75   90   67
session  2:   97   82   74   90   72
session  3:   97   90  397   89  419
session  4:   96   87   78   97   94
session  5:   95  171   75   89   83

detected: 25/25
file mtime advanced on 25/25 writes
```

Execuções repetidas do braço com polling deram 15/25, 20/25 e 22/25. O braço
nativo não perdeu nenhuma edição em nenhuma execução.

**A escrita chega ao disco.** O probe consulta os metadados do arquivo antes e
depois de cada escrita: o mtime avançou em 25/25 escritas, inclusive em todas as
perdidas. O arquivo tem 26 bytes em todos os estados, então o tamanho é
constante — mas uma variante que mudava o tamanho a cada escrita também perdeu
edições, então o tamanho não é o fator determinante.

**A perda é permanente, não lenta.** Com `WINDOW_MS=90000` — noventa intervalos
de poll:

```
POLL_MS=1000 SESSIONS=3 EDITS=3 WINDOW_MS=90000 npm run probe

session  1:  712 1103  988
session  2:  590 1026 1016
session  3:  279    X  972

detected: 8/9
```

## O padrão: acompanha a latência de detecção, edição a edição

As perdas não se distribuem ao acaso. Elas seguem a latência da edição
*anterior*:

```
session  4:  665    X  264 1021 1036
             ^fast      ^fast ^settled at the poll interval, no further losses
```

Enquanto uma edição é refletida em ~200–800 ms — mais rápido que o intervalo
configurado de 1000 ms, portanto aparentemente não é o tick do poll — a edição
seguinte tende a se perder. Quando a latência se estabiliza em ~1000 ms, as
perdas param pelo resto da sessão. Inserir tempo ocioso entre as edições
(`GAP_MS`) reduz as perdas pelo mesmo motivo: leva o espaçamento para fora
desse regime.

Observe que `GAP_MS` é tempo ocioso somado *além* da latência de detecção da
edição anterior, não o espaçamento resultante. Com `GAP_MS=0`, o espaçamento
medido entre as escritas ainda variou de cerca de 80 ms a 1200 ms, porque a
latência de detecção domina esse valor.

Isso é relatado como uma correlação. Ainda não foi identificado o que detecta
uma mudança em 200 ms com o polling ativado.

## `watch error` só no braço com polling

O dev server registra, por sessão, várias falhas ao estabelecer um watch:

```
watch error (["\\?\<root>\src"]): Io(Os { code: 2, kind: NotFound, ... })
watch error (["\\?\<root>\.next-internal\server\app\page"]): Io(Os { code: 3, kind: NotFound, ... })
watch error (["\\?\<root>\node_modules\@opentelemetry"]): Io(Os { code: 2, kind: NotFound, ... })
```

Sete caminhos assim, uma vez por sessão, no braço com polling. **Zero** no
braço nativo. Nenhum deles é o arquivo editado, que existe e é observado, então
isso pode não ter relação — está incluído porque é a única assimetria visível
de fora do Turbopack. (As mensagens do sistema operacional estão em português;
esse é o locale desta máquina, não uma string do Next.js.)

## O que isto não estabelece

O probe observa apenas que o dev server nunca serve o valor novo. Ele não
consegue distinguir um evento do watcher que nunca foi emitido de um que foi
emitido e não foi processado. Não há instrumentação dentro do Turbopack aqui.

O problema também é intermitente: se uma sessão perde alguma edição varia, e uma
execução curta pode voltar limpa. As perdas se reproduziram em todas as
execuções de 25 observações tentadas.

## Por que edições rápidas não são um caso sintético

Escritas em sequência são a saída normal de format-on-save, `git checkout` e
`merge`, codemods e agentes de código de CLI que escrevem vários arquivos de uma
vez antes de pedir a página.

## Contexto

`watchOptions.pollIntervalMs` seleciona o `PollWatcher` do notify em vez do
backend nativo da plataforma. É o fallback para ambientes em que o watching
nativo não funciona — Docker, WSL2, drives de rede, VMs.

A opção **não é documentada**: aparece em `config-shared` sem JSDoc, não está
em `next/dist/docs/`, e o PR de documentação (#80687) está aberto desde
2025-06-19. Falhas desse tipo foram relatadas em #68255 e #69684; #80665
perguntou como ativar o polling e foi fechado pelo #96440, com merge em
2026-08-07 22:40 UTC — 44 minutos antes da tag `v16.3.1-canary.8`. Portanto, o
build medido aqui **contém** essa correção. (O #96288 tratou da mesma área, mas
foi fechado sem merge, substituído pelo #96440; o código dele não está neste
build.)
