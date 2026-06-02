const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

const BASE_DIR = path.join(__dirname, "assets/royal-tandoor");

const categories = {
  hero: {
    queries: [
      "indian restaurant interior luxury",
      "tandoor restaurant ambience"
    ],
    perQuery: 1
  },

  "gallery-food": {
    queries: [
      "indian curry dish",
      "tandoori chicken",
      "butter naan bread",
      "biryani rice dish",
      "indian dal makhani",
      "paneer tikka masala",
      "indian kebab platter",
      "indian dessert gulab jamun"
    ],
    perQuery: 2
  },

  "gallery-ambience": {
    queries: [
      "indian restaurant interior",
      "luxury dining room india",
      "indian restaurant decor",
      "candle light dining restaurant"
    ],
    perQuery: 1
  },

  "gallery-people": {
    queries: [
      "indian chef cooking tandoor",
      "restaurant waiter serving"
    ],
    perQuery: 1
  },

  "signature-dishes": {
    queries: [
      "tandoori chicken platter",
      "butter chicken indian food",
      "lamb rogan josh curry"
    ],
    perQuery: 1
  },

  promo: {
    queries: [
      "indian restaurant celebration dinner"
    ],
    perQuery: 1
  }
};

async function download(url, filepath) {
  const response = await axios({ method: "GET", url, responseType: "stream" });
  const writer = fs.createWriteStream(filepath);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function searchUnsplash(query, count) {
  const res = await axios.get("https://api.unsplash.com/search/photos", {
    params: { query, per_page: count, orientation: "landscape" },
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` }
  });
  return res.data.results;
}

async function run() {
  fs.mkdirSync(BASE_DIR, { recursive: true });

  for (const [folder, config] of Object.entries(categories)) {
    const folderPath = path.join(BASE_DIR, folder);
    fs.mkdirSync(folderPath, { recursive: true });

    let imageCounter = 1;

    for (const query of config.queries) {
      console.log(`  Searching: "${query}"`);
      const images = await searchUnsplash(query, config.perQuery);

      for (const img of images) {
        const fileName = `${folder}-${String(imageCounter).padStart(3, "0")}.jpg`;
        const destination = path.join(folderPath, fileName);
        await download(img.urls.regular, destination);
        console.log(`  Downloaded ${fileName}`);
        imageCounter++;
      }
    }

    console.log(`✓ ${folder} — ${imageCounter - 1} images`);
  }

  console.log("\nDone.");
}

run();
