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
        { id: 1, name: 'Roast Beef Classic',  price: 5.99,  category: 'sandwiches', image: 'https://images.unsplash.com/photo-1568901346375-f1949a3ceee6?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 2, name: 'Beef & Cheddar',      price: 6.99,  category: 'sandwiches', image: 'https://images.unsplash.com/photo-1553979459-d1b2a2b4e82c?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 3, name: 'Curly Fries Large',   price: 2.99,  category: 'sides',      image: 'https://images.unsplash.com/photo-1573080496032-b43d7d92d55e?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 4, name: 'Mozzarella Sticks',   price: 4.99,  category: 'sides',      image: 'https://images.unsplash.com/photo-1541014609847-e0f2a5f7b84e?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 5, name: 'Jamocha Shake',       price: 3.99,  category: 'drinks',     image: 'https://images.unsplash.com/photo-1568901839119-631418a3910d?w=400&h=300&fit=crop&auto=format&q=80' },
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
        { id: 1, name: 'Traditional Wings 6pc', price: 9.99,  category: 'wings',      image: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 2, name: 'Boneless Wings 6pc',    price: 8.99,  category: 'wings',      image: 'https://images.unsplash.com/photo-1609167830220-7164aa360951?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 3, name: 'Street Tacos',           price: 11.99, category: 'entrees',    image: 'https://images.unsplash.com/photo-1565299624596-3b61b3f44a3b?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 4, name: 'Loaded Nachos',          price: 10.99, category: 'shareables', image: 'https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 5, name: 'Draft Beer',             price: 6.99,  category: 'drinks',     image: 'https://images.unsplash.com/photo-1563227812-0ea4c22e6cc8?w=400&h=300&fit=crop&auto=format&q=80' },
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
        { id: 1, name: 'Footlong Coney',     price: 4.99, category: 'hot-dogs', image: 'https://images.unsplash.com/photo-1612392062631-94b819f6e5e2?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 2, name: 'SONIC Blast',         price: 4.49, category: 'desserts', image: 'https://images.unsplash.com/photo-1563805042-7684c019e293?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 3, name: 'Tots Large',          price: 2.99, category: 'sides',    image: 'https://images.unsplash.com/photo-1619546813926-a78fa6372cd2?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 4, name: 'Route 44 Drink',      price: 2.49, category: 'drinks',   image: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 5, name: 'Double Cheeseburger', price: 5.99, category: 'burgers',  image: 'https://images.unsplash.com/photo-1572802419224-296b0aeee0d9?w=400&h=300&fit=crop&auto=format&q=80' },
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
        { id: 1, name: 'Medium Hot Coffee',  price: 2.49, category: 'coffee',     image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 2, name: 'Cold Brew',           price: 3.99, category: 'coffee',     image: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 3, name: 'Glazed Donut',        price: 1.29, category: 'donuts',     image: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 4, name: 'Bacon Egg & Cheese',  price: 4.99, category: 'sandwiches', image: 'https://images.unsplash.com/photo-1509722747041-616f39b57ef3?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 5, name: 'Munchkins 10pk',      price: 3.99, category: 'donuts',     image: 'https://images.unsplash.com/photo-1596363505729-4190a9506133?w=400&h=300&fit=crop&auto=format&q=80' },
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
        { id: 1, name: 'Single Scoop',        price: 3.49,  category: 'scoops',  image: 'https://images.unsplash.com/photo-1563805042-7684c019e293?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 2, name: 'Double Scoop',         price: 4.99,  category: 'scoops',  image: 'https://images.unsplash.com/photo-1557142635-55a135e4a7a0?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 3, name: 'Sundae',               price: 5.99,  category: 'sundaes', image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 4, name: 'Milkshake',            price: 6.49,  category: 'drinks',  image: 'https://images.unsplash.com/photo-1568901839119-631418a3910d?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 5, name: 'Ice Cream Cake (8")',  price: 24.99, category: 'cakes',   image: 'https://images.unsplash.com/photo-1464349095431-e9a21285b19a?w=400&h=300&fit=crop&auto=format&q=80' },
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
        { id: 1, name: '#1 Pepe',              price: 8.99, category: 'sandwiches',      image: 'https://images.unsplash.com/photo-1481070414801-51fd0d8a2a44?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 2, name: '#6 The Veggie',         price: 8.49, category: 'sandwiches',      image: 'https://images.unsplash.com/photo-1512621776951-a57ef3338a05?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 3, name: '#9 Italian Night Club', price: 9.99, category: 'sandwiches',      image: 'https://images.unsplash.com/photo-1567234669003-dce7a7a88821?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 4, name: 'Slim 1 Ham & Cheese',   price: 7.49, category: 'slim-sandwiches', image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400&h=300&fit=crop&auto=format&q=80' },
        { id: 5, name: 'Chocolate Chip Cookie', price: 1.29, category: 'sides',           image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&h=300&fit=crop&auto=format&q=80' },
      ],
    },
  ],
};
