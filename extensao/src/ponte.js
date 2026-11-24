/*
 * Figurinha com Som: ponte com o WhatsApp Web.
 *
 * Roda no mundo da própria página, onde o WhatsApp guarda os módulos dele.
 * Faz duas coisas e nada mais:
 *   1. liga o suporte a figurinha com som (ler, enviar e tocar), que já vem no
 *      código do WhatsApp Web mas fica desligado por enquanto;
 *   2. envia a figurinha que o painel mandar, só quando a pessoa clica em enviar
 *      e só para a conversa que está aberta.
 */
(() => {
  'use strict';

  const CANAL = 'figurinha-com-som';
  const CHAVE = Symbol.for(CANAL);
  window[CHAVE]?.desligar?.(); // a extensão foi atualizada com a página aberta

  const desligamentos = [];
  const ouvir = (alvo, tipo, fn, opcoes) => {
    alvo.addEventListener(tipo, fn, opcoes);
    desligamentos.push(() => alvo.removeEventListener(tipo, fn, opcoes));
  };
  const repetir = (fn, ms) => {
    const id = setInterval(fn, ms);
    desligamentos.push(() => clearInterval(id));
    return id;
  };

  // ---------------------------------------------------------------- módulos

  const achados = new Map();

  /** Um módulo do WhatsApp, ou null quando ele (ou algo de que depende) ainda não carregou. */
  function pegar(nome) {
    if (achados.has(nome)) return achados.get(nome);
    try {
      const faltando = window.require?.('__debug')?.debugUnresolvedDependencies?.([nome]);
      if (faltando && / is not defined/.test(faltando)) return null;
      const modulo = window.require?.(nome) ?? null;
      if (modulo) achados.set(nome, modulo);
      return modulo;
    } catch {
      return null;
    }
  }
  const padrao = (nome) => {
    const m = pegar(nome);
    return m?.default ?? m;
  };
  function exigir(nome, parte) {
    const m = padrao(nome);
    const v = parte ? m?.[parte] : m;
    if (!v) {
      throw new Error(`O WhatsApp Web mudou por dentro (não achei ${parte ?? nome}). A extensão precisa de uma atualização.`);
    }
    return v;
  }

  // -------------------------------------------- 1. suporte a figurinha com som

  // A primeira deixa ler e enviar. A segunda mostra o botão de som do próprio
  // WhatsApp em cima das figurinhas com som, dentro das conversas.
  const TRAVAS = ['isSoundStickerConsumptionEnabled', 'isSoundStickerPlaybackEnabled'];

  function ligarSuporte() {
    const modulo = pegar('WAWebSoundStickerGating');
    if (typeof modulo?.[TRAVAS[0]] !== 'function') return false;
    for (const nome of TRAVAS) {
      if (typeof modulo[nome] === 'function' && !modulo[nome][CHAVE]) modulo[nome] = Object.assign(() => true, { [CHAVE]: true });
    }
    return modulo[TRAVAS[0]]() === true;
  }

  // Quanto antes ligar, melhor: as mensagens que chegam já são lidas com o som.
  let suporte = ligarSuporte();
  const tentativa = repetir(() => {
    suporte = suporte || ligarSuporte();
    if (suporte) clearInterval(tentativa);
  }, 100);

  // ---------------------------------------------------------- a conversa aberta

  function conversaAtiva() {
    const colecao = pegar('WAWebChatCollection')?.ChatCollection;
    const canais = padrao('WAWebNewsletterCollection');
    return canais?.getActive?.() ?? colecao?.getActive?.() ?? null;
  }

  const tentar = (fn) => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };

  function descrever(chat) {
    const id = chat.id;
    const tipo = tentar(() => id.isNewsletter()) ? 'canal' : tentar(() => id.isStatus()) ? 'status' : tentar(() => id.isBot()) ? 'bot' : 'conversa';
    const nome =
      tentar(() => chat.formattedTitle) ||
      tentar(() => chat.name) ||
      tentar(() => chat.contact?.formattedName) ||
      tentar(() => chat.contact?.name) ||
      tentar(() => id.user) ||
      'esta conversa';
    return { id: id.toString(), nome: String(nome), tipo };
  }

  function estado() {
    const colecao = pegar('WAWebChatCollection')?.ChatCollection;
    const chat = colecao ? tentar(conversaAtiva) : null;
    return {
      pronto: Boolean(colecao && pegar('WAWebMediaPrep') && pegar('WAWebUploadManager')),
      suporte,
      conversa: chat ? descrever(chat) : null,
    };
  }

  // ---------------------------------------------------------------- 2. envio

  function base64(dados) {
    if (typeof dados === 'string') return dados;
    const bytes = new Uint8Array(dados instanceof ArrayBuffer ? dados : dados.buffer);
    let texto = '';
    for (const b of bytes) texto += String.fromCharCode(b);
    return btoa(texto);
  }

  async function subirSom(blob, segundos) {
    const gerente = exigir('WAWebUploadManager');
    const iniciar = exigir('WAWebStartMediaUploadQpl', 'startMediaUploadQpl');
    const filehash = base64(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    const envio = await gerente.encryptAndUpload({
      blob,
      type: 'audio',
      signal: new AbortController().signal,
      userUploadAttemptCount: 0,
      forwardedFromWeb: false,
      fileOrigin: null,
      isViewOnce: false,
      uploadQpl: iniciar({ entryPoint: 'MediaUpload', byteLength: blob.size, mediaType: 'audio', isEncrypted: true }),
    });
    if (!envio?.directPath || !envio.mediaKey) throw new Error('O WhatsApp não aceitou o envio do som. Tente de novo.');
    return {
      directPath: envio.directPath,
      deprecatedMms3Url: envio.url,
      mediaKey: base64(envio.mediaKey),
      mediaKeyTimestamp: envio.mediaKeyTimestamp,
      filehash,
      encFilehash: base64(envio.encFilehash),
      size: blob.size,
      mimetype: 'audio/ogg; codecs=opus',
      duration: segundos,
    };
  }

  /** Confere, na mensagem que realmente sai, se o som está dentro dela (null: não deu para ver). */
  function vigiarSaida() {
    const gerador = pegar('WAWebE2EProtoGenerator');
    const original = gerador?.createMsgProtobuf;
    let comSom = null;
    if (typeof original !== 'function') return { resultado: () => comSom, soltar() {} };
    const olhar = (p) => {
      if (p?.audioStickerMessage) comSom = Boolean(p.audioStickerMessage.message?.stickerMessage?.audioMessage);
      else if (p?.stickerMessage) comSom = Boolean(p.stickerMessage.audioMessage);
    };
    const vigia = function (...args) {
      const saida = original.apply(this, args);
      tentar(() => (typeof saida?.then === 'function' ? saida.then(olhar, () => {}) : olhar(saida)));
      return saida;
    };
    gerador.createMsgProtobuf = vigia;
    return {
      resultado: () => comSom,
      soltar() {
        if (gerador.createMsgProtobuf === vigia) gerador.createMsgProtobuf = original;
      },
    };
  }

  const ERROS = {
    ERROR_NETWORK: 'Sem conexão com o WhatsApp. Tente de novo.',
    ERROR_UPLOAD: 'O WhatsApp recusou o arquivo da figurinha. Tente o tamanho leve.',
    ERROR_CANCELLED: 'O envio foi cancelado.',
    ERROR_RATE_LIMIT: 'O WhatsApp pediu para esperar um pouco antes de enviar de novo.',
  };

  async function enviar({ webp, audio, segundos, conversa, largura, altura }) {
    const chat = conversaAtiva();
    if (!chat) throw new Error('Abra uma conversa para enviar a figurinha.');
    if (chat.id.toString() !== conversa) throw new Error('A conversa mudou. Confira para quem vai e clique em enviar de novo.');
    if (!suporte && !(suporte = ligarSuporte())) exigir('WAWebSoundStickerGating');

    const OpaqueData = exigir('WAWebMediaOpaqueData');
    const MediaPrep = exigir('WAWebMediaPrep');
    const ler = exigir('WAWebWebpParseWebp', 'parseWebp');
    const { getSendableStickerAudio } = exigir('WAWebSoundStickerUtils');

    let stickerAudio;
    if (audio) {
      if (tentar(() => chat.id.isNewsletter()) || tentar(() => chat.id.isStatus()) || tentar(() => chat.id.isBot())) {
        throw new Error('Figurinha com som só funciona em conversa e em grupo.');
      }
      stickerAudio = getSendableStickerAudio(await subirSom(audio, segundos), chat.id);
      if (!stickerAudio) throw new Error('Esta conversa não aceita figurinha com som.');
    }

    const dados = ler(await webp.arrayBuffer());
    const animada = dados.singleLoopDuration > 0;
    const prep = new MediaPrep(
      'sticker',
      Promise.resolve({
        type: 'sticker',
        mediaBlob: await OpaqueData.createFromData(webp, 'image/webp'),
        mimetype: 'image/webp',
        size: webp.size,
        fullWidth: largura,
        fullHeight: altura,
        isAnimated: animada,
        ...(animada && {
          firstFrameLength: dados.firstFrameLength,
          animationDuration: dados.animationDuration,
          singleLoopDuration: dados.singleLoopDuration,
        }),
        stickerPackId: dados.stickerPackId,
        stickerPackName: dados.stickerPackName,
        stickerPackPublisher: dados.stickerPackPublisher,
      }),
    );
    await prep.waitForPrep();

    const vigia = vigiarSaida();
    try {
      const r = await prep.sendToChat({ chat, options: stickerAudio ? { stickerAudio } : {} });
      const codigo = String(r?.messageSendResult ?? 'ERROR_UNKNOWN');
      if (codigo !== 'OK') throw new Error(ERROS[codigo] ?? `O WhatsApp não conseguiu enviar (${codigo}).`);
      return { comSom: vigia.resultado() };
    } finally {
      vigia.soltar();
    }
  }

  // --------------------------------------------------------- conversa com o painel

  const pedidos = { estado, enviar };

  ouvir(window, 'message', async (ev) => {
    const m = ev.data;
    if (ev.source !== window || m?.canal !== CANAL || m.de !== 'painel' || !(m.pedido in pedidos)) return;
    let resposta;
    try {
      resposta = { ok: true, valor: await pedidos[m.pedido](m.dados ?? {}) };
    } catch (e) {
      console.warn('[Figurinha com Som]', e);
      resposta = { ok: false, erro: String(e?.message || e) };
    }
    window.postMessage({ canal: CANAL, de: 'ponte', id: m.id, ...resposta }, location.origin);
  });

  window[CHAVE] = {
    desligar() {
      desligamentos.splice(0).forEach((fn) => fn());
    },
  };
})();
