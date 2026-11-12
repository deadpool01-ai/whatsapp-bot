const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';
let isReady = false;

app.get('/', (req, res) => res.send('Bot aktif! QR için /qr adresine gidin.'));

app.get('/qr', async (req, res) => {
  if (isReady) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px; color:#25D366;">
        <h1>✅ WhatsApp Bağlantısı Başarılı!</h1>
        <p style="color:#333; font-size:18px;">Koçun aktif ve mesajlarını bekliyor.</p>
      </div>
    `);
  }

  if (!latestQR) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>⏳ QR kod hazırlanıyor...</h2>
        <p>5-10 saniye bekleyip sayfayı yenileyin (F5).</p>
      </div>
    `);
  }

  try {
    const qrImage = await QRCode.toDataURL(latestQR);
    res.send(`
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:90vh; font-family:sans-serif;">
        <h1 style="color:#25D366;">WhatsApp Koçluk Botu Eşleştirme</h1>
        <img src="${qrImage}" style="width:280px; height:280px; border:3px solid #25D366; padding:15px; border-radius:12px;"/>
        <p style="margin-top:20px; font-size:18px;">Telefonundan <b>WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla</b> kısmından tara.</p>
      </div>
    `);
  } catch (err) {
    res.send('QR resme dönüştürülürken hata oluştu.');
  }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

const botMessages = new Set();

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Koc Botu', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('✅ YENİ QR KODU ALINDI!');
      latestQR = qr;
      isReady = false;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Bağlantı kapandı, yeniden bağlanılıyor:', shouldReconnect);
      isReady = false;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('🚀 WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
      latestQR = '';
      isReady = true;
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || botMessages.has(msg.key.id)) continue;

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      if (!text) continue;

      const myNumber = sock.user?.id?.split(':')[0];
      const remoteNumber = msg.key.remoteJid?.split('@')[0];
      const isSelfChat = myNumber && remoteNumber === myNumber;
      const isIncoming = !msg.key.fromMe;

      if (isIncoming || isSelfChat) {
        try {
          console.log(`📩 Mesaj alındı: ${text}`);
          const result = await model.generateContent(text);
          const replyText = result.response.text();

          const sentMsg = await sock.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
          if (sentMsg?.key?.id) {
            botMessages.add(sentMsg.key.id);
            setTimeout(() => botMessages.delete(sentMsg.key.id), 300000);
          }
        } catch (error) {
          console.error('Mesaj işleme hatası:', error);
        }
      }
    }
  });
}

connectToWhatsApp();
