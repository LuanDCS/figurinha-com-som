/*
 * Figurinha com Som: núcleo de conversão.
 *
 * Vídeo -> WebP animado 512x512 (a imagem da figurinha) + Ogg/Opus (o som).
 * Tudo acontece no computador da pessoa, com o que o navegador já tem
 * (canvas, WebAudio e WebCodecs). Sem dependências e sem servidor.
 */
(() => {
  'use strict';

  const LADO = 512;
  const TAXA = 48000;
  const BLOCO = 960; // 20 ms a 48 kHz, o quadro padrão do Opus
  const LIMITE_AUDIO = 1_000_000; // o WhatsApp Web recusa som maior que isso
  const MAX_QUADROS = 200;

  class Cancelado extends Error {
    constructor() {
      super('cancelado');
      this.name = 'Cancelado';
    }
  }
  const checar = (sinal) => {
    if (sinal?.aborted) throw new Cancelado();
  };
  const limitar = (v, min, max) => Math.min(max, Math.max(min, v));
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

  // ------------------------------------------------------------------ bytes

  function juntar(...partes) {
    const total = partes.reduce((n, p) => n + p.length, 0);
    const saida = new Uint8Array(total);
    let pos = 0;
    for (const p of partes) {
      saida.set(p, pos);
      pos += p.length;
    }
    return saida;
  }
  const ascii = (texto) => Uint8Array.from(texto, (c) => c.charCodeAt(0));
  const u16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const u24 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);
  const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

  // ------------------------------------------------------------------- WebP

  function lerPedacos(bytes) {
    const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const saida = [];
    let pos = 12;
    while (pos + 8 <= bytes.length) {
      const tipo = String.fromCharCode(...bytes.subarray(pos, pos + 4));
      const tamanho = visao.getUint32(pos + 4, true);
      saida.push({ tipo, dados: bytes.subarray(pos + 8, pos + 8 + tamanho) });
      pos += 8 + tamanho + (tamanho & 1);
    }
    return saida;
  }

  function pedaco(tipo, dados) {
    const base = juntar(ascii(tipo), u32(dados.length), dados);
    return dados.length & 1 ? juntar(base, new Uint8Array(1)) : base;
  }

  /** Metadados que o WhatsApp lê dentro da figurinha (nome do pacote, autor). */
  function exifDaFigurinha({ nome = 'Figurinha com som', autor = '', emojis = [] } = {}) {
    const json = new TextEncoder().encode(
      JSON.stringify({
        'sticker-pack-id': 'figurinha-com-som-' + crypto.randomUUID(),
        'sticker-pack-name': nome,
        'sticker-pack-publisher': autor,
        emojis,
      }),
    );
    return juntar(
      new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]),
      u32(json.length),
      u32(22),
      json,
    );
  }

  /** Junta quadros WebP já comprimidos em um único WebP animado. */
  function montarWebP(quadros, exif) {
    const alfa = quadros.some((q) => q.pedacos.some((p) => p.tipo === 'ALPH' || p.tipo === 'VP8L'));
    const animado = quadros.length > 1;
    const marcas = (animado ? 0x02 : 0) | (exif ? 0x08 : 0) | (alfa ? 0x10 : 0);
    const corpo = [
      ascii('WEBP'),
      pedaco('VP8X', juntar(new Uint8Array([marcas, 0, 0, 0]), u24(LADO - 1), u24(LADO - 1))),
    ];
    if (animado) {
      corpo.push(pedaco('ANIM', juntar(new Uint8Array(4), u16(0)))); // fundo transparente, repete sempre
      for (const q of quadros) {
        corpo.push(
          pedaco(
            'ANMF',
            juntar(
              u24(0),
              u24(0),
              u24(LADO - 1),
              u24(LADO - 1),
              u24(q.ms),
              new Uint8Array([0x02]), // cada quadro substitui o anterior por inteiro
              ...q.pedacos.map((p) => pedaco(p.tipo, p.dados)),
            ),
          ),
        );
      }
    } else {
      corpo.push(...quadros[0].pedacos.map((p) => pedaco(p.tipo, p.dados)));
    }
    if (exif) corpo.push(pedaco('EXIF', exif));
    const conteudo = juntar(...corpo);
    return new Blob([ascii('RIFF'), u32(conteudo.length), conteudo], { type: 'image/webp' });
  }

  // -------------------------------------------------------------- Ogg / Opus

  const TABELA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      t[i] = r >>> 0;
    }
    return t;
  })();

  function crcOgg(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) ^ bytes[i]) & 255]) >>> 0;
    return crc;
  }

  function paginaOgg({ serie, numero, granulo, marcas, pacotes }) {
    const tabela = [];
    for (const p of pacotes) {
      let resto = p.length;
      while (resto >= 255) {
        tabela.push(255);
        resto -= 255;
      }
      tabela.push(resto);
    }
    const granuloBytes = new Uint8Array(8);
    new DataView(granuloBytes.buffer).setBigInt64(0, BigInt(granulo), true);
    const pagina = juntar(
      ascii('OggS'),
      new Uint8Array([0, marcas]),
      granuloBytes,
      u32(serie),
      u32(numero),
      u32(0),
      new Uint8Array([tabela.length, ...tabela]),
      ...pacotes,
    );
    pagina.set(u32(crcOgg(pagina)), 22);
    return pagina;
  }

  function montarOgg(pacotes, { preSalto, amostras }) {
    const serie = crypto.getRandomValues(new Uint32Array(1))[0];
    const cabeca = juntar(ascii('OpusHead'), new Uint8Array([1, 1]), u16(preSalto), u32(TAXA), u16(0), new Uint8Array([0]));
    const vendedor = ascii('figurinha-com-som');
    const etiquetas = juntar(ascii('OpusTags'), u32(vendedor.length), vendedor, u32(0));
    const paginas = [
      paginaOgg({ serie, numero: 0, granulo: 0, marcas: 0x02, pacotes: [cabeca] }),
      paginaOgg({ serie, numero: 1, granulo: 0, marcas: 0x00, pacotes: [etiquetas] }),
    ];
    let numero = 2;
    let grupo = [];
    let segmentos = 0;
    let granulo = 0;
    const soltar = (ultimo) => {
      if (!grupo.length) return;
      const fim = ultimo ? preSalto + amostras : granulo;
      paginas.push(paginaOgg({ serie, numero: numero++, granulo: fim, marcas: ultimo ? 0x04 : 0x00, pacotes: grupo }));
      grupo = [];
      segmentos = 0;
    };
    pacotes.forEach((p, i) => {
      const precisa = Math.floor(p.length / 255) + 1;
      if (grupo.length >= 50 || segmentos + precisa > 255) soltar(false);
      grupo.push(p);
      segmentos += precisa;
      granulo += BLOCO;
      if (i === pacotes.length - 1) soltar(true);
    });
    return new Blob(paginas, { type: 'audio/ogg; codecs=opus' });
  }

  /** Recorta o som (mono, 48 kHz), com entrada e saída suaves, e comprime em Opus. */
  async function codificarSom(buffer, { inicio, duracao, volume = 1, taxaBits = 64000, sinal }) {
    if (typeof AudioEncoder === 'undefined') throw new Error('Este navegador não sabe comprimir áudio. Atualize o Chrome.');
    const amostras = Math.max(BLOCO, Math.round(duracao * TAXA));
    const offline = new OfflineAudioContext(1, amostras, TAXA);
    const fonte = offline.createBufferSource();
    fonte.buffer = buffer;
    const ganho = offline.createGain();
    const entrada = Math.min(0.008, duracao / 4);
    const saida = Math.min(0.06, duracao / 4);
    ganho.gain.setValueAtTime(0, 0);
    ganho.gain.linearRampToValueAtTime(volume, entrada);
    ganho.gain.setValueAtTime(volume, Math.max(entrada, duracao - saida));
    ganho.gain.linearRampToValueAtTime(0, duracao);
    fonte.connect(ganho).connect(offline.destination);
    fonte.start(0, inicio, duracao);
    const pronto = await offline.startRendering();
    checar(sinal);
    const pcm = pronto.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) pcm[i] = limitar(pcm[i], -1, 1);

    const pacotes = [];
    let preSalto = 312; // o atraso padrão do libopus a 48 kHz
    let falha = null;
    const codificador = new AudioEncoder({
      output(parte, meta) {
        const bytes = new Uint8Array(parte.byteLength);
        parte.copyTo(bytes);
        pacotes.push(bytes);
        const extra = meta?.decoderConfig?.description;
        if (extra) {
          const e = ArrayBuffer.isView(extra)
            ? new Uint8Array(extra.buffer, extra.byteOffset, extra.byteLength)
            : new Uint8Array(extra);
          if (e.length >= 12 && String.fromCharCode(...e.subarray(0, 8)) === 'OpusHead') preSalto = e[10] | (e[11] << 8);
        }
      },
      error(e) {
        falha = e;
      },
    });
    const config = {
      codec: 'opus',
      sampleRate: TAXA,
      numberOfChannels: 1,
      bitrate: taxaBits,
      opus: { frameDuration: 20000 },
    };
    const suporte = await AudioEncoder.isConfigSupported(config);
    if (!suporte.supported) throw new Error('Este navegador não sabe comprimir áudio em Opus. Atualize o Chrome.');
    codificador.configure(config);
    // Sobra no fim para o atraso do codificador não comer o último pedacinho do som.
    const total = Math.ceil((amostras + preSalto) / BLOCO) * BLOCO;
    for (let pos = 0; pos < total; pos += BLOCO) {
      const bloco = new Float32Array(BLOCO);
      if (pos < pcm.length) bloco.set(pcm.subarray(pos, Math.min(pos + BLOCO, pcm.length)));
      const dados = new AudioData({
        format: 'f32-planar',
        sampleRate: TAXA,
        numberOfFrames: BLOCO,
        numberOfChannels: 1,
        timestamp: Math.round((pos / TAXA) * 1e6),
        data: bloco,
      });
      codificador.encode(dados);
      dados.close();
    }
    await codificador.flush();
    codificador.close();
    if (falha) throw falha;
    if (!pacotes.length) throw new Error('O som saiu vazio.');
    const blob = montarOgg(pacotes, { preSalto, amostras });
    if (blob.size > LIMITE_AUDIO) {
      if (taxaBits <= 16000) throw new Error('O som ficou grande demais. Corte um trecho menor.');
      return codificarSom(buffer, { inicio, duracao, volume, taxaBits: Math.round(taxaBits / 2), sinal });
    }
    return { blob, segundos: Math.max(1, Math.round(duracao)) };
  }

  // ------------------------------------------------------------------ vídeo

  function novoVideo(url) {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    return v;
  }

  function carregar(video, ms = 20000) {
    return new Promise((ok, erro) => {
      if (video.readyState >= 2) return ok();
      const fim = setTimeout(() => erro(new Error('demorou demais para abrir')), ms);
      video.addEventListener('loadeddata', () => (clearTimeout(fim), ok()), { once: true });
      video.addEventListener('error', () => (clearTimeout(fim), erro(video.error ?? new Error('erro'))), { once: true });
    });
  }

  const erroDeFormato = (causa) =>
    new Error('Não consegui abrir este arquivo. Use vídeo MP4, WebM ou MOV, ou uma imagem.', { cause: causa });

  /*
   * Uma "fonte" é o que vai virar figurinha:
   *   tipo      'video', 'imagem' (parada) ou 'animada' (GIF, WebP animado)
   *   duracao   em segundos (0 na imagem parada)
   *   quadro(t) devolve algo que o canvas sabe desenhar, no instante t
   */
  async function abrirVideo(arquivo) {
    const url = URL.createObjectURL(arquivo);
    const video = novoVideo(url);
    try {
      await carregar(video);
      if (!video.videoWidth) throw new Error('sem imagem');
      let duracao = video.duration;
      if (!Number.isFinite(duracao)) {
        // Gravações de tela em WebM às vezes não informam a duração.
        video.currentTime = 1e9;
        await new Promise((ok) => video.addEventListener('seeked', ok, { once: true }));
        duracao = Number.isFinite(video.duration) ? video.duration : video.currentTime;
        video.currentTime = 0;
      }
      const ultimo = Math.max(0, duracao - 0.03);
      return {
        tipo: 'video',
        url,
        duracao,
        largura: video.videoWidth,
        altura: video.videoHeight,
        nome: arquivo.name ?? 'vídeo',
        async quadro(t) {
          await irPara(video, limitar(t, 0, ultimo));
          return video;
        },
        fechar() {
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(url);
        },
      };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw erroDeFormato(e);
    }
  }

  /** A imagem já tem partes transparentes (como um recorte em PNG)? */
  function temTransparencia(bitmaps) {
    const tela = new OffscreenCanvas(128, 128);
    const ctx = tela.getContext('2d', { willReadFrequently: true });
    return bitmaps.some((b) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.drawImage(b, 0, 0, 128, 128);
      const { data } = ctx.getImageData(0, 0, 128, 128);
      for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
      return false;
    });
  }

  async function abrirImagem(arquivo) {
    let decodificador = null;
    try {
      const tipo = arquivo.type;
      if (globalThis.ImageDecoder && (await ImageDecoder.isTypeSupported(tipo))) {
        decodificador = new ImageDecoder({ data: await arquivo.arrayBuffer(), type: tipo });
        await decodificador.tracks.ready;
        await decodificador.completed;
        const total = decodificador.tracks.selectedTrack.frameCount;
        if (total > 1) {
          const quadros = [];
          let t = 0;
          for (let i = 0; i < Math.min(total, 400) && t < 30; i++) {
            const { image } = await decodificador.decode({ frameIndex: i });
            const dura = Math.max(0.02, (image.duration ?? 100000) / 1e6);
            quadros.push({ fim: t + dura, bitmap: await createImageBitmap(image) });
            t += dura;
            image.close();
          }
          decodificador.close();
          return {
            tipo: 'animada',
            duracao: t,
            fps: quadros.length / t,
            transparente: temTransparencia([quadros[0].bitmap, quadros[quadros.length >> 1].bitmap, quadros.at(-1).bitmap]),
            largura: quadros[0].bitmap.width,
            altura: quadros[0].bitmap.height,
            nome: arquivo.name ?? 'imagem',
            quadro: async (s) => (quadros.find((q) => s < q.fim) ?? quadros.at(-1)).bitmap,
            agora: (s) => (quadros.find((q) => s % t < q.fim) ?? quadros.at(-1)).bitmap,
            fechar: () => quadros.forEach((q) => q.bitmap.close()),
          };
        }
        decodificador.close();
      }
      const bitmap = await createImageBitmap(arquivo);
      return {
        tipo: 'imagem',
        duracao: 0,
        transparente: temTransparencia([bitmap]),
        largura: bitmap.width,
        altura: bitmap.height,
        nome: arquivo.name ?? 'imagem',
        quadro: async () => bitmap,
        agora: () => bitmap,
        fechar: () => bitmap.close(),
      };
    } catch (e) {
      throw erroDeFormato(e);
    }
  }

  const abrirArquivo = (arquivo) => (arquivo.type.startsWith('image/') ? abrirImagem(arquivo) : abrirVideo(arquivo));

  /** Devolve o som decodificado ou null quando o arquivo não tem som. */
  async function decodificarSom(arquivo) {
    try {
      const bytes = await arquivo.arrayBuffer();
      return await new OfflineAudioContext(1, 1, TAXA).decodeAudioData(bytes);
    } catch {
      return null;
    }
  }

  /** Vai até o instante t e só volta quando o quadro certo está pronto para ser desenhado. */
  function irPara(video, t) {
    return new Promise((ok, erro) => {
      let buscou = false;
      let mostrou = false;
      let terminou = false;
      let id = 0;
      const acabar = (e) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(limite);
        video.removeEventListener('seeked', aoBuscar);
        video.removeEventListener('error', aoErrar);
        if (id && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(id);
        e ? erro(e) : ok();
      };
      const aoBuscar = () => {
        buscou = true;
        if (mostrou || !video.requestVideoFrameCallback) acabar();
        else setTimeout(acabar, 60); // mesmo quadro de antes: o aviso não vem
      };
      const aoErrar = () => acabar(new Error('O vídeo falhou no meio da leitura.'));
      const limite = setTimeout(() => acabar(buscou ? undefined : new Error('O vídeo travou na leitura.')), 8000);
      video.addEventListener('seeked', aoBuscar);
      video.addEventListener('error', aoErrar);
      if (video.requestVideoFrameCallback) {
        id = video.requestVideoFrameCallback(() => {
          mostrou = true;
          if (buscou) acabar();
        });
      }
      video.currentTime = t;
    });
  }

  // ---------------------------------------------------------- enquadramento

  function caminhoDaForma(ctx, forma, lado) {
    ctx.beginPath();
    if (forma === 'redonda') ctx.arc(lado / 2, lado / 2, lado / 2, 0, Math.PI * 2);
    else if (forma === 'arredondada') ctx.roundRect(0, 0, lado, lado, lado * 0.13);
    else ctx.rect(0, 0, lado, lado);
  }

  /** Retângulo (em pixels do quadrado final) onde a imagem inteira é desenhada. */
  function retangulo({ largura, altura }, { modo, zoom = 1, cx = 0.5, cy = 0.5 }, lado) {
    const base = modo === 'inteiro' ? Math.min(lado / largura, lado / altura) : Math.max(lado / largura, lado / altura);
    const w = largura * base * zoom;
    const h = altura * base * zoom;
    return { x: (lado - w) * cx, y: (lado - h) * cy, w, h };
  }

  function desenhar(ctx, imagem, medidas, quadro, lado = LADO) {
    ctx.clearRect(0, 0, lado, lado);
    ctx.save();
    if (quadro.forma && quadro.forma !== 'quadrada') {
      caminhoDaForma(ctx, quadro.forma, lado);
      ctx.clip();
    }
    const r = retangulo(medidas, quadro, lado);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imagem, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  /** Como o desenhar, mas sem recorte: o que sobra em volta repete a borda da imagem. */
  function desenharCheio(ctx, imagem, medidas, quadro) {
    const r = retangulo(medidas, quadro, LADO);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LADO, LADO);
    ctx.drawImage(imagem, r.x, r.y, r.w, r.h);
    const x0 = Math.max(0, Math.ceil(r.x));
    const x1 = Math.min(LADO, Math.floor(r.x + r.w));
    const y0 = Math.max(0, Math.ceil(r.y));
    const y1 = Math.min(LADO, Math.floor(r.y + r.h));
    ctx.imageSmoothingEnabled = false;
    if (x0 > 0) ctx.drawImage(ctx.canvas, x0, 0, 1, LADO, 0, 0, x0, LADO);
    if (x1 < LADO) ctx.drawImage(ctx.canvas, x1 - 1, 0, 1, LADO, x1, 0, LADO - x1, LADO);
    if (y0 > 0) ctx.drawImage(ctx.canvas, 0, y0, LADO, 1, 0, 0, LADO, y0);
    if (y1 < LADO) ctx.drawImage(ctx.canvas, 0, y1 - 1, LADO, 1, 0, y1, LADO, LADO - y1);
  }

  /**
   * A transparência do formato (círculo, cantos, sobra dos lados) é igual em
   * todos os quadros. Comprimida uma vez só, em poucos níveis, ela pesa pouco e
   * não borra quando a imagem é reduzida. Devolve null quando nada é transparente.
   */
  async function mascara(medidas, quadro) {
    const tela = new OffscreenCanvas(LADO, LADO);
    const ctx = tela.getContext('2d', { willReadFrequently: true });
    caminhoDaForma(ctx, quadro.forma, LADO);
    ctx.clip();
    const r = retangulo(medidas, quadro, LADO);
    const x = Math.ceil(r.x);
    const y = Math.ceil(r.y);
    ctx.fillRect(x, y, Math.floor(r.x + r.w) - x, Math.floor(r.y + r.h) - y);
    const pixels = ctx.getImageData(0, 0, LADO, LADO);
    let furos = false;
    for (let i = 3; i < pixels.data.length; i += 4) {
      const a = Math.round((pixels.data[i] / 255) * 3) * 85;
      pixels.data[i] = a;
      if (a < 255) furos = true;
    }
    if (!furos) return null;
    ctx.putImageData(pixels, 0, 0);
    const blob = await tela.convertToBlob({ type: 'image/webp', quality: 0.5 });
    return lerPedacos(new Uint8Array(await blob.arrayBuffer())).find((p) => p.tipo === 'ALPH') ?? null;
  }

  // ----------------------------------------------------------- compressão

  function fpsPara(duracao) {
    const alvo = duracao <= 3 ? 20 : duracao <= 6 ? 15 : duracao <= 9 ? 12 : duracao <= 14 ? 10 : 8;
    return Math.min(alvo, MAX_QUADROS / duracao);
  }

  async function amostrar({ fonte, inicio, fim, fps, quadro, aoProgresso, sinal }) {
    const duracao = fim - inicio;
    const total = Math.max(1, Math.round(duracao * fps));
    const totalMs = Math.round(duracao * 1000);
    const tela = new OffscreenCanvas(LADO, LADO);
    const ctx = tela.getContext('2d', { alpha: Boolean(fonte.transparente) });
    const quadros = [];
    try {
      for (let i = 0; i < total; i++) {
        checar(sinal);
        const imagem = await fonte.quadro(inicio + ((i + 0.5) * duracao) / total);
        if (fonte.transparente) desenhar(ctx, imagem, fonte, quadro);
        else desenharCheio(ctx, imagem, fonte, quadro);
        quadros.push({
          bitmap: await createImageBitmap(tela),
          ms: Math.round(((i + 1) * totalMs) / total) - Math.round((i * totalMs) / total),
        });
        aoProgresso?.((i + 1) / total);
      }
    } catch (e) {
      quadros.forEach((q) => q.bitmap.close());
      throw e;
    }
    return quadros;
  }

  async function comprimirQuadro(bitmap, { qualidade, escala, alfa, mascara }) {
    const tela = new OffscreenCanvas(LADO, LADO);
    const ctx = tela.getContext('2d', { alpha: alfa });
    if (escala < 1) {
      // Menos detalhe fino = arquivo menor sem quadradinhos na imagem.
      const menor = Math.round(LADO * escala);
      const pequena = new OffscreenCanvas(menor, menor);
      const c2 = pequena.getContext('2d', { alpha: alfa });
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(bitmap, 0, 0, menor, menor);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pequena, 0, 0, LADO, LADO);
      if (alfa) {
        // A cor fica macia, mas o contorno continua o original.
        ctx.drawImage(pequena, 0, 0, LADO, LADO);
        ctx.drawImage(pequena, 0, 0, LADO, LADO);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(bitmap, 0, 0);
      }
    } else {
      ctx.drawImage(bitmap, 0, 0);
    }
    const blob = await tela.convertToBlob({ type: 'image/webp', quality: qualidade });
    if (blob.type !== 'image/webp') throw new Error('Este navegador não sabe gravar WebP. Use o Chrome, o Edge ou o Brave.');
    const pedacos = lerPedacos(new Uint8Array(await blob.arrayBuffer())).filter((p) => ['ALPH', 'VP8 ', 'VP8L'].includes(p.tipo));
    if (mascara) pedacos.unshift(mascara);
    return { pedacos, bytes: pedacos.reduce((n, p) => n + p.dados.length + 9, 24) };
  }

  async function emParalelo(itens, quantos, tarefa) {
    const saida = new Array(itens.length);
    let proximo = 0;
    await Promise.all(
      Array.from({ length: Math.min(quantos, itens.length) }, async () => {
        while (proximo < itens.length) {
          const i = proximo++;
          saida[i] = await tarefa(itens[i], i);
        }
      }),
    );
    return saida;
  }

  /** Quadros seguidos idênticos viram um só, que fica mais tempo na tela. */
  function fundir(quadros) {
    const iguais = (a, b) =>
      a.bytes === b.bytes &&
      a.pedacos.length === b.pedacos.length &&
      a.pedacos.every((p, i) => {
        const q = b.pedacos[i];
        return p === q || (p.tipo === q.tipo && p.dados.length === q.dados.length && p.dados.every((v, j) => v === q.dados[j]));
      });
    const saida = [];
    for (const q of quadros) {
      const ultimo = saida.at(-1);
      if (ultimo && iguais(ultimo, q)) ultimo.ms += q.ms;
      else saida.push({ ...q });
    }
    return saida;
  }

  const QUALIDADE_MAX = 0.88;

  /** Acha a melhor qualidade que cabe no limite de tamanho e comprime tudo com ela. */
  async function comprimir(quadros, { limite, alfa, mascara, aoProgresso, sinal }) {
    const passo = Math.max(1, Math.floor(quadros.length / 8));
    const amostra = quadros.filter((_, i) => i % passo === Math.floor(passo / 2)).slice(0, 9);
    if (!amostra.length) amostra.push(quadros[0]);
    const estimar = async (qualidade, escala) => {
      checar(sinal);
      const r = await emParalelo(amostra, 4, (q) => comprimirQuadro(q.bitmap, { qualidade, escala, alfa, mascara }));
      return (r.reduce((n, x) => n + x.bytes, 0) / r.length) * quadros.length + 600;
    };
    const alvo = limite * 0.95;
    const procurar = async (escala) => {
      if ((await estimar(QUALIDADE_MAX, escala)) <= alvo) return QUALIDADE_MAX;
      let baixo = 0.02;
      let alto = QUALIDADE_MAX;
      for (let i = 0; i < 6; i++) {
        const meio = (baixo + alto) / 2;
        if ((await estimar(meio, escala)) <= alvo) baixo = meio;
        else alto = meio;
      }
      return baixo;
    };
    let escala = 1;
    let qualidade = await procurar(escala);
    for (const menor of [0.8, 0.64, 0.5]) {
      if (qualidade >= 0.3) break;
      escala = menor;
      qualidade = await procurar(escala);
    }

    let andamento = 0;
    const tudo = async (q) => {
      let feitos = 0;
      const crus = await emParalelo(quadros, 4, async (quadro) => {
        checar(sinal);
        const r = await comprimirQuadro(quadro.bitmap, { qualidade: q, escala, alfa, mascara });
        andamento = Math.max(andamento, (0.65 * ++feitos) / quadros.length);
        aoProgresso?.(andamento);
        return { ...r, ms: quadro.ms };
      });
      const prontos = fundir(crus);
      return { prontos, qualidade: q, escala, total: prontos.reduce((n, x) => n + x.bytes, 0) + 600 };
    };

    let melhor = await tudo(qualidade);
    for (let i = 0; melhor.total > limite; i++) {
      if (i >= 5) throw new Error('A figurinha não coube no tamanho máximo. Corte um trecho menor.');
      melhor = await tudo(Math.max(0.01, melhor.qualidade * Math.min(0.9, (limite / melhor.total) * 0.95)));
    }
    if (melhor.total < limite * 0.9 && melhor.qualidade < QUALIDADE_MAX - 0.03) {
      // Sobrou espaço: uma segunda passada, um pouco mais nítida.
      andamento = 0.65;
      const maior = await tudo(Math.min(QUALIDADE_MAX, melhor.qualidade * Math.min(1.5, ((limite * 0.96) / melhor.total) ** 0.9)));
      if (maior.total <= limite) melhor = maior;
    }
    aoProgresso?.(1);
    return melhor;
  }

  // --------------------------------------------------------------- principal

  /**
   * fonte:  resultado de abrirArquivo
   * corte:  { inicio, fim } em segundos (a parte do vídeo ou do GIF que vira figurinha)
   * quadro: { modo: 'preencher' | 'inteiro', zoom, cx, cy, forma }
   * som:    null ou { buffer, inicio, duracao, volume }
   */
  async function criar({ fonte, corte, quadro, som, limite, meta, aoProgresso, sinal }) {
    const duracao = corte.fim - corte.inicio;
    const avisar = (etapa, parte) => aoProgresso?.({ etapa, parte });

    const quadros = await amostrar({
      fonte,
      inicio: corte.inicio,
      fim: corte.fim,
      fps: duracao > 0 ? Math.min(fpsPara(duracao), fonte.fps ?? Infinity) : 1,
      quadro,
      sinal,
      aoProgresso: (p) => avisar('quadros', p),
    });
    let comprimido;
    try {
      comprimido = await comprimir(quadros, {
        limite,
        alfa: Boolean(fonte.transparente),
        mascara: fonte.transparente ? null : await mascara(fonte, quadro),
        sinal,
        aoProgresso: (p) => avisar('imagem', p),
      });
    } finally {
      quadros.forEach((q) => q.bitmap.close());
    }
    const webp = montarWebP(comprimido.prontos, exifDaFigurinha(meta));

    let audio = null;
    let segundos = 0;
    if (som?.buffer) {
      avisar('som', 0);
      const sobra = som.buffer.duration - som.inicio;
      if (sobra > 0.05) {
        const r = await codificarSom(som.buffer, {
          inicio: som.inicio,
          duracao: Math.min(som.duracao, sobra),
          volume: som.volume ?? 1,
          sinal,
        });
        audio = r.blob;
        segundos = r.segundos;
      }
      avisar('som', 1);
    }
    return {
      webp,
      audio,
      segundos,
      duracao,
      quadros: quadros.length,
      fps: duracao > 0 ? quadros.length / duracao : 0,
      qualidade: comprimido.qualidade,
      escala: comprimido.escala,
    };
  }

  globalThis.FigSom = {
    LADO,
    Cancelado,
    abrirArquivo,
    carregar,
    codificarSom,
    criar,
    decodificarSom,
    desenhar,
    esperar,
    irPara,
    limitar,
    lerPedacos,
    montarOgg,
    montarWebP,
    novoVideo,
    caminhoDaForma,
    retangulo,
  };
})();
