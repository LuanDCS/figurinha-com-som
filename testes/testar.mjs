/*
 * Teste de ponta a ponta, sem conta e sem enviar nada a ninguém.
 *
 *   node testes/testar.mjs "caminho/do/video.mp4"
 *
 * Abre o Chrome instalado com perfil temporário, carrega a extensão na página
 * real do WhatsApp Web (tela de entrada), converte o vídeo e passa a figurinha
 * pelo código real do WhatsApp, de quem envia e de quem recebe. Só a rede e o
 * banco são de mentira, porque precisam de uma conta conectada.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { abrirChrome, dormir } from './chrome.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const EXTENSAO = resolve(aqui, '..', 'extensao');
const SAIDA = resolve(aqui, 'saida');
const VIDEO = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(VIDEO)) {
  console.error('Uso: node testes/testar.mjs "caminho/do/video.mp4"');
  process.exit(2);
}
rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
function conferir(nome, ok, detalhe = '') {
  if (!ok) falhas++;
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}

/** Leitor genérico de protobuf: caminho de campos -> bytes ou número. */
function lerCampo(bytes, caminho) {
  let pos = 0;
  const varint = () => {
    let n = 0n;
    for (let d = 0n; ; d += 7n) {
      const b = bytes[pos++];
      n |= BigInt(b & 127) << d;
      if (b < 128) return n;
    }
  };
  while (pos < bytes.length) {
    const chave = varint();
    const campo = Number(chave >> 3n);
    const tipo = Number(chave & 7n);
    let valor;
    if (tipo === 0) valor = varint();
    else if (tipo === 2) {
      const tam = Number(varint());
      valor = bytes.subarray(pos, pos + tam);
      pos += tam;
    } else if (tipo === 5) valor = bytes.subarray(pos, (pos += 4));
    else if (tipo === 1) valor = bytes.subarray(pos, (pos += 8));
    if (campo === caminho[0]) return caminho.length === 1 ? valor : lerCampo(valor, caminho.slice(1));
  }
  return undefined;
}

const PAINEL = `document.getElementById('figurinha-com-som').shadowRoot`;
const botao = (texto) => `[...${PAINEL}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(texto)} && b.offsetParent !== null)`;

