const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
  if (isReady) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px; color:#25D366;">
        <h1>✅ WhatsApp Bağlantısı Başarılı!</h1>
        <p style="color:#333; font-size:18px;">Koçun aktif, WhatsApp'tan kendine mesaj atabilirsin.</p>
      </div>
    `);
  }

  let qrHtml = '<p>QR hazırlanıyor...</p>';
  if (latestQR) {
    try {
      const qrImage = await QRCode.toDataURL(latestQR);
      qrHtml = `<img src="${qrImage}" style="width:220px; height:220px; border:2px solid #ccc; padding:10px; border-radius:10px;"/>`;
    } catch (e) {}
  }

  res.send(`
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:90vh; font-family:sans-serif; text-align:center; padding:20px;">
      <h1 style="color:#25D366;">WhatsApp Koçluk Botu Bağlantısı</h1>
      
      <div style="background:#f4f4f4; padding:20px; border-radius:12px; max-width:400px; width:100%; margin-bottom:25px;">
        <h3>Telefon Numarası ile Bağlan</h3>
        <p style="font-size:14px; color:#555;">Numaranı başında <b>90</b> olacak şekilde yaz (Örn: 905321234567)</p>
        <form action="/pair" method="GET" style="display:flex; gap:8px; justify-content:center; margin-top:10px;">
          <input type="text" name="number" placeholder="905XXXXXXXXX" required style="padding:10px; font-size:16px; border:1px solid #ccc; border-radius:6px; width:180px;"/>
          <button type="submit" style="padding:10px 16px; font-size:16px; background:#25D366; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">Kod Al</button>
        </form>
      </div>

      <div>
        <h4>veya QR Kod ile Bağlan</h4>
        ${qrHtml}
      </div>
    </div>
  `);
});

app.get('/pair', async (req, res) => {
  if (!activeSock) return res.send('Soket henüz hazır değil, 5 saniye sonra geri dönüp tekrar dene.');
  const cleanNumber = (req.query.number || '').replace(/\D/g, '');

  if (cleanNumber.length < 11) {
    return res.send('Hatalı numara! Başında 90 olacak şekilde 12 haneli gir. <a href="/qr">Geri Dön</a>');
  }

  try {
    console.log('📲 Eşleştirme kodu isteniyor:', cleanNumber);
    const code = await activeSock.requestPairingCode(cleanNumber);
    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
    console.log('🔢 Üretilen Kod:', formattedCode);
    res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>WhatsApp Eşleştirme Kodun:</h2>
        <div style="font-size:36px; font-weight:bold; letter-spacing:4px; color:#25D366; background:#f0fdf4; display:inline-block; padding:15px 30px; border-radius:12px; border:2px dashed #25D366; margin:20px 0;">
          ${formattedCode}
        </div>
        <p style="font-size:16px; color:#333;">Telefonunda <b>WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla -> Telefon numarasıyla bağla</b> kısmına bu kodu gir.</p>
        <p style="margin-top:20px;"><a href="/qr">Durumu Kontrol Et</a></p>
      </div>
    `);
  } catch (err) {
    console.error('❌ Eşleştirme kodu hatası:', err);
    res.send(`Hata: ${err.message}. <a href="/qr">Tekrar Dene</a>`);
  }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

const botMessages = new Set();
const processedIds = new Set();
const messageStore = new Map();

async function connectToWhatsApp() {
  console.log('🔌 WhatsApp soketi başlatılıyor...');
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  
  let waVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
    console.log('📦 WhatsApp Web sürümü alındı:', waVersion);
  } catch (e) {
    console.log('⚠️ Sürüm alınamadı, varsayılan kullanılıyor.');
  }

  const sock = makeWASocket({
    ...(waVersion ? { version: waVersion } : {}),
    auth: state,
    logger: pino({ level: 'error' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    emitOwnEvents: true,
    getMessage: async (key) => {
      return messageStore.get(key.id) || { conversation: '' };
    }
  });

  activeSock = sock;
  sock.ev.on('creds.update', saveCreds);

  // En alt katman ham WebSocket mesaj dinleyicisi
  sock.ws.on('CB:message', (node) => {
    console.log('📡 Ham Sinyal Geldi | Kimden:', node?.attrs?.from, '| Tip:', node?.attrs?.type);
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (connection) console.log('🔄 Bağlantı durumu:', connection);

    if (qr) {
      console.log('✅ YENİ QR KODU ALINDI!');
      latestQR = qr;
      isReady = false;
    }

    if (connection === 'open') {
      console.log('🚀 WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
      console.log('👤 Bağlı Kullanıcı Bilgisi:', JSON.stringify(sock.user));
      latestQR = '';
      isReady = true;

      // Bağlantı açıldığı an kendine ilk mesajı atarak şifreleme oturumunu başlat
      const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
      sock.sendMessage(myJid, { text: '💪 Koçun aktif! Şifreleme oturumu kuruldu, bana bu sohbetten yazabilirsin.' })
        .then((sent) => {
          if (sent?.key?.id) botMessages.add(sent.key.id);
          console.log('📤 Başlangıç mesajı telefonuna gönderildi!');
        })
        .catch((err) => console.error('❌ Başlangıç mesajı hatası:', err));
    }

    if (connection === 'close') {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Bağlantı kapandı (Kod: ${statusCode}), yeniden bağlanılıyor:`, shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 2000);
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      if (!msg.message) continue;
      messageStore.set(msg.key.id, msg.message);
      if (botMessages.has(msg.key.id) || processedIds.has(msg.key.id)) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;

      let rawContent = msg.message;
      for (let i = 0; i < 4; i++) {
        if (rawContent?.deviceSentMessage?.message) rawContent = rawContent.deviceSentMessage.message;
        else if (rawContent?.ephemeralMessage?.message) rawContent = rawContent.ephemeralMessage.message;
        else if (rawContent?.viewOnceMessage?.message) rawContent = rawContent.viewOnceMessage.message;
        else if (rawContent?.viewOnceMessageV2?.message) rawContent = rawContent.viewOnceMessageV2.message;
        else break;
      }

      const text = rawContent?.conversation || rawContent?.extendedTextMessage?.text;
      console.log(`⚡ Paket Açıldı [${m.type}] | JID: ${remoteJid} | fromMe: ${msg.key.fromMe} | Metin: ${text || 'METİN YOK'}`);

      if (!text) continue;

      const myNumber = sock.user?.id?.split(':')[0]?.split('@')[0];
      const myLid = sock.user?.lid?.split(':')[0]?.split('@')[0];
      const remoteUser = remoteJid.split('@')[0].split(':')[0];
      const altUser = msg.key.remoteJidAlt?.split('@')[0]?.split(':')[0];

      const isSelfChat =
        (myNumber && (remoteUser === myNumber || altUser === myNumber)) ||
        (myLid && (remoteUser === myLid || altUser === myLid));
      const isIncoming = !msg.key.fromMe;

      if (isIncoming || isSelfChat) {
        processedIds.add(msg.key.id);
        setTimeout(() => processedIds.delete(msg.key.id), 300000);

        try {
          const chat = model.startChat();
          const result = await chat.sendMessage(text);
          const response = await result.response;
          const replyText = response.text();

          const sentMsg = await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
          if (sentMsg?.key?.id) {
            botMessages.add(sentMsg.key.id);
            setTimeout(() => botMessages.delete(sentMsg.key.id), 300000);
          }
          console.log('✅ Yanıt gönderildi!');
        } catch (error) {
          console.error('❌ Gemini veya mesaj gönderme hatası:', error);
        }
      }
    }
  });
}

connectToWhatsApp().catch(err => console.error('Başlatma hatası:', err));