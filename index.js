const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino'); // Hataları kusması için log kütüphanesi

const app = express();
app.listen(process.env.PORT || 3000, () => console.log('Sunucu dinliyor.'));
app.get('/', (req, res) => res.send('Röntgen Modu Aktif'));

async function xRayBaslat() {
  const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
  
  const sock = makeWASocket({
    auth: state,
    // DİKKAT: 'trace' seviyesi WhatsApp'ın ciğerini loglara basar.
    logger: pino({ level: 'trace' }), 
    browser: Browsers.macOS('Desktop'),
    emitOwnEvents: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
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