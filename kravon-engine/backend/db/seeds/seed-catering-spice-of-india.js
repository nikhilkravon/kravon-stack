'use strict';

/**
 * SEED — catering content for spice-of-india
 *
 * Merges catering-specific CONFIG data into tenant.restaurants.settings.catering
 * so the catering frontend renderer can hydrate all sections from the API.
 *
 * Run:  node kravon-engine/backend/db/seeds/seed-catering-spice-of-india.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { query } = require('../pool');

const SLUG = 'spice-of-india';

const CATERING = {
  credBar: {
    items: [
      '200+ events catered',
      'Weddings & corporate dinners',
      'Live tandoor stations',
      'Delhi NCR & beyond',
      'FSSAI certified kitchen',
      'Full-service — setup to cleanup',
    ],
  },

  trustedBy: [
    'Taj Hotels', 'ITC Hotels', 'The Leela Palace',
    'Deloitte', 'Ernst & Young', 'Ministry of External Affairs',
    'The Imperial New Delhi', 'Shangri-La Eros',
  ],

  position: {
    label: 'Why Spice of India Catering?',
    body:  'We bring the same tandoor-fired flavours that packed our Connaught Place restaurant to your venue. One kitchen, one head chef — no outsourcing, no reheated food, no shortcuts. Whether you are hosting 30 guests or 1,500, every dish leaves our kitchen fresh.',
  },

  packages: {
    label:      'Packages',
    title:      ['Catering packages', 'for every occasion'],
    annotation: 'All packages include service staff,\nequipment, setup & post-event cleanup.',
    tiers: [
      {
        num:      '01',
        name:     'Dawaat',
        scope:    'Intimate gatherings & private dinners',
        price:    '₹950',
        typical:  '30–80 guests',
        stamp:    null,
        featured: false,
        includes: [
          '3 starters (veg + non-veg)',
          '3 main courses',
          'Bread basket (naan, paratha)',
          'Rice & biryani option',
          'Dessert (2 options)',
          'Service staff included',
        ],
      },
      {
        num:      '02',
        name:     'Mehfil',
        scope:    'Corporate events & mid-size celebrations',
        price:    '₹1,350',
        typical:  '80–300 guests',
        stamp:    'Most booked',
        featured: true,
        includes: [
          '5 starters (veg + non-veg)',
          '4 main courses',
          'Live tandoor station',
          'Bread counter',
          'Dessert spread (4 options)',
          'Soft beverages included',
          'Dedicated event coordinator',
        ],
      },
      {
        num:      '03',
        name:     'Shaadi',
        scope:    'Weddings, receptions & grand banquets',
        price:    'Custom',
        typical:  '300–2,000 guests',
        stamp:    null,
        featured: false,
        includes: [
          '7 starters (veg + non-veg)',
          '5 main courses',
          '2 live cooking stations',
          'Full dessert spread (6+ options)',
          'Premium beverage service',
          'Pre-event tasting session',
          'Dedicated event manager on-site',
        ],
      },
    ],
  },

  process: {
    label: 'How it works',
    title: ['From enquiry', 'to your table'],
    lede:  'We handle every detail. You focus on the occasion.',
    steps: [
      {
        n:      '01',
        title:  'Send us your brief',
        body:   'Tell us the event date, pax count, venue, and cuisine preferences. Takes two minutes.',
        timing: 'Day 1',
      },
      {
        n:      '02',
        title:  'We plan together',
        body:   'Our team visits your venue, designs a custom menu, and sends a detailed proposal within 48 hours.',
        timing: 'Day 2–3',
      },
      {
        n:      '03',
        title:  'Tasting session',
        body:   'For orders above 100 pax we arrange a complimentary tasting at our Connaught Place kitchen.',
        timing: '1–2 weeks out',
      },
      {
        n:      '04',
        title:  'We cook & serve',
        body:   'On the day, our full team handles setup, live cooking, service, and complete cleanup.',
        timing: 'Event day',
      },
    ],
  },

  capacity: {
    label:      'Scale & Reach',
    title:      ["We've catered", 'at every scale'],
    annotation: 'Available for banquet halls, farm houses,\nrooftops, open lawns & corporate venues\nacross Delhi NCR, Jaipur and Chandigarh.',
    cells: [
      { value: '200+', target: 200, unit: '',     label: 'Events catered',   sub: 'Since 2019' },
      { value: '30',   target: 30,  unit: '+',    label: 'Minimum pax',      sub: 'Intimate dinners' },
      { value: '2,000',target: 2000,unit: '',     label: 'Maximum pax',      sub: 'Grand banquets' },
      { value: '5',    target: 5,   unit: ' yrs', label: 'Of event catering', sub: 'Consistent quality' },
    ],
    compliance: [
      { label: 'Certification',  value: 'FSSAI licensed' },
      { label: 'Kitchen',        value: 'Dedicated catering kitchen' },
      { label: 'Dietary',        value: 'Jain · Halal · Vegan options' },
      { label: 'Insurance',      value: 'Event liability covered' },
    ],
  },

  menu: {
    label:      'Catering Menu',
    title:      ['A menu built', 'for your event'],
    annotation: 'Sample showcase — full menus\ncustomised per engagement.',
    footNotes:  [
      'All dishes made fresh on-site.',
      'Veg / non-veg splits available.',
      'Jain, Halal & dietary options on request.',
    ],
    tabs: [
      {
        id:    'starters',
        label: 'Starters',
        cols: [
          {
            heading: 'Vegetarian',
            items: [
              { dish: 'Paneer Tikka',          note: 'Tandoor-charred, mint chutney' },
              { dish: 'Dahi Ke Kebab',         note: 'Hung curd, cashew, cardamom' },
              { dish: 'Aloo Tikki Chaat',      note: 'Tamarind, yoghurt, pomegranate' },
              { dish: 'Hara Bhara Kebab',      note: 'Spinach, peas, coriander' },
              { dish: 'Samosa (bulk trays)',   note: 'Spiced potato, mint chutney' },
            ],
          },
          {
            heading: 'Non-Vegetarian',
            items: [
              { dish: 'Murgh Malai Kebab',     note: 'Cream marinade, live tandoor' },
              { dish: 'Seekh Kebab',           note: 'Minced lamb, charcoal grill' },
              { dish: 'Chicken 65',            note: 'Curry leaf, green chilli' },
              { dish: 'Tandoori Prawns',       note: 'Jumbo, yoghurt marinade' },
              { dish: 'Mixed Grill Platter',   note: 'Per-table sharing format' },
            ],
          },
        ],
      },
      {
        id:    'mains',
        label: 'Main Course',
        cols: [
          {
            heading: 'Gravies & Curries',
            items: [
              { dish: 'Butter Chicken',        note: 'Tomato cream, mild spice' },
              { dish: 'Paneer Butter Masala',  note: 'Same base, vegetarian' },
              { dish: 'Dal Makhani',           note: 'Slow-cooked overnight' },
              { dish: 'Lamb Rogan Josh',       note: 'Kashmiri spices, slow-braised' },
              { dish: 'Prawn Masala',          note: 'Coastal aromatics' },
              { dish: 'Palak Paneer',          note: 'Fresh spinach gravy' },
            ],
          },
          {
            heading: 'Rice & Breads',
            items: [
              { dish: 'Chicken Biryani',       note: 'Dum-cooked, saffron basmati' },
              { dish: 'Vegetable Biryani',     note: 'Seasonal vegetables, salan' },
              { dish: 'Jeera Rice',            note: 'Cumin tempered basmati' },
              { dish: 'Butter Naan',           note: 'Live tandoor, unlimited' },
              { dish: 'Laccha Paratha',        note: 'Flaky, ghee-finished' },
            ],
          },
        ],
      },
      {
        id:    'desserts',
        label: 'Desserts',
        cols: [
          {
            heading: 'Traditional Sweets',
            items: [
              { dish: 'Gulab Jamun',           note: 'Rose syrup, served warm' },
              { dish: 'Ras Malai',             note: 'Saffron milk, pistachios' },
              { dish: 'Gajar Halwa',           note: 'Slow-cooked, almond garnish' },
              { dish: 'Kulfi (bulk sticks)',   note: 'Malai, pista, mango' },
            ],
          },
          {
            heading: 'Live Stations',
            items: [
              { dish: 'Jalebi Counter',        note: 'Fresh-fried, rabri dip' },
              { dish: 'Chaat Station',         note: 'Pani puri, dahi puri, sev puri' },
              { dish: 'Ice Cream Trolley',     note: 'Seasonal flavours' },
              { dish: 'Meetha Paan',           note: 'Post-dinner tradition' },
            ],
          },
        ],
      },
    ],
  },

  testimonials: {
    label: 'Client Stories',
    title: ['Trusted by families,', 'corporates & event planners'],
    items: [
      {
        quote: "Spice of India catered our annual dinner for 340 employees. Flawless execution — the live tandoor station was packed all night. We've already booked them for next year.",
        name:  'Rajiv Mehta',
        role:  'Head of HR, Deloitte India',
        deal:  'Corporate dinner · 340 pax',
      },
      {
        quote: 'We had them for our reception at The Imperial. The butter chicken was exactly what we grew up eating. Guests are still talking about the food three months later.',
        name:  'Priya & Arjun Kapoor',
        role:  'Wedding clients',
        deal:  'Wedding reception · 600 pax',
      },
      {
        quote: 'We partner with Spice of India for overflow catering across our properties. Reliable, professional, and the quality is consistently excellent — exactly what you need when your own kitchen is at capacity.',
        name:  'Sunita Sharma',
        role:  'F&B Events Director, ITC Hotels',
        deal:  'Ongoing partnership · 10+ events',
      },
    ],
  },

  form: {
    label: 'Start a Proposal',
    title: ['Tell us about', 'your event'],
    intro: 'We respond to all enquiries within 2 hours on business days. No commitment required to get a quote.',
    steps: [
      { n: '1', txt: 'Tell us about your event' },
      { n: '2', txt: 'We build a custom proposal' },
      { n: '3', txt: 'You decide — zero pressure' },
    ],
    engagementTypes: [
      { id: 'type-wedding',    value: 'wedding',    label: 'Wedding / Reception' },
      { id: 'type-corporate',  value: 'corporate',  label: 'Corporate Event' },
      { id: 'type-birthday',   value: 'birthday',   label: 'Birthday / Anniversary' },
      { id: 'type-puja',       value: 'puja',       label: 'Puja / Religious' },
      { id: 'type-conference', value: 'conference', label: 'Conference / Workshop' },
      { id: 'type-other',      value: 'other',      label: 'Other' },
    ],
    paxOptions: [
      { id: 'pax-30',   value: '30-50',   label: '30–50' },
      { id: 'pax-50',   value: '50-100',  label: '50–100' },
      { id: 'pax-100',  value: '100-200', label: '100–200' },
      { id: 'pax-200',  value: '200-500', label: '200–500' },
      { id: 'pax-500',  value: '500+',    label: '500+' },
    ],
    budgetOptions: [
      { id: 'bud-1',  value: '800-1200',  label: '₹800–1,200 /head' },
      { id: 'bud-2',  value: '1200-1800', label: '₹1,200–1,800 /head' },
      { id: 'bud-3',  value: '1800+',     label: '₹1,800+ /head' },
      { id: 'bud-4',  value: 'discuss',   label: 'Let\'s discuss' },
    ],
    submitNote:    'Your enquiry is free.\nNo payment required to receive a proposal.',
    submitLabel:   'Send Proposal Request',
    confirmTitle:  ["We've received", 'your enquiry'],
    confirmBody:   'Our catering team will reach out within 2 hours on business days to discuss your event.',
    confirmSteps:  [
      'Team reviews your event brief',
      'We call to confirm details & venue',
      'Full proposal sent within 48 hours',
    ],
    redirectTitle: 'Back to the menu',
    redirectBody:  '',
    redirectLabel: 'View restaurant menu',
  },

  faq: {
    label:    'FAQ',
    title:    ['Common', 'questions'],
    ledeBody: 'Everything you need to know before making an enquiry.',
    items: [
      {
        q: 'What is the minimum order size?',
        a: 'We cater for a minimum of 30 guests. For very intimate events under 30, please contact us directly and we will see what we can arrange.',
      },
      {
        q: 'Do you provide service staff, tables, and equipment?',
        a: 'Yes. All packages include service staff, chafing dishes, serving equipment, table setup, and complete post-event cleanup. You do not need to arrange anything separately.',
      },
      {
        q: 'Can we customise the menu for dietary requirements?',
        a: 'Absolutely. We offer full menu customisation including Jain, Halal, vegan, and gluten-free options. We are happy to design a bespoke menu around your guests\' requirements.',
      },
      {
        q: 'Do you provide a tasting before the event?',
        a: 'Yes. For bookings above 100 pax we arrange a complimentary tasting session at our Connaught Place kitchen, typically 2–3 weeks before the event.',
      },
      {
        q: 'How far in advance should we book?',
        a: 'For corporate events and private dinners, 2 weeks notice is ideal. For weddings and large banquets (200+ pax), we recommend booking 6–8 weeks in advance, especially during peak wedding season (October–February).',
      },
      {
        q: 'Do you cater outside Delhi NCR?',
        a: 'Yes. We have catered in Jaipur, Chandigarh, and Agra. Travel and logistics charges apply for venues beyond 50 km from Connaught Place — these are included in your proposal.',
      },
    ],
  },
};

async function seed() {
  // Find the tenant by slug
  const tenantRes = await query(
    `SELECT id FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
    [SLUG]
  );

  if (!tenantRes.rows.length) {
    throw new Error(`Tenant not found for slug: ${SLUG}. Run the main seed first.`);
  }

  const tenantId = tenantRes.rows[0].id;
  console.log(`[catering-seed] tenant_id: ${tenantId}`);

  // Merge catering content into settings JSONB
  await query(
    `UPDATE tenant.restaurants
     SET settings = settings || $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ catering: CATERING }), tenantId]
  );

  console.log('[catering-seed] Catering content merged into settings.catering');
  console.log('[catering-seed] Sections: credBar, trustedBy, position, packages(3 tiers),');
  console.log('                          process(4 steps), capacity(4 cells), menu(3 tabs),');
  console.log('                          testimonials(3), form, faq(6 items)');
}

seed()
  .then(() => { console.log('[catering-seed] Done.'); process.exit(0); })
  .catch(e  => { console.error('[catering-seed] Failed:', e.message); process.exit(1); });
