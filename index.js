const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';

app.get('/', (req, res) => res.send('Bot aktif! QR için /qr adresine gidin.'));

app.get('/qr', async (req, res) => {
  if (!latestQR) {
    return res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>QR kod hazırlanıyor veya zaten giriş yapıldı!</h2>
        <p>Lütfen 10-15 saniye bekleyip sayfayı yenileyin (F5).</p>
      </div>
    `);
  }
  try {
    const qrImage = await QRCode.toDataURL(latestQR);
    res.send(`
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:90vh; font-family:sans-serif;">
        <h1 style="color:#25D366;">WhatsApp Koçluk Botu Eşleştirme</h1>
        <img src="${qrImage}" style="width:280px; height:280px; border:3px solid #25D366; padding:15px; border-radius:12px;"/>
        <p style="margin-top:20px; font-size:18px;">Sayfayı <b>F5 yapıp yeniledikten hemen sonra</b> tara.</p>
      </div>
    `);
  } catch (err) {
    res.send('QR kod resme dönüştürülürken hata oluştu.');
  }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

const client = new Client({
  authStrategy: new LocalAuth(),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
  },
  puppeteer: {
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('✅ YENİ QR KODU ALINDI!');
  latestQR = qr;
});

client.on('ready', () => {
  console.log('🚀 WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
  latestQR = '';
});

// Botun kendi verdiği cevaplara tekrar cevap vererek sonsuz döngüye girmesini önleyen hafıza
const botMessages = new Set();

client.on('message_create', async (msg) => {
  // Eğer bu mesaj botun kendi attığı cevap ise işlem yapma
  if (botMessages.has(msg.id.id)) return;

  const isSelfMessage = msg.from === msg.to; // Kendine mesaj senaryosu
  const isIncoming = !msg.fromMe;           // Başkasından gelen mesaj

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
        setTimeout(() => botMessages.delete(sentMsg.id.id), 300000); // 5 dk sonra temizle
      }
    } catch (error) {
      console.error('Mesaj işleme hatası:', error);
    }
  }
});

client.initialize().catch(err => {
  console.error('Client başlatma hatası:', err);
});
