/* Figurinha com Som: o estilo do painel (vai para dentro do Shadow DOM). */
globalThis.FigSomEstilo = `
:host {
  all: initial;
  --fundo: #ffffff;
  --campo: #f0f2f5;
  --linha: #e3e7ea;
  --texto: #111b21;
  --suave: #5b6b74;
  --verde: #008069;
  --verde-forte: #006b58;
  --no-verde: #ffffff;
  --marcado: #d9fdd3;
  --marcado-texto: #0b4f3f;
  --erro-fundo: #fdecea;
  --erro-texto: #8c1d18;
  --xadrez: #e6eaed;
  --sombra: 0 12px 40px rgba(11, 20, 26, .26), 0 2px 8px rgba(11, 20, 26, .14);
  color-scheme: light;
}
:host(.escuro) {
  --fundo: #1d282f;
  --campo: #121b20;
  --linha: #2c3a42;
  --texto: #e9edef;
  --suave: #98a7af;
  --verde: #00a884;
  --verde-forte: #06cf9c;
  --no-verde: #07150f;
  --marcado: #0b4439;
  --marcado-texto: #d8fff1;
  --erro-fundo: #45201d;
  --erro-texto: #ffcfc9;
  --xadrez: #26333a;
  --sombra: 0 14px 44px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .4);
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input { font: inherit; color: inherit; }
button { border: 0; background: none; padding: 0; cursor: pointer; }
button:disabled { cursor: default; }
:focus-visible { outline: 2px solid var(--verde); outline-offset: 2px; }
svg {
  width: 20px; height: 20px; flex: none;
  fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
}
p, h2 { margin: 0; }

.aba {
  position: fixed; right: 0; top: 50%; z-index: 2147483000;
  width: 42px; height: 50px; margin-top: -25px; display: grid; place-items: center;
  border-radius: 14px 0 0 14px; background: var(--verde); color: var(--no-verde);
  box-shadow: var(--sombra); transition: width .15s;
}
.aba:hover { width: 50px; background: var(--verde-forte); }
.aba svg { width: 24px; height: 24px; }

.painel {
  position: fixed; top: 16px; right: 16px; z-index: 2147483000;
  width: 372px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--fundo); color: var(--texto);
  border: 1px solid var(--linha); border-radius: 16px; box-shadow: var(--sombra);
  font: 14px/1.4 "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif; text-align: left; user-select: none;
}
.painel.recebendo { outline: 3px dashed var(--verde); outline-offset: -8px; }
header { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px 16px; }
h2 { flex: 1; font-size: 15px; font-weight: 600; white-space: nowrap; }
.marca { display: grid; color: var(--verde); }
.marca svg { width: 24px; height: 24px; }
.fechar { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; color: var(--suave); }
.fechar:hover { background: var(--campo); color: var(--texto); }
.corpo { padding: 2px 16px 12px; overflow: auto; overscroll-behavior: contain; min-height: 0; scrollbar-width: thin; }
.vista { display: flex; flex-direction: column; gap: 11px; }
.rodape { padding: 12px 16px 14px; border-top: 1px solid var(--linha); display: flex; flex-direction: column; gap: 8px; }

.aviso {
  margin-bottom: 10px; padding: 9px 12px; border-radius: 10px;
  background: var(--erro-fundo); color: var(--erro-texto); font-size: 13px;
}
.nota { font-size: 12.5px; color: var(--suave); }
.elo { color: var(--verde); font-size: 13px; font-weight: 600; padding: 2px 4px; border-radius: 6px; }
.elo:hover { text-decoration: underline; }

.soltar {
  width: 100%; min-height: 216px; padding: 20px; border-radius: 14px;
  border: 2px dashed var(--linha); background: var(--campo);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  transition: border-color .15s;
}
.soltar:hover, .recebendo .soltar { border-color: var(--verde); }
.soltar svg { width: 34px; height: 34px; margin-bottom: 8px; color: var(--verde); }
.soltar strong { font-size: 16px; font-weight: 600; }
.soltar span { color: var(--suave); }

.abrindo { align-items: center; justify-content: center; min-height: 250px; text-align: center; color: var(--suave); }
.giro {
  width: 34px; height: 34px; border-radius: 50%;
  border: 3px solid var(--linha); border-top-color: var(--verde); animation: giro .8s linear infinite;
}
@keyframes giro { to { transform: rotate(1turn); } }
.progresso { width: 100%; height: 8px; border-radius: 4px; background: var(--campo); overflow: hidden; }
.progresso i { display: block; height: 100%; width: 0; background: var(--verde); border-radius: 4px; transition: width .12s; }

.palco {
  position: relative; width: 236px; height: 236px; margin: 0 auto; border-radius: 14px; overflow: hidden; flex: none;
  background: conic-gradient(var(--xadrez) 25%, transparent 0 50%, var(--xadrez) 0 75%, transparent 0) 0 0 / 20px 20px, var(--campo);
}
.tela { display: block; width: 100%; height: 100%; touch-action: none; }
canvas.tela { cursor: grab; }
canvas.tela:active { cursor: grabbing; }
.palco[data-som] { cursor: pointer; }
.palco-botoes { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; justify-content: space-between; pointer-events: none; }
.redondo {
  width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; pointer-events: auto;
  background: rgba(11, 20, 26, .66); color: #fff;
}
.redondo:hover { background: rgba(11, 20, 26, .86); }

.bloco { display: flex; flex-direction: column; gap: 8px; }
.faixa-caixa { display: flex; flex-direction: column; gap: 4px; }
.faixa { height: 50px; padding: 0 12px; touch-action: none; cursor: pointer; user-select: none; }
.miolo { position: relative; height: 100%; }
.trilho { position: relative; height: 100%; border-radius: 6px; overflow: hidden; background: var(--campo); }
.trilho canvas { display: block; width: 100%; height: 100%; }
.veu { position: absolute; top: 0; bottom: 0; background: var(--fundo); opacity: .72; }
.agulha { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); pointer-events: none; }
.janela { position: absolute; top: 0; bottom: 0; cursor: grab; }
.janela::before { content: ""; position: absolute; inset: 0; border: 2px solid var(--verde); border-left: 0; border-right: 0; }
.janela:active { cursor: grabbing; }
.alca {
  position: absolute; top: 0; bottom: 0; width: 12px; background: var(--verde); cursor: ew-resize; touch-action: none;
}
.alca::after { content: ""; position: absolute; left: 5px; top: 17px; bottom: 17px; width: 2px; border-radius: 1px; background: var(--no-verde); }
.alca.esq { right: 100%; border-radius: 6px 0 0 6px; }
.alca.dir { left: 100%; border-radius: 0 6px 6px 0; }
[data-fixa] .alca { pointer-events: none; width: 4px; }
[data-fixa] .alca::after { display: none; }
.rolagem { margin: 0 12px; }

.duracoes { display: flex; gap: 6px; }
.duracoes button, .segmentos button { border-radius: 9px; background: var(--campo); color: var(--texto); font-size: 13px; }
.duracoes button { flex: 1; padding: 5px 0; }
.segmentos { flex: 1; display: flex; gap: 4px; min-width: 0; }
.segmentos button { flex: 1 1 auto; padding: 6px 6px; white-space: nowrap; }
.duracoes button:hover, .segmentos button:hover:not(:disabled) { box-shadow: inset 0 0 0 1px var(--verde); }
button[aria-pressed="true"] { background: var(--marcado) !important; color: var(--marcado-texto) !important; font-weight: 600; }
.segmentos button:disabled { opacity: .45; }

.dupla { display: flex; gap: 8px; }
.dupla > * { flex: 1; }
.passos { display: flex; align-items: center; gap: 4px; font-size: 13px; }
.passos span { flex: 1; color: var(--suave); }
.passos output { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
.passos button { width: 26px; height: 26px; border-radius: 8px; background: var(--campo); font-size: 15px; line-height: 1; }
.passos button:hover { box-shadow: inset 0 0 0 1px var(--verde); }

.linha { display: flex; align-items: center; gap: 10px; min-height: 30px; }
.rotulo { width: 66px; flex: none; color: var(--suave); font-size: 13px; }
input[type="range"] { flex: 1; min-width: 0; height: 20px; accent-color: var(--verde); cursor: pointer; }
.bloco > .elo { align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 8px; }

.principal, .secundario {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 42px; padding: 0 14px; border-radius: 12px; font-weight: 600; min-width: 0;
}
.principal { background: var(--verde); color: var(--no-verde); }
.principal:hover:not(:disabled) { background: var(--verde-forte); }
.principal:disabled { background: var(--campo); color: var(--suave); }
.secundario { background: var(--campo); min-height: 36px; font-size: 13px; }
.secundario:hover { box-shadow: inset 0 0 0 1px var(--verde); }
.corta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ficha { text-align: center; font-size: 12.5px; color: var(--suave); }
.recibo {
  display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px;
  background: var(--erro-fundo); color: var(--erro-texto); font-size: 13px;
}
.recibo.certo { background: var(--marcado); color: var(--marcado-texto); }
.recibo strong, .recibo span { display: block; }
.recibo span { margin-top: 2px; opacity: .85; font-size: 12.5px; }

@media (max-height: 900px) {
  .palco { width: 204px; height: 204px; }
  .vista { gap: 7px; }
  .bloco { gap: 7px; }
  .faixa { height: 46px; }
  .rodape { padding: 10px 16px 12px; }
}
@media (max-height: 740px) {
  .palco { width: 164px; height: 164px; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation-duration: 2s !important; }
}
`;
