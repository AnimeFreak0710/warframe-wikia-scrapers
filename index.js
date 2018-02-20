'use strict';

const axios = require('axios');
const cmd = require('node-cmd');
const fs = require('fs-extra');
const cheerio = require('cheerio');

const transformWeapon = require('./transformWeapon');

let imageUrls;

const getLuaWeaponData = async () => {
  const { data } = await axios.get('http://warframe.wikia.com/wiki/Module:Weapons/data?action=edit');
  const $ = cheerio.load(data);
  return $('#wpTextbox1').text();
};

const convertWeaponDataToJson = async (luaWeapondata) => {
  const scriptlines = luaWeapondata.split('\n');

  // Remove return statement
  const modifiedScript = scriptlines
    .slice(0, scriptlines.length - 2)
    .join('\n');

  // Add JSON conversion
  const luaToJsonScript = `
    JSON = (loadfile "JSON.lua")()\n
    ${modifiedScript}\n
    print(JSON:encode(WeaponData))
  `;

  // Run updated JSON lua script
  if (!await fs.exists('./tmp')) {
    await fs.mkdir('./tmp');
  }
  await fs.writeFile('./tmp/weapondataToJson.lua', luaToJsonScript, {
    encoding: 'utf8',
    flag: 'w',
  });

  await new Promise(resolve => cmd.get('lua ./tmp/weapondataToJson.lua > ./tmp/weapondataraw.json', () => resolve()));
  const weapondataRaw = await fs.readFile('./tmp/weapondataraw.json', 'UTF-8');
  return weapondataRaw;
};

const getWeaponImageUrls = async (weapons) => {
  const titles = [];
  Object.keys(weapons).forEach((weaponName) => {
    titles.push(`File:${weapons[weaponName].Image}`);
  });

  // Split titles into batches of 50, the max allowed by the wikimedia API
  const titleBatches = [];
  while (titles.length > 0) {
    titleBatches.push(titles.splice(0, 50));
  }

  const urlRequests = titleBatches.map(titleBatch =>
    axios.get('http://warframe.wikia.com/api.php', {
      params: {
        action: 'query',
        titles: titleBatch.join('|'),
        prop: 'imageinfo',
        iiprop: 'url',
        format: 'json',
      },
    }));

  const fetchedImageUrls = await Promise.all(urlRequests).then((res) => {
    const urls = {};
    res.forEach(({ data }) => {
      Object.keys(data.query.pages).forEach((id) => {
        if (id > -1) {
          const title = data.query.pages[id].title.replace('File:', '');
          const { url } = data.query.pages[id].imageinfo[0];
          urls[title] = url;
        }
      });
    });
    return urls;
  });

  return fetchedImageUrls;
};

async function main() {
  const luaWeapondata = await getLuaWeaponData();
  const weapondata = JSON.parse(await convertWeaponDataToJson(luaWeapondata));

  imageUrls = await getWeaponImageUrls(weapondata.Weapons);

  const weapons = Object.keys(weapondata.Weapons).map(weaponName =>
    transformWeapon(weapondata.Weapons[weaponName], imageUrls));

  if (!await fs.exists('./build')) {
    await fs.mkdir('./build');
  }
  fs.writeFile('./build/weapondatafinal.json', JSON.stringify(weapons));
  fs.remove('./tmp');
}

main();