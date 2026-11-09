const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';
let isReady = false;
let clientError = '';

app.get('/', (req, res) => res.send('Bot aktif çalışıyor! QR için /qr adresine gidin.'));

app.get('/qr', async (req, res) => {
  if (isReady) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px; color:#25D366;">
        <h1>✅ WhatsApp Bağlantısı Başarılı!</h1>
        <p style="color:#333; font-size:18px;">Botunuz aktif ve mesajlarınızı bekliyor.</p>
      </div>
    `);
  }

  if (clientError) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px; color:red;">
        <h2>⚠️ Bağlantı Uyarısı:</h2>
        <p>${clientError}</p>
      </div>
    `);
  }

  if (!latestQR) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>⏳ QR kod hazırlanıyor... (Sunucu başlatılıyor)</h2>
        <p>Lütfen 15-20 saniye bekleyip sayfayı yenileyin (F5).</p>
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
  model: "gemini-1.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

// Ultra hafif RAM optimizasyonlu Puppeteer ayarları
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--mute-audio',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-ipc-flooding-protection',
      '--disable-notifications',
      '--disable-popup-blocking',
      '--disable-print-preview',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-speech-api',
      '--disable-sync',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--no-pings'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('✅ YENİ QR KODU ALINDI!');
  latestQR = qr;
  isReady = false;
});

client.on('authenticated', () => {
  console.log('🔑 OTURUM DOĞRULANDI!');
});

client.on('ready', () => {
  console.log('🚀 WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
  latestQR = '';
  isReady = true;
});

client.on('auth_failure', (msg) => {
  console.error('❌ OTURUM BAŞARISIZ:', msg);
  clientError = 'Oturum doğrulaması başarısız oldu.';
});

const botMessages = new Set();

client.on('message_create', async (msg) => {
  if (botMessages.has(msg.id.id)) return;

  const isSelfMessage = msg.from === msg.to;
  const isIncoming = !msg.fromMe;

  if (isIncoming || isSelfMessage) {
    try {
      console.log(`📩 Yeni mesaj alındı: ${msg.body}`);
      const chat = model.startChat();
      const result = await chat.sendMessage(msg.body);
      const response = await result.response;
      const replyText = response.text();

      const sentMsg = await msg.reply(replyText);
      if (sentMsg && sentMsg.id) {
        botMessages.add(sentMsg.id.id);
        setTimeout(() => botMessages.delete(sentMsg.id.id), 300000);
      }
    } catch (error) {
      console.error('Mesaj işleme hatası:', error);
    }
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Yakalanamayan Hata:', reason);
});

client.initialize().catch(err => {
  console.error('Client başlatma hatası:', err);
  clientError = err.message;
});
