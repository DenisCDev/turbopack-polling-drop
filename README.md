# Turbopack polling watcher permanently drops file edits on Windows

<p align="center">
  <img src="assets/mtg-lost-to-legend.jpg" width="640" alt="A legendary blade sinking among weeds and bubbles — art by Kasia Kafis Zielinska, Tales of Middle-earth (2023)">
</p>

> *"Lost to Legend"*, printed in Brazil as **"Perdido para as Lendas"**. Art by Kasia 'Kafis' Zielinska for **Magic: The Gathering**,
> Tales of Middle-earth (2023). The blade sinks and does not come back. That is the bug.

> **[Leia em Português](#portugues)**

A minimal App Router app and one script. With `watchOptions.pollIntervalMs`
set, `next dev` silently and permanently loses file edits. The platform's native
watcher, running the identical edit pattern on the same machine, loses none.

Measured on **native Windows only** — win32/x64, Windows 11, Node 22.22.0,
`next@16.3.1-canary.8`. macOS and Linux were not tested.

Filed as https://github.com/vercel/next.js/issues/96982

## Run it

```bash
npm install

# polling watcher
POLL_MS=1000 SESSIONS=5 EDITS=5 npm run probe

# same edit pattern, native watcher, as a control
POLL_MS=0 SESSIONS=5 EDITS=5 npm run probe
```

PowerShell: `$env:POLL_MS="1000"; $env:SESSIONS="5"; $env:EDITS="5"; node probe.mjs`

Each session removes `.next`, boots a fresh `next dev`, rewrites `lib/mod.ts`
`EDITS` times, and records how long until the served page reflects each new
value — or `X` if it never did within `WINDOW_MS` (default 8000 ms, eight full
poll intervals). Dev server output is kept per session in `probe-logs/`.

## Results

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

Repeated runs of the polling arm gave 15/25, 20/25 and 22/25. The native arm has
not lost an edit in any run.

**The write reaches the disk.** The probe stats the file before and after each
write: mtime advanced on 25/25 writes, including every lost one. The file is 26
bytes in every state, so the size is constant — but a variant that varied the
size on each write lost edits too, so size is not the discriminator.

**The loss is permanent, not slow.** With `WINDOW_MS=90000` — ninety poll
intervals:

```
POLL_MS=1000 SESSIONS=3 EDITS=3 WINDOW_MS=90000 npm run probe

session  1:  712 1103  988
session  2:  590 1026 1016
session  3:  279    X  972

detected: 8/9
```

## The shape: it tracks detection latency, per edit

Losses do not distribute randomly. They follow the latency of the *preceding*
edit:

```
session  4:  665    X  264 1021 1036
             ^fast      ^fast ^settled at the poll interval, no further losses
```

While an edit is reflected in ~200–800 ms — faster than the configured 1000 ms
interval, so apparently not the poll tick — the next edit tends to be lost. Once
latency settles at ~1000 ms, losses stop for the rest of the session. Inserting
idle time between edits (`GAP_MS`) reduces losses for the same reason: it pushes
the spacing past that regime.

Note `GAP_MS` is idle time added *on top of* the previous edit's detection
latency, not the resulting spacing. With `GAP_MS=0` the measured spacing between
writes still ranged from roughly 80 ms to 1200 ms, because detection latency
dominates it.

This is reported as a correlation. What detects a change in 200 ms while polling
is enabled has not been identified.

## `watch error` in the polling arm only

The dev server logs, per session, several failures to establish a watch:

```
watch error (["\\?\<root>\src"]): Io(Os { code: 2, kind: NotFound, ... })
watch error (["\\?\<root>\.next-internal\server\app\page"]): Io(Os { code: 3, kind: NotFound, ... })
watch error (["\\?\<root>\node_modules\@opentelemetry"]): Io(Os { code: 2, kind: NotFound, ... })
```

Seven such paths, once per session, in the polling arm. **Zero** in the native
arm. None of them is the edited file, which exists and is watched, so this may
be unrelated — it is included because it is the only asymmetry visible from
outside Turbopack. (The OS messages are in Portuguese; that is this machine's
locale, not a Next.js string.)

## What this does not establish

The probe observes only that the dev server never serves the new value. It
cannot tell a watcher event that was never emitted from one emitted and not
acted on. There is no instrumentation inside Turbopack here.

It is also intermittent: whether a given session loses anything varies, and a
short run can come back clean. Losses reproduced in every run of 25 observations
attempted.

## Why rapid edits are not a synthetic case

Back-to-back writes are the normal output of format-on-save, `git checkout` and
`merge`, codemods, and CLI coding agents that write several files in a burst
before requesting the page.

## Context

`watchOptions.pollIntervalMs` selects notify's `PollWatcher` instead of the
platform's native backend. It is the fallback for environments where native
watching does not work — Docker, WSL2, network drives, VMs.

The option is **undocumented**: it appears in `config-shared` with no JSDoc, is
absent from `next/dist/docs/`, and the docs PR (#80687) has been open since
2025-06-19. Failures of this kind were reported in #68255 and #69684; #80665
asked how to enable polling at all and was closed by #96440, merged
2026-08-07 22:40 UTC — 44 minutes before `v16.3.1-canary.8` was tagged. So the
build measured here **contains** that fix. (#96288 addressed the same area but
was closed unmerged, superseded by #96440; its code is not in this build.)

---

<a id="portugues"></a>

# O watcher de polling do Turbopack perde edições permanentemente no Windows (PT-BR)

Um app App Router mínimo e um script. Com `watchOptions.pollIntervalMs`
configurado, o `next dev` perde edições de arquivo de forma silenciosa e
permanente. O watcher nativo da plataforma, rodando o padrão de edição
idêntico na mesma máquina, não perde nenhuma.

Medido **apenas em Windows nativo** — win32/x64, Windows 11, Node 22.22.0,
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

Cada sessão remove o `.next`, sobe um `next dev` limpo, reescreve `lib/mod.ts`
`EDITS` vezes e registra quanto tempo até a página servida refletir cada valor
novo — ou `X` se nunca refletiu dentro de `WINDOW_MS` (padrão 8000 ms, oito
intervalos completos de poll). A saída do dev server fica salva por sessão em
`probe-logs/`.

## Resultados

Os blocos numéricos estão na seção em inglês acima — mesmos dados. Resumo:
com polling de 1000 ms, 22/25 edições detectadas (rodadas repetidas deram
15/25 e 20/25); com o watcher nativo, 25/25 em todas as rodadas.

**A escrita chega ao disco.** O probe consulta o arquivo antes e depois de cada
escrita: o mtime avançou em 25/25, inclusive em todas as edições perdidas. Uma
variante que variava o tamanho do arquivo a cada escrita também perdeu edições,
então tamanho não é o discriminador.

**A perda é permanente, não lenta.** Com `WINDOW_MS=90000` — noventa intervalos
de poll — a edição perdida continua perdida (8/9 no bloco da seção em inglês).

## O formato: acompanha a latência de detecção, por edição

As perdas não se distribuem ao acaso: seguem a latência da edição *anterior*.
Enquanto uma edição é refletida em ~200–800 ms — mais rápido que o intervalo
configurado de 1000 ms, portanto aparentemente não é o tick do poll — a edição
seguinte tende a se perder. Quando a latência assenta em ~1000 ms, as perdas
param pelo resto da sessão. Inserir tempo ocioso entre edições (`GAP_MS`)
reduz as perdas pelo mesmo motivo: empurra o espaçamento para fora desse
regime.

Isso é reportado como correlação. O que detecta uma mudança em 200 ms com
polling ligado não foi identificado.

## `watch error` só no braço com polling

O dev server loga, por sessão, sete falhas ao estabelecer watch (código 2/3 do
SO, caminhos em `src`, `.next-internal`, `node_modules`) — **zero** no braço
nativo. Nenhum dos caminhos é o arquivo editado, que existe e é observado;
pode não ter relação — está registrado por ser a única assimetria visível de
fora do Turbopack.

## O que isto não estabelece

O probe só observa que o dev server nunca serve o valor novo. Não distingue um
evento de watcher que nunca foi emitido de um emitido e não processado. Não há
instrumentação dentro do Turbopack aqui.

Também é intermitente: uma rodada curta pode voltar limpa. As perdas
reproduziram em todas as rodadas de 25 observações tentadas.

## Por que edições em rajada não são um caso sintético

Escritas em sequência são a saída normal de format-on-save, `git checkout` e
`merge`, codemods e agentes de código de CLI que escrevem vários arquivos em
rajada antes de pedir a página.

## Contexto

`watchOptions.pollIntervalMs` seleciona o `PollWatcher` do notify em vez do
backend nativo da plataforma. É o fallback para ambientes onde watching nativo
não funciona — Docker, WSL2, drives de rede, VMs.

A opção é **não documentada**: aparece no `config-shared` sem JSDoc, está
ausente de `next/dist/docs/`, e o PR de docs (#80687) está aberto desde
2025-06-19. Falhas desse tipo foram relatadas em #68255 e #69684; o build
medido aqui **contém** o fix do #96440 (detalhes na seção em inglês).
