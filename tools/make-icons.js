/* Делает иконки Android (mipmap-*) из 1/icon-512.png. Запуск из корня проекта: node tools/make-icons.js */
const sharp = require('sharp'), fs = require('fs');
(async () => {
  for (const [n, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    const d = 'android/app/src/main/res/mipmap-' + n; fs.mkdirSync(d, { recursive: true });
    const sq = await sharp('1/icon-512.png').resize(s, s).png().toBuffer();
    fs.writeFileSync(d + '/ic_launcher.png', sq);
    fs.writeFileSync(d + '/ic_launcher_foreground.png', sq);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`);
    fs.writeFileSync(d + '/ic_launcher_round.png', await sharp(sq).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer());
  }
  console.log('иконки Android созданы');
})().catch(e => { console.error(e); process.exit(1); });
