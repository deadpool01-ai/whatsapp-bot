const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';
let isReady = false;
let activeSock = null;

app.get('/', (req, res) => res.send('Bot aktif! Bağlanmak için /qr adresine gidin.'));

app.get('/qr', async (req, res) => {
  if (isReady) return res.send('<h1 style="color:green;text-align:center;margin-top:50px;">✅ Koçun Aktif! WhatsApp "Siz" sohbetinden yazabilirsin.</h1>');
  let qrHtml = '<p>QR hazırlanıyor...</p>';
  if (latestQR) {
    try { qrHtml = `<img src="${await QRCode.toDataURL(latestQR)}" style="width:220px; border:2px solid #ccc; padding:10px; border-radius:10px;"/>`; } catch (e) {}
  }
  res.send(`
    <div style="text-align:center; padding:20px; font-family:sans-serif;">
      <h1 style="color:#25D366;">WhatsApp Bot Bağlantısı</h1>
      <div style="background:#f4f4f4; padding:20px; border-radius:12px; display:inline-block; margin-bottom:20px;">
        <h3>Telefon Numarası ile (Önerilen)</h3>
        <form action="/pair" method="GET">
          <input type="text" name="number" placeholder="905XXXXXXXXX" required style="padding:10px; font-size:16px;"/>
          <button type="submit" style="padding:10px; background:#25D366; color:white; border:none; cursor:pointer;">Kod Al</button>
        </form>
      </div>
      <div><h4>veya QR ile</h4>${qrHtml}</div>
    </div>
  `);
});

app.get('/pair', async (req, res) => {
  if (!activeSock) return res.send('Soket hazır değil, sayfayı yenile.');
  const num = (req.query.number || '').replace(/\D/g, '');
  if (num.length < 11) return res.send('Hatalı numara. <a href="/qr">Geri</a>');
  try {
    const code = await activeSock.requestPairingCode(num);
    res.send(`<h2 style="text-align:center; margin-top:50px;">Eşleştirme Kodun: <br><br><span style="color:#25D366; font-size:40px; letter-spacing:5px;">${code}</span></h2>`);
  } catch (err) { res.send(`Hata: ${err.message}`); }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    markOnlineOnConnect: true
  });

  activeSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('✅ YENİ QR KODU ALINDI!');
      latestQR = qr;
    }

    if (connection === 'open') {
      console.log('🚀 DİKKAT: WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
      isReady = true;
      latestQR = '';

      const myJid = state.creds.me?.id?.split(':')[0] + '@s.whatsapp.net';
      if (myJid && !myJid.startsWith('undefined')) {
        sock.sendMessage(myJid, { text: '💪 Koçun 7/24 aktif! Bana buradan hedeflerini yazabilirsin.\u200B' }).catch(() => {});
      }
    }

    if (connection === 'close') {
      isReady = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === 515) {
        console.log('🔄 WhatsApp senkronizasyon istedi (515). Toparlanıyor...');
      } else {
        console.log(`⚠️ Bağlantı koptu (Kod: ${code}). Yeniden bağlanıyor...`);
      }
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(connectToWhatsApp, 2000);
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      if (!msg.message) continue;

      let raw = msg.message;
      for (let i = 0; i < 4; i++) {
        if (raw?.deviceSentMessage?.message) raw = raw.deviceSentMessage.message;
        else if (raw?.ephemeralMessage?.message) raw = raw.ephemeralMessage.message;
        else if (raw?.viewOnceMessage?.message) raw = raw.viewOnceMessage.message;
        else if (raw?.viewOnceMessageV2?.message) raw = raw.viewOnceMessageV2.message;
        else break;
      }

      const text = raw?.conversation || raw?.extendedTextMessage?.text;
      if (!text || text.includes('\u200B')) continue;

      const now = Math.floor(Date.now() / 1000);
      if (now - Number(msg.messageTimestamp || now) > 60) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

      // Hem telefon numarası hem @lid kimliğini doğrudan diskten kontrol et
      const myNumber = state.creds.me?.id?.split(':')[0]?.split('@')[0];
      const myLid = state.creds.me?.lid?.split(':')[0]?.split('@')[0];
      const senderUser = remoteJid.split('@')[0].split(':')[0];
      const altUser = msg.key.remoteJidAlt?.split('@')[0]?.split(':')[0];

      const isSelfChat =
        (myNumber && (senderUser === myNumber || altUser === myNumber)) ||
        (myLid && (senderUser === myLid || altUser === myLid));
      const isIncoming = !msg.key.fromMe;

      if (isSelfChat || isIncoming) {
        console.log(`📩 YAKALANDI: "${text}"`);
        try {
          const chat = model.startChat();
          const result = await chat.sendMessage(text);
          const replyText = result.response.text() + '\u200B';

          await sock.sendMessage(remoteJid, { text: replyText });
          console.log('✅ YANIT İLETİLDİ!');
        } catch (error) {
          console.error('❌ Gemini Hatası:', error);
        }
      }
    }
  });
}

connectToWhatsApp();