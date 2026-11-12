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

// --- WEB SUNUCUSU (Bağlantı için) ---
app.get('/', (req, res) => res.send('Bot aktif! /qr adresine git.'));

app.get('/qr', async (req, res) => {
  if (isReady) return res.send('<h1 style="color:green;text-align:center;margin-top:50px;">✅ Koçun Aktif! WhatsApp\'tan kurduğun özel gruba mesaj atabilirsin.</h1>');
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

// --- GEMINI YAPAY ZEKA ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: "Sen kullanıcının kişisel yaşam ve spor koçusun. Tavrın motive edici, disiplinli, samimi ve sonuç odaklı olmalı."
});

// --- WHATSAPP BOT ÇEKİRDEĞİ ---
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  
  let waVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
  } catch (e) {}

  const sock = makeWASocket({
    ...(waVersion ? { version: waVersion } : {}),
    auth: state,
    logger: pino({ level: 'silent' }), // Kafa karıştıran şifreleme loglarını kapattık
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    markOnlineOnConnect: true
  });

  activeSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) latestQR = qr;

    if (connection === 'open') {
      console.log('🚀 DİKKAT: WhatsApp Yaşam & Spor Koçun Bulutta Aktif!');
      isReady = true;
      latestQR = '';
    }

    if (connection === 'close') {
      isReady = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(connectToWhatsApp, 2000); // 515 gelse bile 2 saniyede ayağa kalkar
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      if (!msg.message) continue;

      // Zarfı çok basit bir şekilde soyuyoruz
      let text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (!text && msg.message?.deviceSentMessage?.message) {
        text = msg.message.deviceSentMessage.message?.conversation || msg.message.deviceSentMessage.message?.extendedTextMessage?.text;
      }
      
      // Eğer metin yoksa veya botun kendi attığı görünmez imzalı (\u200B) mesajsa atla
      if (!text || text.includes('\u200B')) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      // SADECE senin gönderdiğin mesajlara cevap ver (Başkası botu kullanamaz)
      if (msg.key.fromMe) {
        console.log(`📩 YAKALANDI: "${text}"`);
        try {
          const chat = model.startChat();
          const result = await chat.sendMessage(text);
          // Cevabın sonuna boşluk karakteri ekliyoruz ki bot kendi kendine döngüye girmesin
          const replyText = result.response.text() + '\u200B'; 

          // Mesajı geldiği yere (ister grup, ister sohbet) geri gönder
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