/*
 * Figurinha com Som: o painel.
 *
 * Fica por cima do WhatsApp Web, dentro de um Shadow DOM, para o estilo de um
 * não atrapalhar o do outro. Quem converte é o nucleo.js, quem fala com o
 * WhatsApp é o ponte.js.
 */
(() => {
  'use strict';

  const F = globalThis.FigSom;
  const CANAL = 'figurinha-com-som';
  const ID = 'figurinha-com-som';
  document.getElementById(ID)?.remove();

  const LIMITES = { nitida: 950_000, leve: 490_000 };
  const MIN = 0.5;
  const MAX = 30;
  const OFICIAL = { video: 5, imagem: 10 };
  const VISTA_MAX = 45;

  // -------------------------------------------------------------- utilidades

  const SVG = 'http://www.w3.org/2000/svg';

  function el(tag, props = {}, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (typeof v === 'boolean' && k in n) n[k] = v;
      else n.setAttribute(k, v);
    }
    n.append(...filhos.filter((f) => f !== null && f !== undefined));
    return n;
  }

  function icone(...tracos) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of tracos) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  const ICONES = {
    figurinha: ['M14 20H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7l-6 6Z', 'M14 20v-3a3 3 0 0 1 3-3h3', 'M8.5 13.5v-3M11.5 15V9M14.5 12.5v-1.5'],
    fechar: ['M6 6l12 12M18 6L6 18'],
    subir: ['M12 16V5M7.5 9.5L12 5l4.5 4.5', 'M5 15v2.5A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V15'],
    som: ['M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z', 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11'],
    mudo: ['M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z', 'M16 9.5l5 5M21 9.5l-5 5'],
    tocar: ['M8 5.5v13l10.5-6.5L8 5.5Z'],
    pausar: ['M8.5 5.5v13M15.5 5.5v13'],
    enviar: ['M4 12l16-7-5 15-3.5-6L4 12Z'],
    baixar: ['M12 5v10M7.5 10.5L12 15l4.5-4.5', 'M5 19h14'],
    voltar: ['M10 6l-6 6 6 6M4 12h16'],
    certo: ['M5 12.5l4.5 4.5L19 7.5'],
  };

  const tempo = (s) => {
    const d = Math.round(s * 10);
    const m = Math.floor(d / 600);
    const resto = d - m * 600;
    return `${m}:${String(Math.floor(resto / 10)).padStart(2, '0')},${resto % 10}`;
  };
  const segundos = (s) => `${(Math.round(s * 10) / 10).toFixed(1).replace('.', ',')} s`;
  const peso = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(2).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

  // ------------------------------------------------------- conversa com a ponte

  let numeroPedido = 0;
  const esperando = new Map();

  function aoReceber(ev) {
    const m = ev.data;
    if (ev.source !== window || m?.canal !== CANAL || m.de !== 'ponte') return;
    const p = esperando.get(m.id);
    if (!p) return;
    esperando.delete(m.id);
    clearTimeout(p.fim);
    if (m.ok) p.ok(m.valor);
    else p.erro(new Error(m.erro));
  }
  window.addEventListener('message', aoReceber);

  function pedir(pedido, dados, limite) {
    return new Promise((ok, erro) => {
      const id = `${Date.now()}-${++numeroPedido}`;
      const fim = setTimeout(() => {
        esperando.delete(id);
        erro(new Error('O WhatsApp Web não respondeu. Recarregue a página e tente de novo.'));
      }, limite);
      esperando.set(id, { ok, erro, fim });
      window.postMessage({ canal: CANAL, de: 'painel', id, pedido, dados }, location.origin);
    });
  }

  // ------------------------------------------------------------------- estado

  const est = {
    fonte: null,
    corte: { inicio: 0, fim: 0 },
    quadro: { modo: 'preencher', zoom: 1, cx: 0.5, cy: 0.5, forma: 'quadrada' },
    som: { tipo: 'nenhum', doVideo: null, arquivo: null, inicio: 0, fim: 0, volume: 1 },
    tamanho: 'nitida',
    resultado: null,
    conversa: null,
    pronto: false,
    ocupado: false,
  };

  const duracaoDoCorte = () => est.corte.fim - est.corte.inicio;

  /** De onde sai o som da figurinha, no formato que o núcleo entende. */
  function somEscolhido() {
    const { som, fonte } = est;
    if (som.tipo === 'video' && som.doVideo) {
      return { buffer: som.doVideo, inicio: est.corte.inicio, duracao: duracaoDoCorte(), volume: som.volume };
    }
    if (som.tipo === 'arquivo' && som.arquivo) {
      const duracao = fonte.tipo === 'video' ? duracaoDoCorte() : som.fim - som.inicio;
      return { buffer: som.arquivo.buffer, inicio: som.inicio, duracao, volume: som.volume };
    }
    return null;
  }

  // ------------------------------------------------------------ faixa de corte

  function picos(buffer, inicio, fim, n) {
    const dados = buffer.getChannelData(0);
    const saida = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor((inicio + ((fim - inicio) * i) / n) * buffer.sampleRate);
      const b = Math.floor((inicio + ((fim - inicio) * (i + 1)) / n) * buffer.sampleRate);
      const passo = Math.max(1, Math.floor((b - a) / 96));
      let maior = 0;
      for (let j = Math.max(0, a); j < b && j < dados.length; j += passo) {
        const v = Math.abs(dados[j]);
        if (v > maior) maior = v;
      }
      saida[i] = maior;
    }
    return saida;
  }

  class Faixa {
    constructor({ nome, aoMudar }) {
      this.aoMudar = aoMudar;
      this.total = 1;
      this.vista = { inicio: 0, fim: 1 };
      this.corte = { inicio: 0, fim: 1 };
      this.max = MAX;
      this.miniaturas = [];
      this.buffer = null;
      this.cor = '#ffffff';

      const alca = (lado, rotulo) =>
        el('div', { class: `alca ${lado}`, role: 'slider', tabindex: '0', 'aria-label': `${rotulo} ${nome}` });
      this.esq = alca('esq', 'Começo');
      this.dir = alca('dir', 'Fim');
      this.tela = el('canvas');
      this.veuE = el('div', { class: 'veu' });
      this.veuD = el('div', { class: 'veu' });
      this.janela = el('div', { class: 'janela' }, this.esq, this.dir);
      this.agulha = el('div', { class: 'agulha' });
      this.trilho = el('div', { class: 'trilho' }, this.tela, this.veuE, this.veuD, this.agulha);
      this.barra = el('div', { class: 'faixa' }, el('div', { class: 'miolo' }, this.trilho, this.janela));
      this.rolagem = el('input', { type: 'range', min: '0', step: '0.1', class: 'rolagem', 'aria-label': `Posição ${nome}` });
      this.raiz = el('div', { class: 'faixa-caixa' }, this.barra, this.rolagem);

      this.barra.addEventListener('pointerdown', (e) => this.agarrar(e));
      this.rolagem.addEventListener('input', () => {
        const largura = this.vista.fim - this.vista.inicio;
        const inicio = Number(this.rolagem.value);
        this.vista = { inicio, fim: inicio + largura };
        const tam = this.corte.fim - this.corte.inicio;
        const novo = F.limitar(this.corte.inicio, inicio, Math.max(inicio, inicio + largura - tam));
        this.mudar({ inicio: novo, fim: novo + tam }, 'mover', false);
        this.aoRolar?.();
      });
      this.rolagem.addEventListener('change', () => this.aoMudar(this.corte, 'mover', true));
      for (const [alvo, ponta] of [[this.esq, 'inicio'], [this.dir, 'fim']]) {
        alvo.addEventListener('keydown', (e) => {
          const passo = { ArrowLeft: -0.1, ArrowRight: 0.1, ArrowDown: -0.1, ArrowUp: 0.1 }[e.key];
          if (!passo) return;
          e.preventDefault();
          this.empurrar(ponta, passo * (e.shiftKey ? 10 : 1));
        });
      }
    }

    /** Muda uma ponta (ou move tudo) respeitando os limites. */
    ajustar(corte, modo) {
      const c = { ...corte };
      const menor = Math.min(MIN, this.total);
      if (modo === 'inicio') c.inicio = F.limitar(c.inicio, Math.max(0, c.fim - this.max), c.fim - menor);
      else if (modo === 'fim') c.fim = F.limitar(c.fim, c.inicio + menor, Math.min(this.total, c.inicio + this.max));
      else {
        const tam = Math.min(c.fim - c.inicio, this.total);
        c.inicio = F.limitar(c.inicio, 0, this.total - tam);
        c.fim = c.inicio + tam;
      }
      return c;
    }

    mudar(corte, modo, acabou) {
      this.corte = this.ajustar(corte, modo);
      this.posicionar();
      this.aoMudar(this.corte, modo, acabou);
    }

    empurrar(ponta, passo) {
      const c = { ...this.corte };
      if (ponta === 'mover') {
        c.inicio += passo;
        c.fim += passo;
      } else c[ponta] += passo;
      this.mudar(c, ponta, true);
    }

    agarrar(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const caixa = this.trilho.getBoundingClientRect();
      const largura = this.vista.fim - this.vista.inicio;
      const em = (x) => this.vista.inicio + ((x - caixa.left) / caixa.width) * largura;
      const fixa = this.raiz.hasAttribute('data-fixa');
      let modo = 'mover';
      if (!fixa && e.target === this.esq) modo = 'inicio';
      if (!fixa && e.target === this.dir) modo = 'fim';
      const tam = this.corte.fim - this.corte.inicio;
      let folga = em(e.clientX) - (modo === 'fim' ? this.corte.fim : this.corte.inicio);
      if (modo === 'mover' && (folga < 0 || folga > tam)) {
        folga = tam / 2;
        this.mudar({ inicio: em(e.clientX) - folga, fim: em(e.clientX) + folga }, 'mover', false);
      }
      this.barra.setPointerCapture(e.pointerId);
      const mover = (ev) => {
        const t = em(ev.clientX) - folga;
        if (modo === 'mover') this.mudar({ inicio: t, fim: t + tam }, modo, false);
        else this.mudar({ ...this.corte, [modo]: t }, modo, false);
      };
      const soltar = () => {
        this.barra.removeEventListener('pointermove', mover);
        this.barra.removeEventListener('pointerup', soltar);
        this.barra.removeEventListener('pointercancel', soltar);
        this.aoMudar(this.corte, modo, true);
      };
      this.barra.addEventListener('pointermove', mover);
      this.barra.addEventListener('pointerup', soltar);
      this.barra.addEventListener('pointercancel', soltar);
    }

    definir({ total, corte, fixa = false, max = MAX }) {
      this.total = total;
      this.max = max;
      this.corte = { ...corte };
      this.raiz.toggleAttribute('data-fixa', fixa);
      const largura = Math.min(total, VISTA_MAX);
      const inicio = F.limitar(corte.inicio - (largura - (corte.fim - corte.inicio)) / 2, 0, total - largura);
      this.vista = { inicio, fim: inicio + largura };
      this.rolagem.hidden = total <= VISTA_MAX;
      this.rolagem.max = String(total - largura);
      this.rolagem.value = String(inicio);
      this.posicionar();
      this.pintar();
    }

    posicionar() {
      const largura = this.vista.fim - this.vista.inicio;
      const pct = (t) => F.limitar(((t - this.vista.inicio) / largura) * 100, 0, 100);
      const a = pct(this.corte.inicio);
      const b = pct(this.corte.fim);
      this.janela.style.left = `${a}%`;
      this.janela.style.width = `${b - a}%`;
      this.veuE.style.left = '0';
      this.veuE.style.width = `${a}%`;
      this.veuD.style.left = `${b}%`;
      this.veuD.style.width = `${100 - b}%`;
      for (const [alvo, t] of [[this.esq, this.corte.inicio], [this.dir, this.corte.fim]]) {
        alvo.setAttribute('aria-valuemin', '0');
        alvo.setAttribute('aria-valuemax', this.total.toFixed(1));
        alvo.setAttribute('aria-valuenow', t.toFixed(1));
        alvo.setAttribute('aria-valuetext', tempo(t));
      }
    }

    apontar(t) {
      const largura = this.vista.fim - this.vista.inicio;
      const p = ((t - this.vista.inicio) / largura) * 100;
      this.agulha.hidden = !(p >= 0 && p <= 100);
      this.agulha.style.left = `${p}%`;
    }

    pintar() {
      const escala = Math.max(1, devicePixelRatio || 1);
      const w = this.trilho.clientWidth;
      const h = this.trilho.clientHeight;
      if (!w || !h) return;
      this.tela.width = Math.round(w * escala);
      this.tela.height = Math.round(h * escala);
      const ctx = this.tela.getContext('2d');
      ctx.scale(escala, escala);
      for (const m of this.miniaturas) ctx.drawImage(m.bitmap, m.x, 0, m.w, h);
      if (!this.buffer) return;
      if (this.miniaturas.length) {
        const sombra = ctx.createLinearGradient(0, h * 0.25, 0, h);
        sombra.addColorStop(0, 'rgba(0,0,0,0)');
        sombra.addColorStop(1, 'rgba(0,0,0,.72)');
        ctx.fillStyle = sombra;
        ctx.fillRect(0, 0, w, h);
      }
      const n = Math.floor(w / 3);
      const alturas = picos(this.buffer, this.vista.inicio, this.vista.fim, n);
      const baixa = this.miniaturas.length > 0;
      ctx.fillStyle = this.cor;
      for (let i = 0; i < n; i++) {
        const tam = Math.max(2, alturas[i] * (baixa ? h * 0.62 : h * 0.84));
        ctx.fillRect(i * 3, baixa ? h - 3 - tam : (h - tam) / 2, 2, tam);
      }
    }
  }

  // -------------------------------------------------------------- prévia viva

  const tela = el('canvas', { class: 'tela', width: '520', height: '520' });
  const ctxTela = tela.getContext('2d');

  const previa = {
    video: null,
    audio: new Audio(),
    tocando: false,
    mudo: false,
    mudoForcado: false,
    raf: 0,
    preso: null, // instante fixo, enquanto a pessoa arrasta uma ponta do corte

    carregar(fonte) {
      this.descarregar();
      if (fonte.tipo === 'video') {
        this.video = F.novoVideo(fonte.url);
        this.video.addEventListener('loadeddata', () => this.reiniciar(), { once: true });
      }
      this.tocando = true;
      this.laco();
    },
    descarregar() {
      cancelAnimationFrame(this.raf);
      this.video?.pause();
      this.video?.removeAttribute('src');
      this.video = null;
      this.audio.pause();
      this.tocando = false;
      this.preso = null;
    },
    pausar() {
      this.tocando = false;
      this.video?.pause();
      this.audio.pause();
      atualizarPalco();
    },
    tocar() {
      this.tocando = true;
      this.reiniciar();
      atualizarPalco();
    },
    ajustarSom() {
      const { som, fonte } = est;
      const doVideo = som.tipo === 'video' && !this.mudo;
      if (this.video) {
        this.video.muted = !doVideo;
        this.video.volume = som.volume;
      }
      this.audio.volume = som.volume;
      const usaArquivo = som.tipo === 'arquivo' && som.arquivo && !this.mudo && fonte;
      if (!usaArquivo) this.audio.pause();
      else if (this.audio.src !== som.arquivo.url) this.audio.src = som.arquivo.url;
      return Boolean(usaArquivo);
    },
    reiniciar() {
      this.preso = null;
      const usaArquivo = this.ajustarSom();
      if (this.video) {
        this.video.currentTime = est.corte.inicio;
        if (this.tocando) {
          this.video.play().catch((e) => {
            // O navegador só libera som depois de um clique: toca mudo até lá.
            if (e.name !== 'NotAllowedError' || !this.video) return;
            this.mudo = true;
            this.mudoForcado = true;
            this.ajustarSom();
            this.video.play().catch(() => {});
            atualizarPalco();
          });
        }
      }
      if (usaArquivo) {
        this.audio.currentTime = est.som.inicio;
        if (this.tocando) this.audio.play().catch(() => {});
      }
    },
    mostrar(t) {
      this.preso = t;
      this.video?.pause();
      this.audio.pause();
      if (this.video && !this.video.seeking) this.video.currentTime = Math.max(0, t);
    },
    laco() {
      const passo = () => {
        this.raf = requestAnimationFrame(passo);
        const { fonte, corte, som } = est;
        if (!fonte || vistas.editor.hidden || painel.hidden) return;
        const lado = tela.width;
        if (this.video) {
          const v = this.video;
          if (this.preso !== null && !v.seeking && Math.abs(v.currentTime - this.preso) > 0.04) v.currentTime = Math.max(0, this.preso);
          if (this.tocando && this.preso === null && !v.seeking && (v.currentTime >= corte.fim || v.currentTime < corte.inicio - 0.3 || v.ended)) this.reiniciar();
          if (v.readyState >= 2) F.desenhar(ctxTela, v, fonte, est.quadro, lado);
          faixaVideo.apontar(v.currentTime);
          if (som.tipo === 'arquivo') faixaSom.apontar(som.inicio + (v.currentTime - corte.inicio));
        } else {
          F.desenhar(ctxTela, fonte.agora(performance.now() / 1000), fonte, est.quadro, lado);
          if (som.tipo === 'arquivo' && som.arquivo) {
            if (this.tocando && (this.audio.currentTime >= som.fim || this.audio.ended)) this.reiniciar();
            faixaSom.apontar(this.audio.currentTime);
          }
        }
      };
      this.raf = requestAnimationFrame(passo);
    },
  };

  // --------------------------------------------------------------- componentes

  function segmentos(nome, opcoes, aoEscolher) {
    const raiz = el('div', { class: 'segmentos', role: 'group', 'aria-label': nome });
    const botoes = opcoes.map(([valor, rotulo]) => {
      const b = el('button', { type: 'button', 'data-valor': valor, onclick: () => aoEscolher(valor) }, rotulo);
      raiz.append(b);
      return b;
    });
    return {
      raiz,
      marcar: (valor) => botoes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === valor))),
      mostrar: (valor, sim) => (botoes.find((b) => b.dataset.valor === valor).hidden = !sim),
      travar: (valor, sim) => (botoes.find((b) => b.dataset.valor === valor).disabled = sim),
    };
  }

  function deslizante(nome, { min, max, passo }, aoMudar) {
    const n = el('input', { type: 'range', min, max, step: passo, 'aria-label': nome, oninput: () => aoMudar(Number(n.value)) });
    return n;
  }

  const linha = (rotulo, ...conteudo) => el('div', { class: 'linha' }, el('span', { class: 'rotulo' }, rotulo), ...conteudo);

  function passos(nome, aoEmpurrar) {
    const valor = el('output');
    const botao = (sinal, rotulo) =>
      el('button', { type: 'button', 'aria-label': `${nome}: ${rotulo}`, onclick: (e) => aoEmpurrar((e.shiftKey ? 1 : 0.1) * sinal) }, sinal < 0 ? '−' : '+');
    return { raiz: el('div', { class: 'passos' }, el('span', {}, nome), botao(-1, 'menos'), valor, botao(1, 'mais')), valor };
  }

  // ------------------------------------------------------------ montagem da tela

  const seletorVideo = el('input', { type: 'file', accept: 'video/*,image/*', hidden: true });
  const seletorSom = el('input', { type: 'file', accept: 'audio/*,video/*', hidden: true });
  seletorVideo.addEventListener('change', () => {
    if (seletorVideo.files[0]) abrir(seletorVideo.files[0]);
    seletorVideo.value = '';
  });
  seletorSom.addEventListener('change', () => {
    if (seletorSom.files[0]) abrirSom(seletorSom.files[0]);
    seletorSom.value = '';
  });

  const aviso = el('div', { class: 'aviso', role: 'alert', hidden: true });
  const avisar = (texto) => {
    aviso.textContent = texto ?? '';
    aviso.hidden = !texto;
  };

  // vazio
  const vistaVazia = el(
    'div',
    { class: 'vista vazia' },
    el(
      'button',
      { type: 'button', class: 'soltar', onclick: () => seletorVideo.click() },
      icone(...ICONES.subir),
      el('strong', {}, 'Solte um vídeo aqui'),
      el('span', {}, 'ou clique para escolher'),
    ),
    el('p', { class: 'nota' }, 'Também aceita imagem ou GIF, com um áudio à parte. Nada sai do seu computador até você clicar em enviar.'),
  );

  const vistaAbrindo = el('div', { class: 'vista abrindo', hidden: true }, el('div', { class: 'giro' }), el('p', {}, 'Abrindo o arquivo...'));

  // editor
  const botaoTocar = el('button', { type: 'button', class: 'redondo', onclick: () => (previa.tocando ? previa.pausar() : previa.tocar()) });
  const botaoMudo = el('button', {
    type: 'button',
    class: 'redondo',
    onclick: () => {
      previa.mudo = !previa.mudo;
      previa.mudoForcado = false;
      previa.ajustarSom();
      if (previa.tocando) previa.reiniciar();
      atualizarPalco();
    },
  });
  const palco = el('div', { class: 'palco' }, tela, el('div', { class: 'palco-botoes' }, botaoTocar, botaoMudo));

  const faixaVideo = new Faixa({
    nome: 'do vídeo',
    aoMudar(corte, modo, acabou) {
      est.corte = { ...corte };
      if (est.som.tipo === 'arquivo') arrumarSomDoArquivo();
      if (acabou) previa.reiniciar();
      else previa.mostrar(modo === 'fim' ? corte.fim - 0.05 : corte.inicio);
      atualizarTempos();
    },
  });
  faixaVideo.aoRolar = () => {
    faixaVideo.pintar();
    clearTimeout(faixaVideo.espera);
    faixaVideo.espera = setTimeout(pintarFilme, 250);
  };

  const faixaSom = new Faixa({
    nome: 'do som',
    aoMudar(corte, _modo, acabou) {
      est.som.inicio = corte.inicio;
      est.som.fim = corte.fim;
      if (acabou) previa.reiniciar();
      atualizarTempos();
    },
  });
  faixaSom.aoRolar = () => faixaSom.pintar();
  faixaSom.cor = '#00a884';

  const duracoes = el(
    'div',
    { class: 'duracoes', role: 'group', 'aria-label': 'Duração' },
    ...[['3 s', 3], ['5 s', 5], ['10 s', 10], ['Tudo', Infinity]].map(([rotulo, s]) =>
      el('button', { type: 'button', 'data-s': String(s), onclick: () => usarDuracao(s) }, rotulo),
    ),
  );
  const passoInicio = passos('Começo', (d) => faixaAtiva().empurrar('mover', d));
  const passoFim = passos('Fim', (d) => faixaAtiva().empurrar('fim', d));
  const notaTempo = el('p', { class: 'nota', hidden: true });
  const blocoTempo = el('div', { class: 'bloco' }, faixaVideo.raiz, duracoes, el('div', { class: 'dupla' }, passoInicio.raiz, passoFim.raiz), notaTempo);

  const segModo = segmentos('Enquadramento', [['preencher', 'Preencher'], ['inteiro', 'Inteiro']], (v) => {
    Object.assign(est.quadro, { modo: v, zoom: 1, cx: 0.5, cy: 0.5 });
    atualizar();
  });
  const zoom = deslizante('Zoom', { min: 1, max: 4, passo: 0.01 }, (v) => {
    est.quadro.zoom = v;
  });
  const segForma = segmentos('Formato', [['quadrada', 'Quadrado'], ['arredondada', 'Arredondado'], ['redonda', 'Círculo']], (v) => {
    est.quadro.forma = v;
    atualizar();
  });
  const segSom = segmentos('Som', [['video', 'Do vídeo'], ['arquivo', 'Outro áudio'], ['nenhum', 'Sem som']], (v) => {
    if (v === 'arquivo' && !est.som.arquivo) return seletorSom.click();
    usarSom(v);
  });
  const volume = deslizante('Volume', { min: 0.05, max: 1, passo: 0.01 }, (v) => {
    est.som.volume = v;
    previa.ajustarSom();
  });
  const nomeSom = el('button', { type: 'button', class: 'elo', onclick: () => seletorSom.click() });
  const blocoSom = el('div', { class: 'bloco' }, faixaSom.raiz, nomeSom);
  const linhaVolume = linha('Volume', volume);
  const segTamanho = segmentos('Tamanho', [['nitida', 'Nítida (1 MB)'], ['leve', 'Leve (500 KB)']], (v) => {
    est.tamanho = v;
    atualizar();
  });

  const botaoCriar = el('button', { type: 'button', class: 'principal', onclick: criar }, icone(...ICONES.figurinha), 'Criar figurinha');
  const vistaEditor = el(
    'div',
    { class: 'vista', hidden: true },
    palco,
    blocoTempo,
    linha('Enquadrar', segModo.raiz),
    linha('Zoom', zoom),
    linha('Formato', segForma.raiz),
    linha('Som', segSom.raiz),
    blocoSom,
    linhaVolume,
    linha('Tamanho', segTamanho.raiz),
  );

  // criando
  const barraProgresso = el('i');
  const textoProgresso = el('p', {}, '');
  let controle = null;
  const vistaCriando = el(
    'div',
    { class: 'vista abrindo', hidden: true },
    el('div', { class: 'progresso' }, barraProgresso),
    textoProgresso,
    el('button', { type: 'button', class: 'secundario', onclick: () => controle?.abort() }, 'Cancelar'),
  );

  // pronto
  const imagemPronta = el('img', { class: 'tela', alt: 'A figurinha pronta', draggable: 'false' });
  const somPronto = new Audio();
  const botaoOuvir = el('button', { type: 'button', class: 'redondo', onclick: ouvirPronta });
  const palcoPronto = el('div', { class: 'palco', onclick: ouvirPronta }, imagemPronta, el('div', { class: 'palco-botoes' }, botaoOuvir));
  const fichaPronta = el('p', { class: 'ficha' });
  const reciboPronto = el('div', { class: 'recibo', role: 'status', hidden: true });
  const botaoEnviar = el('button', { type: 'button', class: 'principal', onclick: enviar });
  const vistaPronta = el('div', { class: 'vista', hidden: true }, palcoPronto, fichaPronta, reciboPronto);
  somPronto.addEventListener('ended', atualizarOuvir);
  somPronto.addEventListener('pause', atualizarOuvir);
  somPronto.addEventListener('play', atualizarOuvir);

  const vistas = { vazia: vistaVazia, abrindo: vistaAbrindo, editor: vistaEditor, criando: vistaCriando, pronta: vistaPronta };

  const rodapeEditor = el('div', { class: 'rodape', hidden: true }, botaoCriar);
  const rodapePronto = el(
    'div',
    { class: 'rodape', hidden: true },
    botaoEnviar,
    el(
      'div',
      { class: 'dupla' },
      el('button', { type: 'button', class: 'secundario', onclick: () => mostrar('editor') }, icone(...ICONES.voltar), 'Ajustar'),
      el('button', { type: 'button', class: 'secundario', onclick: baixar }, icone(...ICONES.baixar), 'Baixar'),
    ),
  );

  const botaoTrocar = el('button', { type: 'button', class: 'elo', hidden: true, onclick: () => seletorVideo.click() }, 'Trocar vídeo');
  const painel = el(
    'section',
    { class: 'painel', role: 'dialog', 'aria-label': 'Figurinha com som', hidden: true },
    el(
      'header',
      {},
      el('span', { class: 'marca' }, icone(...ICONES.figurinha)),
      el('h2', {}, 'Figurinha com som'),
      botaoTrocar,
      el('button', { type: 'button', class: 'fechar', 'aria-label': 'Fechar', onclick: () => alternar(false) }, icone(...ICONES.fechar)),
    ),
    el('div', { class: 'corpo' }, aviso, ...Object.values(vistas)),
    rodapeEditor,
    rodapePronto,
    seletorVideo,
    seletorSom,
  );
  const aba = el('button', { type: 'button', class: 'aba', title: 'Figurinha com som', 'aria-label': 'Abrir Figurinha com som', onclick: () => alternar(true) }, icone(...ICONES.figurinha));

  // -------------------------------------------------------------- comportamento

  function mostrar(qual) {
    for (const [nome, v] of Object.entries(vistas)) v.hidden = nome !== qual;
    rodapeEditor.hidden = qual !== 'editor';
    rodapePronto.hidden = qual !== 'pronta';
    botaoTrocar.hidden = qual !== 'editor' && qual !== 'pronta';
    if (qual !== 'pronta') somPronto.pause();
    if (qual === 'editor') {
      previa.tocar();
      requestAnimationFrame(() => {
        faixaVideo.pintar();
        faixaSom.pintar();
      });
    } else if (est.fonte) previa.pausar();
    est.vista = qual;
    atualizar();
  }

  const faixaAtiva = () => (est.fonte?.tipo === 'video' ? faixaVideo : faixaSom);

  function usarDuracao(s) {
    const faixa = faixaAtiva();
    const c = faixa.corte;
    const tam = Math.min(s, faixa.total, MAX);
    const inicio = F.limitar(c.inicio, 0, faixa.total - tam);
    faixa.corte = { inicio, fim: inicio + tam };
    faixa.posicionar();
    faixa.aoMudar(faixa.corte, 'mover', true);
  }

  /** Com vídeo, o trecho do áudio à parte tem sempre a mesma duração do vídeo. */
  function arrumarSomDoArquivo() {
    const { som, fonte } = est;
    if (!som.arquivo || !fonte) return;
    const total = som.arquivo.buffer.duration;
    if (fonte.tipo === 'video') {
      const tam = Math.min(duracaoDoCorte(), total);
      som.inicio = F.limitar(som.inicio, 0, total - tam);
      som.fim = som.inicio + tam;
    } else {
      som.inicio = F.limitar(som.inicio, 0, Math.max(0, total - MIN));
      som.fim = F.limitar(som.fim, som.inicio + Math.min(MIN, total), Math.min(total, som.inicio + MAX));
    }
    faixaSom.definir({ total, corte: { inicio: som.inicio, fim: som.fim }, fixa: fonte.tipo === 'video' });
  }

  function usarSom(tipo) {
    est.som.tipo = tipo;
    if (tipo === 'arquivo') arrumarSomDoArquivo();
    atualizar();
    if (tipo === 'arquivo') requestAnimationFrame(() => faixaSom.pintar());
    previa.reiniciar();
  }

  async function abrirSom(arquivo) {
    avisar(null);
    if (!est.fonte) return avisar('Escolha primeiro o vídeo ou a imagem, depois o áudio.');
    const buffer = await F.decodificarSom(arquivo);
    if (!buffer) return avisar('Não consegui ler o som deste arquivo. Use MP3, M4A, OGG, WAV ou um vídeo com som.');
    if (est.som.arquivo) URL.revokeObjectURL(est.som.arquivo.url);
    est.som.arquivo = { nome: arquivo.name ?? 'áudio', buffer, url: URL.createObjectURL(arquivo) };
    est.som.inicio = 0;
    est.som.fim = Math.min(buffer.duration, OFICIAL.imagem);
    faixaSom.buffer = buffer;
    usarSom('arquivo');
  }

  let vez = 0;
  async function abrir(arquivo) {
    const minha = ++vez;
    avisar(null);
    if (arquivo.type.startsWith('audio/')) return abrirSom(arquivo);
    if (arquivo.size > 600e6) return avisar('Este arquivo é grande demais. Corte antes um trecho menor.');
    const antes = est.fonte ? 'editor' : 'vazia';
    mostrar('abrindo');
    let fonte;
    try {
      fonte = await F.abrirArquivo(arquivo);
    } catch (e) {
      if (minha !== vez) return;
      mostrar(antes);
      return avisar(e.message);
    }
    if (minha !== vez) return fonte.fechar();

    await filme.parar();
    previa.descarregar();
    est.fonte?.fechar();
    est.fonte = fonte;
    est.corte = { inicio: 0, fim: Math.min(fonte.duracao, OFICIAL.video) };
    Object.assign(est.quadro, { modo: 'preencher', zoom: 1, cx: 0.5, cy: 0.5 });
    est.som.doVideo = fonte.tipo === 'video' ? undefined : null; // undefined: ainda lendo
    est.som.tipo = fonte.tipo === 'video' ? 'video' : est.som.arquivo ? 'arquivo' : 'nenhum';
    soltarResultado();

    faixaVideo.miniaturas = [];
    faixaVideo.buffer = null;
    if (fonte.tipo === 'video') {
      faixaVideo.definir({ total: fonte.duracao, corte: est.corte });
      est.lendoSom = F.decodificarSom(arquivo).then((buffer) => {
        if (est.fonte !== fonte) return;
        est.som.doVideo = buffer;
        if (!buffer && est.som.tipo === 'video') est.som.tipo = 'nenhum';
        faixaVideo.buffer = buffer;
        faixaVideo.pintar();
        atualizar();
      });
    } else est.lendoSom = null;
    if (est.som.tipo === 'arquivo') {
      if (fonte.tipo !== 'video') est.som.fim = est.som.inicio + OFICIAL.imagem;
      arrumarSomDoArquivo();
    }
    previa.carregar(fonte);
    mostrar('editor');
    pintarFilme();
  }

  /** As miniaturas do vídeo atrás da faixa de corte. */
  const filme = {
    vez: 0,
    emCurso: Promise.resolve(),
    async parar() {
      this.vez++;
      await this.emCurso;
    },
  };
  function pintarFilme() {
    const { fonte } = est;
    if (fonte?.tipo !== 'video') return;
    filme.emCurso = filme.parar().then(async () => {
      const minha = filme.vez;
      const w = faixaVideo.trilho.clientWidth;
      const h = faixaVideo.trilho.clientHeight;
      if (!w || !h) return;
      const n = Math.max(4, Math.round(w / Math.max(28, h * Math.min(1.6, fonte.largura / fonte.altura))));
      const passo = w / n;
      const { inicio, fim } = faixaVideo.vista;
      const novas = [];
      for (let i = 0; i < n; i++) {
        let imagem;
        try {
          imagem = await fonte.quadro(inicio + ((i + 0.5) * (fim - inicio)) / n);
        } catch {
          return;
        }
        if (minha !== filme.vez || est.fonte !== fonte) return;
        const t = new OffscreenCanvas(Math.ceil(passo * 2), Math.ceil(h * 2));
        const c = t.getContext('2d');
        const escala = Math.max(t.width / fonte.largura, t.height / fonte.altura);
        const lw = fonte.largura * escala;
        const lh = fonte.altura * escala;
        c.drawImage(imagem, (t.width - lw) / 2, (t.height - lh) / 2, lw, lh);
        novas.push({ x: i * passo, w: passo + 0.5, bitmap: t });
        faixaVideo.miniaturas = [...novas, ...faixaVideo.miniaturas.slice(novas.length)];
        faixaVideo.pintar();
      }
      faixaVideo.miniaturas = novas;
      faixaVideo.pintar();
    });
  }

  const ETAPAS = {
    quadros: ['Lendo os quadros do vídeo', 0, 0.5],
    imagem: ['Comprimindo a imagem', 0.5, 0.45],
    som: ['Preparando o som', 0.95, 0.05],
  };

  async function criar() {
    if (est.ocupado || !est.fonte) return;
    est.ocupado = true;
    avisar(null);
    controle = new AbortController();
    barraProgresso.style.width = '0%';
    textoProgresso.textContent = 'Começando...';
    mostrar('criando');
    try {
      await filme.parar();
      if (est.som.tipo === 'video' && est.lendoSom) await est.lendoSom;
      const { fonte } = est;
      const corte = fonte.tipo === 'video' ? est.corte : { inicio: 0, fim: Math.min(fonte.duracao, OFICIAL.imagem) };
      const r = await F.criar({
        fonte,
        corte: { ...corte },
        quadro: { ...est.quadro },
        som: somEscolhido(),
        limite: LIMITES[est.tamanho],
        sinal: controle.signal,
        aoProgresso({ etapa, parte }) {
          const [texto, base, peso] = ETAPAS[etapa];
          barraProgresso.style.width = `${Math.round((base + peso * parte) * 100)}%`;
          textoProgresso.textContent = `${texto}...`;
        },
      });
      soltarResultado();
      est.resultado = { ...r, urlImagem: URL.createObjectURL(r.webp), urlSom: r.audio ? URL.createObjectURL(r.audio) : null };
      imagemPronta.src = est.resultado.urlImagem;
      if (est.resultado.urlSom) somPronto.src = est.resultado.urlSom;
      else somPronto.removeAttribute('src');
      const partes = [peso(r.webp.size)];
      if (r.quadros > 1) partes.push(segundos(r.duracao), `${Math.round(r.fps)} fps`);
      partes.push(r.audio ? `som de ${segundos(r.segundos)}` : 'sem som');
      fichaPronta.textContent = partes.join('  ·  ');
      reciboPronto.hidden = true;
      mostrar('pronta');
      if (r.audio && !previa.mudo) ouvirPronta();
    } catch (e) {
      mostrar('editor');
      if (!(e instanceof F.Cancelado)) {
        console.warn('[Figurinha com Som]', e);
        avisar(e.message || 'Não consegui criar a figurinha.');
      }
    } finally {
      est.ocupado = false;
      controle = null;
      atualizar();
    }
  }

  function soltarResultado() {
    const r = est.resultado;
    if (!r) return;
    somPronto.pause();
    URL.revokeObjectURL(r.urlImagem);
    if (r.urlSom) URL.revokeObjectURL(r.urlSom);
    est.resultado = null;
  }

  function ouvirPronta(ev) {
    ev?.stopPropagation();
    if (!est.resultado?.urlSom) return;
    if (!somPronto.paused) return somPronto.pause();
    somPronto.currentTime = 0;
    somPronto.play().catch(() => {});
    // Endereço novo: é o jeito de a animação recomeçar junto com o som.
    const nova = URL.createObjectURL(est.resultado.webp);
    imagemPronta.src = nova;
    URL.revokeObjectURL(est.resultado.urlImagem);
    est.resultado.urlImagem = nova;
  }
  function atualizarOuvir() {
    botaoOuvir.replaceChildren(icone(...(somPronto.paused ? ICONES.som : ICONES.pausar)));
    botaoOuvir.setAttribute('aria-label', somPronto.paused ? 'Ouvir a figurinha' : 'Parar o som');
  }

  function baixar() {
    const r = est.resultado;
    if (!r) return;
    const nome = (est.fonte?.nome ?? 'figurinha').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40) || 'figurinha';
    const salvar = (url, fim) => el('a', { href: url, download: `${nome}.${fim}` }).click();
    salvar(r.urlImagem, 'webp');
    if (r.urlSom) setTimeout(() => salvar(r.urlSom, 'ogg'), 400);
  }

  async function enviar() {
    const r = est.resultado;
    const c = est.conversa;
    if (!r || !c || est.ocupado) return;
    est.ocupado = true;
    avisar(null);
    reciboPronto.hidden = true;
    atualizar();
    try {
      const { comSom } = await pedir(
        'enviar',
        { webp: r.webp, audio: r.audio, segundos: r.segundos, conversa: c.id, largura: F.LADO, altura: F.LADO },
        180_000,
      );
      if (!r.audio) recibo(true, `Enviada para ${c.nome}`);
      else if (comSom) recibo(true, `Enviada com som para ${c.nome}`, 'Para guardar com o som, favorite a figurinha pelo celular: pelo computador o som não vai junto.');
      else if (comSom === false) recibo(false, 'Enviada, mas o WhatsApp Web não levou o som');
      else recibo(false, `Enviada para ${c.nome}`, 'Daqui não deu para conferir se o som foi junto: toque nela no celular para ouvir.');
    } catch (e) {
      avisar(e.message || 'Não consegui enviar a figurinha.');
    } finally {
      est.ocupado = false;
      atualizar();
    }
  }

  function recibo(deuCerto, titulo, dica) {
    reciboPronto.className = deuCerto ? 'recibo certo' : 'recibo';
    reciboPronto.replaceChildren(
      ...(deuCerto ? [icone(...ICONES.certo)] : []),
      el('div', {}, el('strong', {}, titulo), dica ? el('span', {}, dica) : null),
    );
    reciboPronto.hidden = false;
  }

  // ---------------------------------------------------------------- atualização

  function atualizarPalco() {
    botaoTocar.replaceChildren(icone(...(previa.tocando ? ICONES.pausar : ICONES.tocar)));
    botaoTocar.setAttribute('aria-label', previa.tocando ? 'Pausar' : 'Tocar');
    botaoMudo.replaceChildren(icone(...(previa.mudo ? ICONES.mudo : ICONES.som)));
    botaoMudo.setAttribute('aria-label', previa.mudo ? 'Ligar o som da prévia' : 'Desligar o som da prévia');
    botaoMudo.hidden = est.som.tipo === 'nenhum';
    botaoTocar.hidden = est.fonte?.tipo !== 'video' && est.som.tipo !== 'arquivo';
  }

  function atualizarTempos() {
    const { fonte, som } = est;
    if (!fonte) return;
    const doVideo = fonte.tipo === 'video';
    const c = doVideo ? est.corte : { inicio: som.inicio, fim: som.fim };
    const dura = c.fim - c.inicio;
    passoInicio.valor.textContent = tempo(c.inicio);
    passoFim.valor.textContent = tempo(c.fim);
    for (const b of duracoes.children) {
      const s = Number(b.dataset.s);
      const total = faixaAtiva().total;
      b.setAttribute('aria-pressed', String(Math.abs(dura - Math.min(s, total, MAX)) < 0.06 && (s <= total || s === Infinity)));
      b.hidden = s !== Infinity && s >= total;
      if (s === Infinity) b.textContent = total > MAX ? `${MAX} s` : 'Tudo';
    }
    const oficial = doVideo ? OFICIAL.video : OFICIAL.imagem;
    const passou = dura > oficial + 0.05;
    notaTempo.hidden = !passou;
    notaTempo.textContent = `São ${segundos(dura)}. O limite oficial do WhatsApp aqui é ${oficial} s: acima disso, teste antes em uma conversa sua.`;
  }

  function atualizar() {
    const { fonte, som, quadro } = est;
    segModo.marcar(quadro.modo);
    zoom.value = String(quadro.zoom);
    segForma.marcar(quadro.forma);
    segSom.mostrar('video', fonte?.tipo === 'video');
    segSom.travar('video', som.doVideo === null);
    segSom.marcar(som.tipo);
    segTamanho.marcar(est.tamanho);
    volume.value = String(som.volume);
    linhaVolume.hidden = som.tipo === 'nenhum';
    blocoSom.hidden = som.tipo !== 'arquivo' || !som.arquivo;
    nomeSom.textContent = som.arquivo ? `${som.arquivo.nome} (trocar)` : '';
    nomeSom.title = som.arquivo?.nome ?? '';
    const temTempo = fonte?.tipo === 'video' || som.tipo === 'arquivo';
    blocoTempo.hidden = !temTempo;
    faixaVideo.raiz.hidden = fonte?.tipo !== 'video';
    botaoTrocar.textContent = fonte && fonte.tipo !== 'video' ? 'Trocar imagem' : 'Trocar vídeo';
    botaoCriar.disabled = est.ocupado;

    palcoPronto.toggleAttribute('data-som', Boolean(est.resultado?.urlSom));
    botaoOuvir.hidden = !est.resultado?.urlSom;

    const c = est.conversa;
    const bloqueada = c && c.tipo !== 'conversa' && est.resultado?.audio;
    let texto = `Enviar para ${c?.nome ?? ''}`;
    if (est.ocupado) texto = 'Enviando...';
    else if (!est.pronto) texto = 'Entre no WhatsApp para enviar';
    else if (!c) texto = 'Abra uma conversa para enviar';
    else if (bloqueada) texto = `Som não funciona em ${c.tipo}`;
    botaoEnviar.replaceChildren(icone(...ICONES.enviar), el('span', { class: 'corta' }, texto));
    botaoEnviar.disabled = est.ocupado || !est.pronto || !c || Boolean(bloqueada);
    atualizarTempos();
    atualizarPalco();
    atualizarOuvir();
  }

  async function consultar() {
    if (painel.hidden) return;
    hospedeiro.classList.toggle('escuro', document.body?.classList.contains('dark') ?? false);
    try {
      const e = await pedir('estado', null, 4000);
      const mudou = e.pronto !== est.pronto || e.conversa?.id !== est.conversa?.id || e.conversa?.nome !== est.conversa?.nome;
      est.pronto = e.pronto;
      est.conversa = e.conversa;
      if (mudou) atualizar();
    } catch {
      est.pronto = false;
      est.conversa = null;
      atualizar();
    }
  }

  function alternar(abrirAgora = painel.hidden) {
    painel.hidden = !abrirAgora;
    aba.hidden = abrirAgora;
    if (abrirAgora) {
      consultar();
      if (est.vista === 'editor') previa.tocar();
    } else {
      previa.pausar();
      somPronto.pause();
    }
  }

  // ------------------------------------------------------------ arrastar e soltar

  painel.addEventListener('click', () => {
    if (!previa.mudoForcado) return;
    previa.mudoForcado = false;
    previa.mudo = false;
    previa.ajustarSom();
    atualizarPalco();
  });

  palco.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== tela) return;
    e.preventDefault();
    tela.setPointerCapture(e.pointerId);
    let { clientX: x, clientY: y } = e;
    let andou = 0;
    const lado = tela.getBoundingClientRect().width;
    const mover = (ev) => {
      const dx = ev.clientX - x;
      const dy = ev.clientY - y;
      x = ev.clientX;
      y = ev.clientY;
      andou += Math.abs(dx) + Math.abs(dy);
      const r = F.retangulo(est.fonte, est.quadro, lado);
      if (Math.abs(lado - r.w) > 0.5) est.quadro.cx = F.limitar(est.quadro.cx + dx / (lado - r.w), 0, 1);
      if (Math.abs(lado - r.h) > 0.5) est.quadro.cy = F.limitar(est.quadro.cy + dy / (lado - r.h), 0, 1);
    };
    const soltar = () => {
      tela.removeEventListener('pointermove', mover);
      tela.removeEventListener('pointerup', soltar);
      tela.removeEventListener('pointercancel', soltar);
      if (andou < 4) previa.tocando ? previa.pausar() : previa.tocar();
    };
    tela.addEventListener('pointermove', mover);
    tela.addEventListener('pointerup', soltar);
    tela.addEventListener('pointercancel', soltar);
  });
  palco.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      est.quadro.zoom = F.limitar(est.quadro.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 1, 4);
      zoom.value = String(est.quadro.zoom);
    },
    { passive: false },
  );

  const hospedeiro = el('div', { id: ID });
  const sombra = hospedeiro.attachShadow({ mode: 'open' });
  const folha = new CSSStyleSheet();
  folha.replaceSync(globalThis.FigSomEstilo);
  sombra.adoptedStyleSheets = [folha];
  sombra.append(painel, aba);

  // O que acontece dentro do painel não deve disparar atalhos do WhatsApp.
  for (const tipo of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut', 'wheel', 'contextmenu']) {
    hospedeiro.addEventListener(tipo, (e) => e.stopPropagation());
  }
  for (const tipo of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    hospedeiro.addEventListener(tipo, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (tipo === 'dragover') e.dataTransfer.dropEffect = 'copy';
      painel.classList.toggle('recebendo', tipo === 'dragenter' || tipo === 'dragover');
      if (tipo === 'drop' && e.dataTransfer.files[0] && !est.ocupado) abrir(e.dataTransfer.files[0]);
    });
  }

  document.documentElement.append(hospedeiro);
  mostrar('vazia');

  const relogio = setInterval(() => {
    if (!hospedeiro.isConnected) {
      // Outra versão da extensão tomou o lugar desta.
      clearInterval(relogio);
      window.removeEventListener('message', aoReceber);
      previa.descarregar();
      return;
    }
    consultar();
  }, 1000);

  chrome.runtime?.onMessage.addListener((m) => {
    if (m?.tipo === 'alternar') alternar();
    if (m?.tipo === 'abrir') alternar(true);
  });
})();
