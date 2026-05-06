// Store location footprint for all Inspire Brands.
// Each entry maps to a real metro where the brand has significant presence.
// Tags emitted: region, state, city, store_id

module.exports = {
  arbys: [
    // Southeast
    { store_id: 'arb-atl-001', city: 'Atlanta',     state: 'GA', region: 'southeast' },
    { store_id: 'arb-atl-002', city: 'Atlanta',     state: 'GA', region: 'southeast' },
    { store_id: 'arb-clt-001', city: 'Charlotte',   state: 'NC', region: 'southeast' },
    { store_id: 'arb-nas-001', city: 'Nashville',   state: 'TN', region: 'southeast' },
    // Midwest
    { store_id: 'arb-col-001', city: 'Columbus',    state: 'OH', region: 'midwest'   },
    { store_id: 'arb-col-002', city: 'Columbus',    state: 'OH', region: 'midwest'   },
    { store_id: 'arb-ind-001', city: 'Indianapolis',state: 'IN', region: 'midwest'   },
    { store_id: 'arb-det-001', city: 'Detroit',     state: 'MI', region: 'midwest'   },
    // South
    { store_id: 'arb-hou-001', city: 'Houston',     state: 'TX', region: 'south'     },
    { store_id: 'arb-dal-001', city: 'Dallas',      state: 'TX', region: 'south'     },
    { store_id: 'arb-dal-002', city: 'Dallas',      state: 'TX', region: 'south'     },
    { store_id: 'arb-mem-001', city: 'Memphis',     state: 'TN', region: 'south'     },
    // Northeast
    { store_id: 'arb-phi-001', city: 'Philadelphia',state: 'PA', region: 'northeast' },
    { store_id: 'arb-pit-001', city: 'Pittsburgh',  state: 'PA', region: 'northeast' },
    { store_id: 'arb-bal-001', city: 'Baltimore',   state: 'MD', region: 'northeast' },
  ],

  bww: [
    // Midwest
    { store_id: 'bww-chi-001', city: 'Chicago',     state: 'IL', region: 'midwest'   },
    { store_id: 'bww-chi-002', city: 'Chicago',     state: 'IL', region: 'midwest'   },
    { store_id: 'bww-col-001', city: 'Columbus',    state: 'OH', region: 'midwest'   },
    { store_id: 'bww-min-001', city: 'Minneapolis', state: 'MN', region: 'midwest'   },
    // Southeast
    { store_id: 'bww-atl-001', city: 'Atlanta',     state: 'GA', region: 'southeast' },
    { store_id: 'bww-clt-001', city: 'Charlotte',   state: 'NC', region: 'southeast' },
    { store_id: 'bww-orl-001', city: 'Orlando',     state: 'FL', region: 'southeast' },
    // South
    { store_id: 'bww-dal-001', city: 'Dallas',      state: 'TX', region: 'south'     },
    { store_id: 'bww-hou-001', city: 'Houston',     state: 'TX', region: 'south'     },
    { store_id: 'bww-nas-001', city: 'Nashville',   state: 'TN', region: 'south'     },
    // Northeast
    { store_id: 'bww-bos-001', city: 'Boston',      state: 'MA', region: 'northeast' },
    { store_id: 'bww-nyc-001', city: 'New York',    state: 'NY', region: 'northeast' },
    { store_id: 'bww-phi-001', city: 'Philadelphia',state: 'PA', region: 'northeast' },
  ],

  sonic: [
    // South (core market)
    { store_id: 'son-hou-001', city: 'Houston',     state: 'TX', region: 'south'     },
    { store_id: 'son-hou-002', city: 'Houston',     state: 'TX', region: 'south'     },
    { store_id: 'son-dal-001', city: 'Dallas',      state: 'TX', region: 'south'     },
    { store_id: 'son-sat-001', city: 'San Antonio', state: 'TX', region: 'south'     },
    // Southeast
    { store_id: 'son-atl-001', city: 'Atlanta',     state: 'GA', region: 'southeast' },
    { store_id: 'son-nas-001', city: 'Nashville',   state: 'TN', region: 'southeast' },
    { store_id: 'son-bir-001', city: 'Birmingham',  state: 'AL', region: 'southeast' },
    // Midwest
    { store_id: 'son-okc-001', city: 'Oklahoma City',state:'OK', region: 'midwest'   },
    { store_id: 'son-tul-001', city: 'Tulsa',       state: 'OK', region: 'midwest'   },
    { store_id: 'son-kcy-001', city: 'Kansas City', state: 'MO', region: 'midwest'   },
    // Southwest
    { store_id: 'son-phx-001', city: 'Phoenix',     state: 'AZ', region: 'southwest' },
    { store_id: 'son-abq-001', city: 'Albuquerque', state: 'NM', region: 'southwest' },
    { store_id: 'son-lvs-001', city: 'Las Vegas',   state: 'NV', region: 'southwest' },
  ],

  dunkin: [
    // Northeast (core market)
    { store_id: 'dun-bos-001', city: 'Boston',      state: 'MA', region: 'northeast' },
    { store_id: 'dun-bos-002', city: 'Boston',      state: 'MA', region: 'northeast' },
    { store_id: 'dun-nyc-001', city: 'New York',    state: 'NY', region: 'northeast' },
    { store_id: 'dun-nyc-002', city: 'New York',    state: 'NY', region: 'northeast' },
    { store_id: 'dun-prv-001', city: 'Providence',  state: 'RI', region: 'northeast' },
    // Mid-Atlantic
    { store_id: 'dun-phi-001', city: 'Philadelphia',state: 'PA', region: 'mid-atlantic' },
    { store_id: 'dun-bal-001', city: 'Baltimore',   state: 'MD', region: 'mid-atlantic' },
    { store_id: 'dun-dca-001', city: 'Washington',  state: 'DC', region: 'mid-atlantic' },
    // Southeast
    { store_id: 'dun-mia-001', city: 'Miami',       state: 'FL', region: 'southeast' },
    { store_id: 'dun-clt-001', city: 'Charlotte',   state: 'NC', region: 'southeast' },
    { store_id: 'dun-atl-001', city: 'Atlanta',     state: 'GA', region: 'southeast' },
    // Midwest
    { store_id: 'dun-chi-001', city: 'Chicago',     state: 'IL', region: 'midwest'   },
    { store_id: 'dun-det-001', city: 'Detroit',     state: 'MI', region: 'midwest'   },
    { store_id: 'dun-cle-001', city: 'Cleveland',   state: 'OH', region: 'midwest'   },
  ],

  'baskin-robbins': [
    // Northeast
    { store_id: 'br-nyc-001', city: 'New York',     state: 'NY', region: 'northeast' },
    { store_id: 'br-bos-001', city: 'Boston',       state: 'MA', region: 'northeast' },
    { store_id: 'br-hfd-001', city: 'Hartford',     state: 'CT', region: 'northeast' },
    // Southeast
    { store_id: 'br-mia-001', city: 'Miami',        state: 'FL', region: 'southeast' },
    { store_id: 'br-tam-001', city: 'Tampa',        state: 'FL', region: 'southeast' },
    { store_id: 'br-atl-001', city: 'Atlanta',      state: 'GA', region: 'southeast' },
    // Midwest
    { store_id: 'br-chi-001', city: 'Chicago',      state: 'IL', region: 'midwest'   },
    { store_id: 'br-det-001', city: 'Detroit',      state: 'MI', region: 'midwest'   },
    { store_id: 'br-ind-001', city: 'Indianapolis', state: 'IN', region: 'midwest'   },
    // West
    { store_id: 'br-lax-001', city: 'Los Angeles',  state: 'CA', region: 'west'      },
    { store_id: 'br-lax-002', city: 'Los Angeles',  state: 'CA', region: 'west'      },
    { store_id: 'br-sdg-001', city: 'San Diego',    state: 'CA', region: 'west'      },
    { store_id: 'br-sea-001', city: 'Seattle',      state: 'WA', region: 'west'      },
  ],

  'jimmy-johns': [
    // Midwest (core market)
    { store_id: 'jj-chi-001', city: 'Chicago',      state: 'IL', region: 'midwest'   },
    { store_id: 'jj-chi-002', city: 'Chicago',      state: 'IL', region: 'midwest'   },
    { store_id: 'jj-ind-001', city: 'Indianapolis', state: 'IN', region: 'midwest'   },
    { store_id: 'jj-col-001', city: 'Columbus',     state: 'OH', region: 'midwest'   },
    // South
    { store_id: 'jj-aus-001', city: 'Austin',       state: 'TX', region: 'south'     },
    { store_id: 'jj-nas-001', city: 'Nashville',    state: 'TN', region: 'south'     },
    { store_id: 'jj-kcy-001', city: 'Kansas City',  state: 'MO', region: 'south'     },
    // Southeast
    { store_id: 'jj-atl-001', city: 'Atlanta',      state: 'GA', region: 'southeast' },
    { store_id: 'jj-clt-001', city: 'Charlotte',    state: 'NC', region: 'southeast' },
    { store_id: 'jj-tam-001', city: 'Tampa',        state: 'FL', region: 'southeast' },
    // Northeast
    { store_id: 'jj-phi-001', city: 'Philadelphia', state: 'PA', region: 'northeast' },
    { store_id: 'jj-dca-001', city: 'Washington',   state: 'DC', region: 'northeast' },
    { store_id: 'jj-pit-001', city: 'Pittsburgh',   state: 'PA', region: 'northeast' },
  ],
};
