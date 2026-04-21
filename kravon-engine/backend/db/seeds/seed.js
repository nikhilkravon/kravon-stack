'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const seedSpiceOfIndia = require('./spice-of-india');
const seedDeadFlatCo   = require('./dead-flat-co');

async function main() {
  console.log('Running all seeds...');
  await seedSpiceOfIndia();
  await seedDeadFlatCo();
  console.log('All seeds complete.');
  process.exit(0);
}

main().catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
