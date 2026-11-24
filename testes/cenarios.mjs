/*
 * Cenários variados da extensão, na tela de entrada do WhatsApp Web, sem conta.
 *
 *   node testes/cenarios.mjs
 *
 * Cria os arquivos de teste com o ffmpeg na primeira vez.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { abrirChrome, dormir } from './chrome.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const EXTENSAO = resolve(aqui, '..', 'extensao');
const SAIDA = resolve(aqui, 'saida', 'cenarios');
const MIDIA = resolve(aqui, 'saida', 'midia');
rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });
mkdirSync(MIDIA, { recursive: true });

const ff = (nome, ...args) => {
  const destino = join(MIDIA, nome);
  if (!existsSync(destino)) execFileSync('ffmpeg', ['-y', '-v', 'error', ...args, destino]);
  return destino;
};
const x264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
const M = {
  vertical: ff('vertical.mp4', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=60:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', ...x264, '-c:a', 'aac', '-shortest'),
  longo: ff('longo.mp4', '-f', 'lavfi', '-i', 'mandelbrot=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=120', '-t', '120', ...x264, '-c:a', 'aac'),
  mudo: ff('mudo.mp4', '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30:duration=4', ...x264),
  gif: ff('gif.gif', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=3'),
  foto: ff('foto.png', '-f', 'lavfi', '-i', 'testsrc2=size=900x600:rate=1:duration=1', '-frames:v', '1'),
  musica: ff('musica.mp3', '-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*(200+60*t)*t):d=22:s=44100', '-c:a', 'libmp3lame'),
  largo: ff('largo.mp4', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=12', '-f', 'lavfi', '-i', 'anoisesrc=d=12:c=pink', ...x264, '-c:a', 'aac'),
  semduracao: ff('semduracao.webm', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=6', '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', '-live', '1'),
};

let falhas = 0;
const conferir = (nome, ok, detalhe = '') => {
  if (!ok) falhas++;
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? `  (${detalhe})` : ''}`);
};
const PY = `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); n = getattr(im, 'n_frames', 1); ds = []
for i in range(n):
    im.seek(i); im.load(); ds.append(im.info.get('duration', 0))
im.seek(0); r = im.convert('RGBA')
print(json.dumps({'tam': im.size, 'n': n, 'total': sum(ds), 'canto': r.getpixel((2, 2))[3], 'lado': r.getpixel((2, 256))[3], 'meio': r.getpixel((256, 256))[3]}))
`;
const verWebp = (c) => JSON.parse(execFileSync('python', ['-c', PY, c], { encoding: 'utf8' }));
const verOgg = (c) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', c], { encoding: 'utf8' }));

const P = `document.getElementById('figurinha-com-som').shadowRoot`;
const chrome = await abrirChrome();
try {
  await chrome.enviar('Extensions.loadUnpacked', { path: EXTENSAO });
  const aba = await chrome.aba();
  await aba.cdp('Page.setInterceptFileChooserDialog', { enabled: true });
  await aba.cdp('Page.navigate', { url: 'https://web.whatsapp.com/' });
  await aba.esperar(`!!document.getElementById('figurinha-com-som')?.shadowRoot`, 40000, 'painel');
  await aba.esperar(`typeof window.require === 'function' && document.body.innerText.length > 50`, 30000, 'página pronta');
  await aba.avaliar(`${P}.querySelector('.aba').click()`);

  const visivel = (seletor) => aba.avaliar(`(() => { const e = ${P}.querySelector(${JSON.stringify(seletor)}); return !!e && e.offsetParent !== null })()`);
  const clicar = (texto) => aba.avaliar(`(() => { const b = [...${P}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(texto)} && b.offsetParent !== null); if (!b) throw new Error('sem botão ' + ${JSON.stringify(texto)}); b.click(); return true })()`);
  const por = async (n, arquivo) => {
    const { result } = await aba.cdp('Runtime.evaluate', { expression: `${P}.querySelectorAll('input[type=file]')[${n}]` });
    await aba.cdp('DOM.setFileInputFiles', { files: [arquivo], objectId: result.objectId });
  };
  const abrir = async (arquivo) => {
    await por(0, arquivo);
    await dormir(150);
    await aba.esperar(`(() => { const b = ${P}.querySelectorAll('.rodape')[0]; const v = ${P}.querySelector('.giro'); return !b.hidden && v.offsetParent === null })()`, 40000, 'editor com ' + arquivo);
    await dormir(1500);
  };
  const som = async (arquivo) => {
    await por(1, arquivo);
    await aba.esperar(`${P}.querySelector('[data-valor=arquivo]').getAttribute('aria-pressed') === 'true'`, 15000, 'áudio aberto');
    await dormir(400);
  };
  const texto = (seletor) => aba.avaliar(`${P}.querySelector(${JSON.stringify(seletor)}).innerText`);
  const foto = (nome) => aba.foto(join(SAIDA, nome + '.png'));
  let numero = 0;
  const criar = async (nome) => {
    const antes = Date.now();
    await clicar('Criar figurinha');
    await aba.esperar(`!${P}.querySelectorAll('.rodape')[1].hidden || !${P}.querySelector('.aviso').hidden`, 180000, 'pronta: ' + nome);
    const aviso = await texto('.aviso');
    if (aviso) throw new Error(`${nome}: ${aviso}`);
    const ficha = await texto('.ficha');
    const pasta = join(SAIDA, `${++numero}-${nome}`);
    mkdirSync(pasta);
    await chrome.enviar('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: pasta });
    await clicar('Baixar');
    const quer = ficha.includes('sem som') ? 1 : 2;
    let lista = [];
    for (let i = 0; i < 60 && lista.length < quer; i++) {
      await dormir(200);
      lista = readdirSync(pasta).filter((f) => /\.(webp|ogg)$/.test(f));
    }
    const w = lista.find((f) => f.endsWith('.webp'));
    const o = lista.find((f) => f.endsWith('.ogg'));
    console.log(`      ${nome}: ${ficha.replace(/\s+/g, ' ')}  [${((Date.now() - antes) / 1000).toFixed(1)} s]`);
    return { ficha, webp: w && join(pasta, w), ogg: o && join(pasta, o), bytes: w && readFileSync(join(pasta, w)) };
  };

  console.log('\nTema escuro');
  await aba.avaliar(`document.body.classList.add('dark')`);
  await dormir(1400);
  await foto('escuro-vazio');
  await abrir(M.vertical);
  await foto('escuro-editor');
  conferir('o tema escuro chega ao painel', await aba.avaliar(`document.getElementById('figurinha-com-som').classList.contains('escuro')`));
  await aba.avaliar(`document.body.classList.remove('dark')`);

  console.log('\nVídeo em pé, círculo, tamanho leve');
  await clicar('Círculo');
  await clicar('Leve (500 KB)');
  await dormir(500);
  await foto('vertical-circulo');
  let r = await criar('circulo-leve');
  let w = verWebp(r.webp);
  conferir('cabe em 500 KB', r.bytes.length <= 490_000, `${r.bytes.length} bytes`);
  conferir('cantos transparentes e meio cheio', w.canto === 0 && w.meio === 255);
  conferir('60 fps viram a taxa certa, duração certa', w.total === 5000, `${w.n} quadros, ${w.total} ms`);

  console.log('\nVídeo em pé, inteiro');
  await clicar('Ajustar');
  await clicar('Inteiro');
  await clicar('Quadrado');
  await clicar('Nítida (1 MB)');
  await dormir(500);
  await foto('vertical-inteiro');
  r = await criar('inteiro');
  w = verWebp(r.webp);
  conferir('sobra dos lados fica transparente', w.lado === 0 && w.meio === 255);

  console.log('\nVídeo sem som');
  await abrir(M.mudo);
  conferir('a opção Do vídeo fica travada', await aba.avaliar(`${P}.querySelector('[data-valor=video]').disabled`));
  r = await criar('mudo');
  conferir('cria sem som', r.ficha.includes('sem som') && !r.ogg);

  console.log('\nVídeo com outro áudio');
  await abrir(M.largo);
  await som(M.musica);
  await foto('outro-audio');
  r = await criar('outro-audio');
  let o = verOgg(r.ogg);
  conferir('o som tem a duração do vídeo', Math.abs(Number(o.format.duration) - 5.006) < 0.03, `${o.format.duration} s`);

  console.log('\nFoto com áudio');
  await abrir(M.foto);
  conferir('a foto usa o áudio já escolhido', await aba.avaliar(`${P}.querySelector('[data-valor=arquivo]').getAttribute('aria-pressed') === 'true'`));
  await foto('foto-audio');
  r = await criar('foto-audio');
  w = verWebp(r.webp);
  o = verOgg(r.ogg);
  conferir('figurinha parada', w.n === 1 && w.tam[0] === 512 && r.bytes.subarray(12, 16).toString() === 'VP8X');
  conferir('com 10 s de som', Math.abs(Number(o.format.duration) - 10.006) < 0.03, `${o.format.duration} s`);

  console.log('\nGIF com áudio');
  await abrir(M.gif);
  r = await criar('gif-audio');
  w = verWebp(r.webp);
  conferir('a animação do GIF é mantida', w.n === 30 && w.total === 3000, `${w.n} quadros, ${w.total} ms`);
  conferir('com o som junto', Boolean(r.ogg));

  console.log('\nGravação sem duração no arquivo');
  await abrir(M.semduracao);
  r = await criar('sem-duracao');
  conferir('cria mesmo assim', verWebp(r.webp).total >= 4900);

  console.log('\nVídeo longo');
  await abrir(M.longo);
  await dormir(1500);
  conferir('aparece a barra de posição', await visivel('.rolagem'));
  await clicar('30 s');
  await dormir(300);
  conferir('avisa que passou do limite oficial', (await texto('.bloco .nota')).includes('limite oficial'), await texto('.bloco .nota'));
  await foto('longo-30s');
  r = await criar('longo-30s');
  conferir('30 s cabem no limite', r.bytes.length <= 950_000 && verWebp(r.webp).total === 30000, `${r.bytes.length} bytes`);

  console.log('\nArrastar as pontas do corte');
  await abrir(M.largo);
  const ponto = async (seletor) =>
    aba.avaliar(`(() => { const r = ${P}.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, l: r.left, w: r.width } })()`);
  const mouse = (type, x, y) => aba.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const arrastar = async (de, dx) => {
    await mouse('mousePressed', de.x, de.y);
    for (let i = 1; i <= 6; i++) await mouse('mouseMoved', de.x + (dx * i) / 6, de.y);
    await mouse('mouseReleased', de.x + dx, de.y);
    await dormir(150);
  };
  const tempos = () => aba.avaliar(`[...${P}.querySelectorAll('.passos output')].map(o => o.textContent)`);
  const t0 = await tempos();
  const trilho = await ponto('.trilho');
  await arrastar(await ponto('.alca.dir'), trilho.w * 0.25); // 12 s de vídeo: um quarto = 3 s
  const t1 = await tempos();
  conferir('a ponta do fim anda', t0[1] === '0:05,0' && Math.abs(parseFloat(t1[1].slice(2).replace(',', '.')) - 8) < 0.2, `${t0[1]} para ${t1[1]}`);
  await arrastar(await ponto('.alca.esq'), trilho.w * 0.125);
  const t2 = await tempos();
  conferir('a ponta do começo anda', Math.abs(parseFloat(t2[0].slice(2).replace(',', '.')) - 1.5) < 0.2, t2[0]);
  await arrastar(await ponto('.janela'), trilho.w * 0.2);
  const t3 = await tempos();
  conferir('o meio leva as duas juntas', parseFloat(t3[0].slice(2).replace(',', '.')) > 3.5, t3.join(' a '));
  await dormir(300);
  await foto('arrastado');
  const tela = await ponto('canvas.tela');
  const centro0 = await aba.avaliar(`(() => { const c = ${P}.querySelector('canvas.tela'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4001) h = (h * 31 + d[i]) | 0; return h })()`);
  await aba.avaliar(`${P}.querySelector('.redondo[aria-label=Pausar]')?.click()`);
  await dormir(200);
  await arrastar(tela, 60);
  await dormir(200);
  const centro1 = await aba.avaliar(`(() => { const c = ${P}.querySelector('canvas.tela'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4001) h = (h * 31 + d[i]) | 0; return h })()`);
  conferir('arrastar a prévia muda o enquadramento', centro0 !== centro1);

  console.log('\nCancelar no meio');
  await clicar('Criar figurinha');
  await dormir(500);
  await clicar('Cancelar');
  await aba.esperar(`!${P}.querySelectorAll('.rodape')[0].hidden`, 5000, 'volta ao editor');
  conferir('volta ao editor sem erro', await aba.avaliar(`${P}.querySelector('.aviso').hidden`));

  console.log('\nArquivo que não serve');
  await por(0, resolve(aqui, 'cenarios.mjs'));
  await aba.esperar(`!${P}.querySelector('.aviso').hidden`, 15000, 'aviso');
  conferir('avisa em vez de travar', (await texto('.aviso')).includes('Não consegui abrir'), await texto('.aviso'));

  console.log('\nConsole');
  const ruins = aba.mensagens.filter(([tipo, x]) => (tipo === 'error' || tipo === 'erro' || tipo === 'warning') && /figurinha|figsom|nucleo|painel|ponte|unknown module/i.test(x));
  conferir('nenhum erro da extensão', ruins.length === 0, ruins.map(([, x]) => x.slice(0, 200)).join(' || '));
} catch (e) {
  falhas++;
  console.error('\nPAROU:', e);
} finally {
  await chrome.fechar();
}
console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
process.exitCode = falhas ? 1 : 0;
