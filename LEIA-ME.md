# Figurinha com Som

Extensão para o navegador que cria figurinhas com som no WhatsApp Web, a partir de um vídeo
(ou de uma imagem ou GIF com um áudio à parte). A figurinha sai no formato novo do próprio
WhatsApp: imagem e som na mesma mensagem, não uma figurinha seguida de um áudio.

A conversão acontece inteira no seu computador. Nada é enviado a lugar nenhum até você clicar
em **Enviar**, e aí vai só para a conversa que está aberta.

## Instalar

Funciona no Chrome, Edge, Brave e Opera (versão 111 ou mais nova). No aplicativo do WhatsApp
para Windows não dá para instalar extensão: use o site.

1. Abra `chrome://extensions` (no Edge, `edge://extensions`).
2. Ligue **Modo do desenvolvedor**, no canto de cima à direita.
3. Clique em **Carregar sem compactação** e escolha a pasta `extensao` daqui de dentro.
4. Abra ou recarregue `https://web.whatsapp.com`. Aparece uma aba verde na borda direita.

A pasta precisa continuar no mesmo lugar: o navegador lê a extensão direto dela.

## Usar

1. Abra a conversa para onde a figurinha vai.
2. Clique na aba verde da direita (ou no ícone da extensão) e solte o vídeo no painel.
3. Arraste as pontas da faixa para escolher o trecho, e arraste a prévia para enquadrar.
4. **Criar figurinha**, ouça como ficou, e depois **Enviar para (nome da conversa)**.

No mesmo painel dá para:

- trocar o som do vídeo por outro áudio, ou deixar sem som;
- usar uma foto ou um GIF e colocar um áudio por cima;
- escolher quadrado, arredondado ou círculo, dar zoom, ajustar o volume;
- baixar a imagem (`.webp`) e o som (`.ogg`) em vez de enviar.

Depois de enviar, o painel mostra um recibo que confere a mensagem que realmente saiu: ele diz
se o som foi junto, se não foi, ou se não deu para conferir.

Nas conversas, as figurinhas com som passam a ter o botão de som do próprio WhatsApp, no canto de
cima à direita. Ele já vem no WhatsApp Web, só fica desligado até o recurso ser liberado para a conta.

## O que saber antes

- **O recurso é novo.** Quem recebe precisa de um WhatsApp que já conheça figurinha com som. Em
  versão antiga aparece um aviso pedindo para atualizar. Teste primeiro na sua própria conversa.
- **Duração.** O limite oficial é 5 s para figurinha de vídeo e 10 s para imagem. O painel deixa
  ir até 30 s, mas avisa: acima do oficial não há garantia de que o celular toque.
- **Guardar a figurinha.** Favorite pelo celular. Favoritar pelo computador guarda só a imagem.
  As que você enviou ficam nas recentes do WhatsApp Web com o som.
- **Onde não funciona.** Canais, status e conversas com bots não aceitam figurinha com som.
- **Não é oficial.** A extensão usa as funções internas do WhatsApp Web. Uma atualização dele
  pode quebrar o envio (o painel avisa), e extensões assim não são previstas nos termos do
  WhatsApp: use para mandar figurinhas, não para disparo em massa.

## Por dentro

| Arquivo | O que faz |
| --- | --- |
| `extensao/src/nucleo.js` | Lê o arquivo, monta o WebP animado 512x512 e o som em Ogg/Opus |
| `extensao/src/painel.js` | O painel: corte, enquadramento, prévia, criação e envio |
| `extensao/src/ponte.js` | Fala com o WhatsApp Web: liga o suporte a som e envia a figurinha |
| `extensao/src/fundo.js` | O ícone da barra e as abas que já estavam abertas na instalação |

O formato na mensagem é
`audioStickerMessage (134) > message (1) > stickerMessage (26) > audioMessage (26)`.

## Testar

Precisa de Node 22 ou mais novo, Chrome instalado, `ffmpeg` e `ffprobe` no PATH, e Python com
Pillow. Os testes abrem um Chrome à parte, com perfil descartável, na tela de entrada do
WhatsApp Web de verdade. Não entram em conta nenhuma e não enviam nada.

```powershell
node testes\testar.mjs "C:\caminho\do\video.mp4"
```

```powershell
node testes\cenarios.mjs
```

O primeiro faz o caminho inteiro com um vídeo: passa a figurinha pelo código real de envio do
WhatsApp e depois pelo de quem recebe, até o som tocar na conversa (só a rede e o banco são de
mentira). Rode de novo quando o WhatsApp Web atualizar: ele também confere se tudo que a extensão
usa continua existindo. O segundo cobre os outros casos: vídeo em pé, sem som, com outro áudio,
foto, GIF, vídeo longo, cancelar no meio e arquivo que não serve. As fotos e os arquivos ficam em
`testes\saida`.
