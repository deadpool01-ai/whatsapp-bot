const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';
let activeSock = null;

app.get('/', (req, res) => res.send('Bot aktif! Bağlanmak için /qr adresine gidin.'));

app.get('/qr', async (req, res) => {
  let qrHtml = '<p>QR hazırlanıyor...</p>';
  if (latestQR) {
    try {
      const qrImage = await QRCode.toDataURL(latestQR);
      qrHtml = `<img src="${qrImage}" style="width:220px; height:220px; border:2px solid #ccc; padding:10px; border-radius:10px;"/>`;
    } catch (e) {}
  }

  res.send(`
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:90vh; font-family:sans-serif; text-align:center; padding:20px;">
      <h1 style="color:#25D366;">WhatsApp Röntgen Modu</h1>
      
      <div style="background:#f4f4f4; padding:20px; border-radius:12px; max-width:400px; width:100%; margin-bottom:25px;">
        <h3>Telefon Numarası ile Bağlan</h3>
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
  if (!activeSock) return res.send('Soket henüz hazır değil, 5 saniye sonra sayfayı yenile.');
  const cleanNumber = (req.query.number || '').replace(/\D/g, '');

  if (cleanNumber.length < 11) {
    return res.send('Hatalı numara! Başında 90 olacak şekilde gir. <a href="/qr">Geri Dön</a>');
  }

  try {
    console.log('📲 Eşleştirme kodu isteniyor:', cleanNumber);
    const code = await activeSock.requestPairingCode(cleanNumber);
    const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
    res.send(`
      <div style="font-family:sans-serif; text-align:center; padding-top:50px;">
        <h2>WhatsApp Eşleştirme Kodun:</h2>
        <div style="font-size:36px; font-weight:bold; letter-spacing:4px; color:#25D366; background:#f0fdf4; display:inline-block; padding:15px 30px; border-radius:12px; border:2px dashed #25D366; margin:20px 0;">
          ${formattedCode}
        </div>
        <p style="font-size:16px; color:#333;">Telefonunda <b>WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla -> Telefon numarasıyla bağla</b> kısmına bu kodu gir.</p>
      </div>
    `);
  } catch (err) {
    console.error('❌ Eşleştirme kodu hatası:', err);
    res.send(`Hata: ${err.message}. <a href="/qr">Tekrar Dene</a>`);
  }
});

app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda dinleniyor.`));

async function xRayBaslat() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'trace' }), 
    browser: Browsers.macOS('Desktop'),
    emitOwnEvents: true,
    syncFullHistory: false
  });

  activeSock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    if (qr) latestQR = qr;
    if (connection === 'open') {
      console.log('\n\n🚀 BAĞLANTI AÇIK! LÜTFEN GRUBA MESAJ AT...\n\n');
    }
  });

  sock.ev.on('messages.upsert', (m) => {
    console.log('\n\n🚨🚨🚨 WHATSAPP\'TAN BİR SİNYAL GELDİ 🚨🚨🚨');
    console.log(JSON.stringify(m, null, 2));
    console.log('\n\n');
  });
}

xRayBaslat();