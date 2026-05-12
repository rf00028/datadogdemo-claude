// ─────────────────────────────────────────────────────────────────────────────
// customer.config.js — single source of truth for all customer-specific data
//
// To create a new customer demo:
//   1. Copy this file and update every field below
//   2. Set DD_SERVICE in .env to match `platform`
//   3. Run setup-datadog.js, setup-rum.js, setup-private-location.js
//   4. Rebuild the Docker image: docker compose up --build -d
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Company identity ─────────────────────────────────────────────────────────
  company:          'Inspire Brands',
  platform:         'inspire-brands-platform',   // Datadog service name (DD_SERVICE)
  servicePrefix:    'inspire',                   // prefix for brand APM services (inspire-arbys-pos)
  metricPrefix:     'inspire',                   // DogStatsD metric namespace (inspire.orders.created)
  mlApp:            'inspire-brands-assistant',  // LLM Observability ml_app name
  platformTeam:     'inspire-platform',          // Datadog team handle for cross-brand resources
  platformTeamName: 'Inspire Platform Engineering',
  hostname:         'inspire-demo-host',         // hostname tag on shipped logs

  // ── Dashboard display ─────────────────────────────────────────────────────────
  dashboardTitle:       '🍔 Inspire Brands — Digital Platform Overview',
  dashboardDescription: 'Cross-brand observability: orders, POS health, loyalty, delivery, and alerts',

  // ── Brand logo URLs (used by the brand web apps) ─────────────────────────────
  // Optional — omit or set to null for any brand without a logo
  brandLogoUrls: {
    'arbys':           'https://inspirebrands.com/wp-content/uploads/2017/10/Arbys.jpg',
    'bww':             'https://inspirebrands.com/wp-content/uploads/2018/08/Buffalo-Wild-Wings-Logo-Horizontal.jpg',
    'sonic':           'https://inspirebrands.com/wp-content/uploads/2020/02/Sonic_Logo-1-scaled.jpg',
    'dunkin':          'https://inspirebrands.com/wp-content/uploads/2023/10/Dunkin_Icon_2color_RGB-2.png',
    'baskin-robbins':  'https://inspirebrands.com/wp-content/uploads/2022/04/IB_BROnlineStamp-01.png',
    'jimmy-johns':     'https://inspirebrands.com/wp-content/uploads/2023/10/JJ-Red-2.png',
  },

  // ── Brand / division definitions ─────────────────────────────────────────────
  // Each brand needs: key, name, color, team, tagline, channels[], menu[]
  // key   — URL-safe identifier used in API routes (/api/:brand/orders)
  // team  — Datadog team handle (must be unique within this config)
  // color — hex color used in the UI
  brands: [
    {
      key:      'arbys',
      name:     "Arby's",
      color:    '#E31837',
      team:     'arbys-ops',
      tagline:  'We Have The Meats',
      channels: ['drive-thru', 'in-store', 'delivery'],
      menu: [
        { id: 1, name: 'Roast Beef Classic',  price: 5.99,  category: 'sandwiches', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Arbysbeefandfries.JPG/400px-Arbysbeefandfries.JPG' },
        { id: 2, name: 'Beef & Cheddar',      price: 6.99,  category: 'sandwiches', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Cheeseburger.jpg/400px-Cheeseburger.jpg' },
        { id: 3, name: 'Curly Fries Large',   price: 2.99,  category: 'sides',      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/French_Fries.JPG/400px-French_Fries.JPG' },
        { id: 4, name: 'Mozzarella Sticks',   price: 4.99,  category: 'sides',      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Fried_Mozzarella_Sticks_at_Millers_Pub_%28301456962%29.jpg/400px-Fried_Mozzarella_Sticks_at_Millers_Pub_%28301456962%29.jpg' },
        { id: 5, name: 'Jamocha Shake',       price: 3.99,  category: 'drinks',     image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Strawberry_milk_shake_%28cropped%29.jpg/400px-Strawberry_milk_shake_%28cropped%29.jpg' },
      ],
    },
    {
      key:      'bww',
      name:     'Buffalo Wild Wings',
      color:    '#F5A800',
      team:     'bww-ops',
      tagline:  'Wings. Beer. Sports.',
      channels: ['dine-in', 'takeout', 'delivery'],
      menu: [
        { id: 1, name: 'Traditional Wings 6pc', price: 9.99,  category: 'wings',      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Buffalo_wings-01.jpg/400px-Buffalo_wings-01.jpg' },
        { id: 2, name: 'Boneless Wings 6pc',    price: 8.99,  category: 'wings',      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Buffalo_wings-01.jpg/400px-Buffalo_wings-01.jpg' },
        { id: 3, name: 'Street Tacos',           price: 11.99, category: 'entrees',    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/001_Tacos_de_carnitas%2C_carne_asada_y_al_pastor.jpg/400px-001_Tacos_de_carnitas%2C_carne_asada_y_al_pastor.jpg' },
        { id: 4, name: 'Loaded Nachos',          price: 10.99, category: 'shareables', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Nachos-cheese.jpg/400px-Nachos-cheese.jpg' },
        { id: 5, name: 'Draft Beer',             price: 6.99,  category: 'drinks',     image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Keg_Fonts.jpg/400px-Keg_Fonts.jpg' },
      ],
    },
    {
      key:      'sonic',
      name:     'Sonic Drive-In',
      color:    '#005FA3',
      team:     'sonic-ops',
      tagline:  "America's Drive-In",
      channels: ['drive-in', 'drive-thru', 'delivery'],
      menu: [
        { id: 1, name: 'Footlong Coney',     price: 4.99, category: 'hot-dogs', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Hot_dog_with_mustard.png/400px-Hot_dog_with_mustard.png' },
        { id: 2, name: 'SONIC Blast',         price: 4.49, category: 'desserts', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Ice_cream_with_whipped_cream%2C_chocolate_syrup%2C_and_a_wafer_%28cropped%29.jpg/400px-Ice_cream_with_whipped_cream%2C_chocolate_syrup%2C_and_a_wafer_%28cropped%29.jpg' },
        { id: 3, name: 'Tots Large',          price: 2.99, category: 'sides',    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Tater_Tots_Close_Up_%2824782852665%29.jpg/400px-Tater_Tots_Close_Up_%2824782852665%29.jpg' },
        { id: 4, name: 'Route 44 Drink',      price: 2.49, category: 'drinks',   image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Tumbler_of_cola_with_ice.jpg/400px-Tumbler_of_cola_with_ice.jpg' },
        { id: 5, name: 'Double Cheeseburger', price: 5.99, category: 'burgers',  image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/Cheeseburger.jpg/400px-Cheeseburger.jpg' },
      ],
    },
    {
      key:      'dunkin',
      name:     "Dunkin'",
      color:    '#FF671F',
      team:     'dunkin-ops',
      tagline:  "America Runs on Dunkin'",
      channels: ['in-store', 'drive-thru', 'mobile-order'],
      menu: [
        { id: 1, name: 'Medium Hot Coffee',  price: 2.49, category: 'coffee',     image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Latte_and_dark_coffee.jpg/400px-Latte_and_dark_coffee.jpg' },
        { id: 2, name: 'Cold Brew',           price: 3.99, category: 'coffee',     image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/ColdBrewCoffeein_Cans.png/400px-ColdBrewCoffeein_Cans.png' },
        { id: 3, name: 'Glazed Donut',        price: 1.29, category: 'donuts',     image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Glazed-Donut.jpg/400px-Glazed-Donut.jpg' },
        { id: 4, name: 'Bacon Egg & Cheese',  price: 4.99, category: 'sandwiches', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Breakfast_sandwich.jpg/400px-Breakfast_sandwich.jpg' },
        { id: 5, name: 'Munchkins 10pk',      price: 3.99, category: 'donuts',     image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Glazed-Donut.jpg/400px-Glazed-Donut.jpg' },
      ],
    },
    {
      key:      'baskin-robbins',
      name:     'Baskin-Robbins',
      color:    '#E8256A',
      team:     'br-ops',
      tagline:  '31 Flavors of Fun',
      channels: ['in-store', 'online', 'catering'],
      menu: [
        { id: 1, name: 'Single Scoop',        price: 3.49,  category: 'scoops',  image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Vanilla_Ice_Cream_Cone_at_Camp_Manitoulin.jpg/400px-Vanilla_Ice_Cream_Cone_at_Camp_Manitoulin.jpg' },
        { id: 2, name: 'Double Scoop',         price: 4.99,  category: 'scoops',  image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Ice_cream_with_whipped_cream%2C_chocolate_syrup%2C_and_a_wafer_%28cropped%29.jpg/400px-Ice_cream_with_whipped_cream%2C_chocolate_syrup%2C_and_a_wafer_%28cropped%29.jpg' },
        { id: 3, name: 'Sundae',               price: 5.99,  category: 'sundaes', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/StrawberrySundae.jpg/400px-StrawberrySundae.jpg' },
        { id: 4, name: 'Milkshake',            price: 6.49,  category: 'drinks',  image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Strawberry_milk_shake_%28cropped%29.jpg/400px-Strawberry_milk_shake_%28cropped%29.jpg' },
        { id: 5, name: 'Ice Cream Cake (8")',  price: 24.99, category: 'cakes',   image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Ice_Cream_swiss_roll.jpg/400px-Ice_Cream_swiss_roll.jpg' },
      ],
    },
    {
      key:      'jimmy-johns',
      name:     "Jimmy John's",
      color:    '#C8102E',
      team:     'jj-ops',
      tagline:  'Freaky Fast Delivery',
      channels: ['in-store', 'delivery', 'catering'],
      menu: [
        { id: 1, name: '#1 Pepe',              price: 8.99, category: 'sandwiches',      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Submarine_sandwich_with_toppings_and_dijon_mustard.jpg/400px-Submarine_sandwich_with_toppings_and_dijon_mustard.jpg' },
        { id: 2, name: '#6 The Veggie',         price: 8.49, category: 'sandwiches',      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Submarine_sandwich_with_toppings_and_dijon_mustard.jpg/400px-Submarine_sandwich_with_toppings_and_dijon_mustard.jpg' },
        { id: 3, name: '#9 Italian Night Club', price: 9.99, category: 'sandwiches',      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Submarine_sandwich_with_toppings_and_dijon_mustard.jpg/400px-Submarine_sandwich_with_toppings_and_dijon_mustard.jpg' },
        { id: 4, name: 'Slim 1 Ham & Cheese',   price: 7.49, category: 'slim-sandwiches', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Breakfast_sandwich.jpg/400px-Breakfast_sandwich.jpg' },
        { id: 5, name: 'Chocolate Chip Cookie', price: 1.29, category: 'sides',           image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Choco_chip_cookie.png/400px-Choco_chip_cookie.png' },
      ],
    },
  ],
};