const chrome = await abrirChrome();
try {
  await chrome.enviar('Extensions.loadUnpacked', { path: EXTENSAO });
  await chrome.enviar('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: SAIDA });
  const aba = await chrome.aba();
  await aba.cdp('Page.navigate', { url: 'https://web.whatsapp.com/' });
  await aba.esperar(`!!document.getElementById('figurinha-com-som')?.shadowRoot`, 40000, 'painel na página');
  await aba.esperar(
    `!/ is not defined/.test(require('__debug').debugUnresolvedDependencies(['WAWebSoundStickerGating'])) && require('WAWebSoundStickerGating').isSoundStickerConsumptionEnabled() === true`,
    20000,
    'suporte a som',
  );

  console.log('\n1. Página real');
  const versao = await aba.avaliar(`window.Debug?.VERSION ?? 'desconhecida'`);
  conferir('a extensão entra na página e liga o suporte a som', true, `WhatsApp Web ${versao}`);
  conferir('e o botão de som das conversas', await aba.avaliar(`require('WAWebSoundStickerGating').isSoundStickerPlaybackEnabled() === true`));

  console.log('\n2. Painel');
  await aba.avaliar(`${PAINEL}.querySelector('.aba').click()`);
  conferir('o painel abre', await aba.avaliar(`!${PAINEL}.querySelector('.painel').hidden`));
  await dormir(400);
  await aba.foto(join(SAIDA, '1-vazio.png'));

  const { result } = await aba.cdp('Runtime.evaluate', { expression: `${PAINEL}.querySelector('input[type=file]')` });
  const abriuEm = Date.now();
  await aba.cdp('DOM.setFileInputFiles', { files: [VIDEO], objectId: result.objectId });
  await aba.esperar(`${botao('Criar figurinha')} ? true : false`, 30000, 'editor');
  conferir('o vídeo abre no editor', true, `${Date.now() - abriuEm} ms`);
  await dormir(3500);
  conferir('o som do vídeo foi reconhecido', await aba.avaliar(`!${PAINEL}.querySelector('[data-valor=video]').disabled && ${PAINEL}.querySelector('[data-valor=video]').getAttribute('aria-pressed') === 'true'`));
  await aba.foto(join(SAIDA, '2-editor.png'));

  console.log('\n3. Conversão');
  const antes = Date.now();
  await aba.avaliar(`${botao('Criar figurinha')}.click()`);
  await dormir(1200);
  await aba.foto(join(SAIDA, '3-criando.png'));
  await aba.esperar(`${botao('Baixar')} ? true : false`, 120000, 'figurinha pronta');
  const levou = ((Date.now() - antes) / 1000).toFixed(1);
  console.log('      ficha:', await aba.avaliar(`${PAINEL}.querySelector('.ficha').textContent`));
  conferir('a figurinha ficou pronta', true, `${levou} s`);
  await dormir(700);
  await aba.foto(join(SAIDA, '4-pronta.png'));
  conferir('o som da figurinha toca', await aba.avaliar(`${PAINEL}.querySelector('.palco[data-som] .redondo:last-child')?.getAttribute('aria-label') === 'Parar o som'`));
  await aba.avaliar(`${botao('Baixar')}.click()`);
  let arquivos = [];
  for (let i = 0; i < 40 && arquivos.length < 2; i++) {
    await dormir(250);
    arquivos = readdirSync(SAIDA).filter((f) => /\.(webp|ogg)$/.test(f));
  }
  const webp = join(SAIDA, arquivos.find((f) => f.endsWith('.webp')) ?? '');
  const ogg = join(SAIDA, arquivos.find((f) => f.endsWith('.ogg')) ?? '');
  conferir('baixa a imagem e o som', arquivos.length === 2, arquivos.join(', '));

  console.log('\n4. Arquivos');
  const bytesWebp = readFileSync(webp);
  const bytesOgg = readFileSync(ogg);
  conferir('imagem cabe no limite', bytesWebp.length <= 950_000, `${bytesWebp.length} bytes`);
  const py = `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); n = im.n_frames; ds = []
for i in range(n):
    im.seek(i); im.load(); ds.append(im.info['duration'])
print(json.dumps({'tam': im.size, 'n': n, 'total': sum(ds), 'loop': im.info.get('loop'), 'exif': b'sticker-pack-id' in (im.info.get('exif') or b'')}))
`;
  const info = JSON.parse(execFileSync('python', ['-c', py, webp], { encoding: 'utf8' }));
  conferir('WebP animado 512x512', info.tam[0] === 512 && info.tam[1] === 512 && info.n > 1, `${info.n} quadros, ${info.total} ms, repete ${info.loop === 0 ? 'sempre' : info.loop}`);
  conferir('metadados da figurinha presentes', info.exif);
  const sonda = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', ogg], { encoding: 'utf8' }));
  const faixa = sonda.streams[0];
  conferir('som em Ogg/Opus mono', faixa.codec_name === 'opus' && faixa.channels === 1 && sonda.format.format_name === 'ogg', `${Number(sonda.format.duration).toFixed(3)} s, ${bytesOgg.length} bytes`);
  const erros = execFileSync('ffmpeg', ['-v', 'warning', '-xerror', '-i', ogg, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  conferir('o som decodifica sem nenhum aviso', erros === '');

  console.log('\n5. Módulos reais do WhatsApp Web');
  const carregou = await aba.avaliar(`(() => {
    const B = require('Bootloader');
    B.enableBootload({ WAWebMainWrapper: { r: [], be: 1 } });
    return Promise.race([new Promise((ok) => B.loadModules(['WAWebMainWrapper'], () => ok(true), 'teste')), new Promise((ok) => setTimeout(() => ok(false), 60000))]);
  })()`);
  conferir('o aplicativo inteiro carrega (o mesmo da conta conectada)', carregou);
  const usados = [...new Set([...readFileSync(join(EXTENSAO, 'src', 'ponte.js'), 'utf8').matchAll(/\b(?:pegar|padrao|exigir)\('([^']+)'/g)].map((m) => m[1]))];
  const faltam = await aba.avaliar(`${JSON.stringify(usados)}.filter((n) => / is not defined/.test(require('__debug').debugUnresolvedDependencies([n])))`);
  conferir('tem tudo que a extensão usa', faltam.length === 0, faltam.join(', ') || `${usados.length} módulos`);
  const lido = await aba.avaliar(`(async () => {
    const bruto = Uint8Array.from(atob(${JSON.stringify(bytesWebp.toString('base64'))}), (c) => c.charCodeAt(0));
    return require('WAWebWebpParseWebp').parseWebp(bruto.buffer);
  })()`);
  conferir('o WhatsApp lê a animação', lido.singleLoopDuration === info.total && lido.firstFrameLength > 44, `uma volta ${lido.singleLoopDuration} ms, toca ${lido.animationDuration} ms`);
  conferir('o WhatsApp lê o nome do pacote', lido.stickerPackName === 'Figurinha com som');

  const nota = await aba.avaliar(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytesOgg).toString('base64'))}), (c) => c.charCodeAt(0));
    const fluxo = require('WAWebStartMediaDownloadQpl').startMediaDownloadQpl({ entryPoint: 'DownloadSoundStickerAudio' });
    const { result } = await require('WAWebMediaWorkerProxy').kaleidoscopeClassifyInWorker({ mediaType: 'sound-sticker-audio', rawMimeType: 'audio/ogg; codecs=opus', input: bytes.buffer, eventFlow: fluxo });
    return result;
  })()`);
  conferir('a checagem de segurança do WhatsApp aprova o som', nota.success && nota.value.mimetype === 'audio/ogg' && nota.value.score < 80, `suspeita ${nota.value?.score}, recusa a partir de 80`);

  console.log('\n6. Envio pelo código real do WhatsApp (só a rede e o banco são de mentira)');
  await aba.avaliar(`(() => {
    const b64 = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))));
    const { createWid } = require('WAWebWidFactory');
    const para = createWid('5511999999999@c.us');
    const prefs = require('WAWebUserPrefsMeUser');
    const eu = { pn: createWid('5511888888888@c.us'), lid: createWid('222222222222222@lid') };
    prefs.getMaybeMePnUser = () => eu.pn;
    prefs.getMaybeMeLidUser = () => eu.lid;
    prefs.getMaybeMeDevicePn = () => createWid('5511888888888:7@c.us');
    prefs.getMaybeMeDeviceLid = () => createWid('222222222222222:7@lid');

    window.__t = { subidas: [], envios: [], recentes: [], nuvem: new Map(), eventos: [] };
    const chat = new (require('WAWebChatModel').Chat)({ id: para });
    Object.defineProperty(chat, 'formattedTitle', { value: 'Conversa de teste' });
    require('WAWebChatCollection').ChatCollection.getActive = () => chat;
    require('WAWebDBUpdateMessageTable').updateMessageTable = async () => {};
    require('WAWebRecentStickerCollectionMd').RecentStickerCollectionMd.addStickerWithMediaData = (m) => __t.recentes.push(Boolean(m.stickerAudio));

    // A cifragem é a real; só não há servidor para receber.
    require('WAWebUploadManager').encryptAndUpload = async (o) => {
      const plano = o.blob instanceof Blob ? await o.blob.arrayBuffer() : o.blob;
      const mediaKey = o.mediaKey ?? b64(32);
      const c = await require('WAWebCryptoEncryptMedia')({ type: o.type, plaintext: plano, mediaKey });
      __t.subidas.push({ tipo: o.type, tam: plano.byteLength, comeco: String.fromCharCode(...new Uint8Array(plano.slice(0, 4))), primeiroQuadro: c.firstFrameSidecar?.byteLength ?? 0 });
      const directPath = '/v/t62.7117-24/' + o.type + __t.nuvem.size;
      __t.nuvem.set(directPath, c.ciphertextHmac);
      return { directPath, encFilehash: c.hash, mediaKey, mediaKeyTimestamp: 1795000000, url: 'https://mmg.whatsapp.net' + directPath, sidecar: c.sidecar, firstFrameSidecar: c.firstFrameSidecar };
    };
    require('WAWebSendMsgChatAction').addAndSendMsgToChat = (chat, dados, antes) => {
      const fim = (async () => {
        const msg = await antes(new (require('WAWebMsgModel').Msg)(await dados));
        const certo = { messageSendResult: require('WAWebSendMsgResultAction').SendMsgResult.OK };
        if (__t.modo === 'por fora') return certo;
        if (__t.modo === 'perde o som') msg.stickerAudio = undefined;
        const proto = require('WAWebOutgoingMessage').createOutgoingMsgModelProtobuf('chat', msg);
        const codificado = require('encodeProtobuf').encodeProtobuf(require('WAWebProtobufsE2E.pb').MessageSpec, proto);
        const bytes = codificado instanceof Uint8Array ? codificado : new Uint8Array(codificado.readByteArrayView?.() ?? codificado.readBuffer?.() ?? codificado);
        __t.envios.push({
          para: chat.id.toString(),
          msg: { size: msg.size, filehash: msg.filehash, isAnimated: msg.isAnimated, firstFrameLength: msg.firstFrameLength, som: msg.stickerAudio },
          rotulo: [require('WAWebE2EProtoUtils').typeAttributeFromProtobuf(proto), require('WAWebBackendJobsCommon').mediaTypeFromProtobuf(proto)],
          proto: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')),
        });
        return certo;
      })();
      return [fim, fim];
    };
  })()`);
  await aba.esperar(`[...${PAINEL}.querySelectorAll('.principal')].some(b => b.textContent.includes('Enviar para Conversa de teste') && !b.disabled)`, 8000, 'botão com o nome da conversa');
  conferir('o botão mostra para quem vai', true);
  await aba.avaliar(`[...${PAINEL}.querySelectorAll('.principal')].find(b => b.textContent.includes('Enviar para')).click()`);
  await aba.esperar(`!${PAINEL}.querySelector('.recibo').hidden || !${PAINEL}.querySelector('.aviso').hidden`, 20000, 'resposta do envio');
  await dormir(300);
  await aba.foto(join(SAIDA, '5-enviada.png'));
  const recibo = await aba.avaliar(`${PAINEL}.querySelector('.recibo').innerText + ' | ' + ${PAINEL}.querySelector('.aviso').innerText`);
  conferir('o painel confirma que saiu com som', recibo.includes('Enviada com som para Conversa de teste'), recibo.replace(/\n/g, ' '));
  for (const [modo, nome, texto] of [
    ['perde o som', 'o painel avisa quando o som se perde', 'não levou o som'],
    ['por fora', 'o painel não afirma o que não deu para conferir', 'não deu para conferir'],
  ]) {
    await aba.avaliar(`__t.modo = ${JSON.stringify(modo)}; [...${PAINEL}.querySelectorAll('.principal')].find(b => b.textContent.includes('Enviar para')).click()`);
    await aba.esperar(`${PAINEL}.querySelector('.recibo').innerText.includes(${JSON.stringify(texto)})`, 20000, nome);
    conferir(nome, await aba.avaliar(`!${PAINEL}.querySelector('.recibo').classList.contains('certo')`), (await aba.avaliar(`${PAINEL}.querySelector('.recibo').innerText`)).replace(/\n/g, ' '));
  }
  const t = await aba.avaliar(`({ subidas: __t.subidas, envios: __t.envios, recentes: __t.recentes })`);
  const envio = t.envios[0];
  const [somEnviado, figurinhaEnviada] = t.subidas;
  conferir('o som sobe como áudio Ogg', somEnviado?.tipo === 'audio' && somEnviado.comeco === 'OggS' && somEnviado.tam === bytesOgg.length, `${somEnviado?.tam} bytes`);
  conferir('a imagem sobe como figurinha animada', figurinhaEnviada?.tipo === 'sticker' && figurinhaEnviada.tam === bytesWebp.length && figurinhaEnviada.primeiroQuadro > 0, `${figurinhaEnviada?.tam} bytes`);
  const { createHash } = await import('node:crypto');
  const digital = (b) => createHash('sha256').update(b).digest('base64');
  conferir('impressões digitais da imagem e do som conferem', envio?.msg.filehash === digital(bytesWebp) && envio.msg.som.filehash === digital(bytesOgg));
  conferir('entra nas recentes com o som', t.recentes[0] === true);
  if (envio) {
    const proto = new Uint8Array(Buffer.from(envio.proto, 'base64'));
    writeFileSync(join(SAIDA, 'mensagem.bin'), proto);
    // Message.audioStickerMessage(134) > message(1) > stickerMessage(26) > audioMessage(26)
    const figurinha = lerCampo(proto, [134, 1, 26]);
    const som = lerCampo(proto, [134, 1, 26, 26]);
    conferir('a mensagem sai no formato novo (campo 134)', Boolean(figurinha));
    conferir('com o som dentro da figurinha', Boolean(som), som && `${Buffer.from(lerCampo(som, [2]) ?? []).toString()}, ${lerCampo(som, [5])} s, ${lerCampo(som, [4])} bytes`);
    conferir('e nada solto fora dela', lerCampo(proto, [26]) === undefined);
    conferir('o envelope é o de uma figurinha comum', envio.rotulo.join(' ') === 'media sticker', envio.rotulo.join(' '));
  }

  console.log('\n7. Quem recebe (o leitor, a bolha e o tocador são os do WhatsApp)');
  const lida = await aba.avaliar(`(() => {
    const { createWid } = require('WAWebWidFactory');
    const de = createWid('5511999999999@c.us');
    const MsgKey = require('WAWebMsgKey').default ?? require('WAWebMsgKey');
    const bytes = Uint8Array.from(atob(__t.envios[0].proto), (c) => c.charCodeAt(0));
    const dados = require('WAWebE2EProtoParser').parseMsgProto({
      messageProtobuf: require('decodeProtobuf').decodeProtobuf(require('WAWebProtobufsE2E.pb').MessageSpec, bytes),
      message: { id: new MsgKey({ fromMe: false, remote: de, id: '3EB0AAAAAAAAAAAAAAAA' }), from: de, to: require('WAWebUserPrefsMeUser').getMaybeMePnUser(), t: 1795000000, ack: 1, local: false, self: 'in' },
      msgContext: 'relay',
    });
    const msg = (__t.msg = new (require('WAWebMsgModel').Msg)(dados));
    const { MsgCollection } = require('WAWebMsgCollection');
    const get = MsgCollection.get.bind(MsgCollection);
    MsgCollection.get = (k) => (String(k) === String(msg.id) ? msg : get(k));
    const { ChatCollection } = require('WAWebChatCollection');
    const chat = ChatCollection.getActive();
    const getChat = ChatCollection.get.bind(ChatCollection);
    ChatCollection.get = (k) => (String(k) === String(de) ? chat : getChat(k));
    require('WAWebMmsClient').download = async (o) => {
      __t.eventos.push('baixou ' + o.type);
      return __t.nuvem.get(o.directPath).slice(0);
    };
    const tocar = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.tagName === 'AUDIO') for (const tipo of ['playing', 'ended', 'error']) this.addEventListener(tipo, () => __t.eventos.push(tipo + ' ' + this.duration.toFixed(3)), { once: true });
      return tocar.call(this);
    };
    return { tipo: msg.type, animada: msg.isAnimated, imagem: msg.filehash, som: msg.stickerAudio };
  })()`);
  conferir('a mensagem é lida como figurinha animada com som', lida.tipo === 'sticker' && lida.animada === true && lida.som?.duration === 5, lida.som && `${lida.som.mimetype}, ${lida.som.duration} s, ${lida.som.size} bytes`);
  conferir('com a imagem e o som que saíram daqui', lida.imagem === digital(bytesWebp) && lida.som?.filehash === digital(bytesOgg));
  await aba.avaliar(`(() => {
    const caixa = Object.assign(document.createElement('div'), { id: 'conversa-de-teste' });
    caixa.style.cssText = 'position:fixed;left:40px;top:40px;width:260px;padding:24px;background:#efeae2;z-index:99999';
    // As cores e medidas do aplicativo, que a tela de entrada não usa: só para a foto.
    const regras = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules] } catch { return [] } });
    caixa.className = regras.find((r) => r.cssText.includes('--WDS-persistent-always-black-RGB:'))?.selectorText.split('.')[1] ?? '';
    document.body.append(caixa);
    const modulo = require('WAWebMessageStickerBubble.react');
    const { msg } = __t;
    require('ReactDOM').createRoot(caixa).render(require('react').createElement(modulo.default ?? modulo, { displayAuthor: false, displayType: 'CONVERSATION', mediaData: msg.mediaData, msgKey: msg.id, position: 'SINGLE' }));
  })()`);
  const SOM = `document.querySelector('#conversa-de-teste [data-testid=sound-sticker-button]')`;
  await aba.esperar(`!!${SOM}`, 15000, 'botão de som na conversa');
  conferir('a conversa mostra o botão de som do WhatsApp', await aba.avaliar(`${SOM}.getAttribute('aria-pressed') === 'false'`), await aba.avaliar(`${SOM}.title`));
  await dormir(1200);
  await aba.avaliar(`${SOM}.click()`);
  await aba.esperar(`__t.eventos.some((e) => e.startsWith('playing'))`, 10000, 'som tocando');
  conferir('clicar baixa, decifra, confere e toca', await aba.avaliar(`${SOM}.getAttribute('aria-pressed') === 'true' && __t.eventos.includes('baixou audio')`), (await aba.avaliar(`__t.eventos`)).join(', '));
  await aba.foto(join(SAIDA, '6-conversa.png'), { x: 40, y: 40, width: 308, height: 308 });
  await aba.esperar(`${SOM}.getAttribute('aria-pressed') === 'false'`, 9000, 'fim do som');
  const eventos = await aba.avaliar(`__t.eventos`);
  conferir('toca até o fim', eventos.some((e) => e.startsWith('ended')) && !eventos.some((e) => e.startsWith('error')), eventos.join(', '));

  console.log('\n8. Console');
  const ruins = aba.mensagens.filter(([tipo, texto]) => (tipo === 'error' || tipo === 'erro') || /Figurinha com Som/.test(texto));
  conferir('nenhum erro da extensão', ruins.filter(([, x]) => /figurinha|figsom|nucleo|painel|ponte|unknown module/i.test(x)).length === 0, ruins.map(([, x]) => x.slice(0, 160)).join(' || '));
} catch (e) {
  falhas++;
  console.error('\nPAROU:', e);
} finally {
  await chrome.fechar();
}
console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
process.exitCode = falhas ? 1 : 0;
