/*
 * Cliente mínimo do protocolo de depuração do Chrome, sem dependências.
 * Abre o Chrome instalado com um perfil temporário, sem som e sem janela.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CAMINHOS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function abrirChrome({ visivel = false } = {}) {
  const exe = CAMINHOS.find((c) => existsSync(c));
  if (!exe) throw new Error('Não achei o Chrome.');
  const perfil = mkdtempSync(join(tmpdir(), 'figsom-'));
  const processo = spawn(
    exe,
    [
      ...(visivel ? [] : ['--headless=new']),
      `--user-data-dir=${perfil}`,
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--mute-audio',
      '--window-size=1280,860',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const entrada = processo.stdio[3];
  const saida = processo.stdio[4];
  let sobra = Buffer.alloc(0);
  let numero = 0;
  const esperando = new Map();
  const ouvintes = new Set();

  saida.on('data', (dados) => {
    sobra = Buffer.concat([sobra, dados]);
    for (let fim; (fim = sobra.indexOf(0)) >= 0; ) {
      const m = JSON.parse(sobra.subarray(0, fim).toString('utf8'));
      sobra = sobra.subarray(fim + 1);
      if (m.id && esperando.has(m.id)) {
        const { ok, erro, metodo } = esperando.get(m.id);
        esperando.delete(m.id);
        if (m.error) erro(new Error(`${metodo}: ${m.error.message}`));
        else ok(m.result);
      } else for (const o of ouvintes) o(m);
    }
  });

  const enviar = (metodo, params = {}, sessionId) =>
    new Promise((ok, erro) => {
      const id = ++numero;
      esperando.set(id, { ok, erro, metodo });
      entrada.write(JSON.stringify({ id, method: metodo, params, sessionId }) + '\0');
    });

  return {
    enviar,
    ouvir(fn) {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
    async aba(url = 'about:blank') {
      const { targetId } = await enviar('Target.createTarget', { url, newWindow: true, width: 1280, height: 860 });
      const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
      const cdp = (metodo, params) => enviar(metodo, params, sessionId);
      const aba = {
        cdp,
        sessionId,
        mensagens: [],
        async avaliar(expressao, { gesto = true, contextId } = {}) {
          const r = await cdp('Runtime.evaluate', {
            expression: expressao,
            awaitPromise: true,
            returnByValue: true,
            userGesture: gesto,
            contextId,
          });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          return r.result.value;
        },
        async esperar(expressao, ms = 20000, nome = expressao) {
          const ate = Date.now() + ms;
          for (;;) {
            let v;
            try {
              v = await aba.avaliar(expressao);
            } catch {
              v = undefined; // a página ainda está carregando
            }
            if (v) return v;
            if (Date.now() > ate) throw new Error(`Passou do tempo esperando: ${nome}`);
            await dormir(120);
          }
        },
        async foto(caminho, recorte) {
          const { writeFileSync } = await import('node:fs');
          const { data } = await cdp('Page.captureScreenshot', { format: 'png', ...(recorte && { clip: { ...recorte, scale: 1 } }) });
          writeFileSync(caminho, Buffer.from(data, 'base64'));
        },
      };
      ouvintes.add((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Runtime.exceptionThrown') aba.mensagens.push(['erro', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text]);
        if (m.method === 'Runtime.consoleAPICalled') aba.mensagens.push([m.params.type, m.params.args.map((a) => a.value ?? a.description).join(' ')]);
        if (m.method === 'Log.entryAdded') aba.mensagens.push([m.params.entry.level, m.params.entry.text]);
      });
      await cdp('Runtime.enable');
      await cdp('Page.enable');
      await cdp('Log.enable');
      // Nem os relatórios que o próprio WhatsApp manda: nos testes, nada sai.
      await cdp('Network.enable');
      await cdp('Network.setBlockedURLs', { urls: ['*://crashlogs.whatsapp.net/*', '*://dit.whatsapp.net/*'] });
      return aba;
    },
    async fechar() {
      await enviar('Browser.close').catch(() => {});
      await new Promise((ok) => {
        processo.once('exit', ok);
        setTimeout(ok, 4000);
      });
      processo.kill();
      for (let i = 0; i < 10; i++) {
        try {
          rmSync(perfil, { recursive: true, force: true });
          break;
        } catch {
          await dormir(300);
        }
      }
    },
  };
}
