/* Figurinha com Som: o botão da extensão na barra do navegador. */
const ENDERECO = 'https://web.whatsapp.com/';

/** Põe a extensão em uma aba do WhatsApp que já estava aberta (sem recarregar). */
async function injetar(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/ponte.js'], world: 'MAIN' });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/nucleo.js', 'src/estilo.js', 'src/painel.js'] });
}

chrome.runtime.onInstalled.addListener(async () => {
  for (const aba of await chrome.tabs.query({ url: `${ENDERECO}*` })) {
    injetar(aba.id).catch((e) => console.warn('Não consegui entrar na aba aberta:', e));
  }
});

chrome.action.onClicked.addListener(async (aba) => {
  if (!aba.url?.startsWith(ENDERECO)) {
    const [existente] = await chrome.tabs.query({ url: `${ENDERECO}*` });
    if (!existente) {
      await chrome.tabs.create({ url: ENDERECO });
      return;
    }
    await chrome.tabs.update(existente.id, { active: true });
    await chrome.windows.update(existente.windowId, { focused: true });
    chrome.tabs.sendMessage(existente.id, { tipo: 'abrir' }).catch(() => {});
    return;
  }
  try {
    await chrome.tabs.sendMessage(aba.id, { tipo: 'alternar' });
  } catch {
    await injetar(aba.id);
    await chrome.tabs.sendMessage(aba.id, { tipo: 'alternar' });
  }
});
