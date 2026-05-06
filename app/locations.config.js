// Store location footprint for all Inspire Brands.
// Store counts and geographic spread modeled after each brand's real US footprint.
// Tags emitted: region, state, city, store_id
//
// Arby's        ~3,300 US: Southeast, Midwest, South, Mid-Atlantic, Northeast
// BWW           ~1,700 US: Midwest-heavy, nationally present
// Sonic         ~3,500 US: Texas-dominant, Deep South, Southeast, Plains
// Dunkin'       ~9,500 US: Northeast-dominant, Mid-Atlantic, expanding Southeast/Midwest
// Baskin-Robbins~2,500 US: Truly national, strong West Coast
// Jimmy John's  ~2,700 US: Midwest-core, strong South/Southeast, present everywhere

module.exports = {

  // ── Arby's ──────────────────────────────────────────────────────────────────
  // Heavy Southeast, Midwest, South; solid Mid-Atlantic & Northeast; growing West
  arbys: [
    // Southeast
    { store_id: 'arb-atl-001', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'arb-atl-002', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'arb-atl-003', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'arb-clt-001', city: 'Charlotte',     state: 'NC', region: 'southeast'   },
    { store_id: 'arb-clt-002', city: 'Charlotte',     state: 'NC', region: 'southeast'   },
    { store_id: 'arb-ral-001', city: 'Raleigh',       state: 'NC', region: 'southeast'   },
    { store_id: 'arb-nas-001', city: 'Nashville',     state: 'TN', region: 'southeast'   },
    { store_id: 'arb-nas-002', city: 'Nashville',     state: 'TN', region: 'southeast'   },
    { store_id: 'arb-knx-001', city: 'Knoxville',     state: 'TN', region: 'southeast'   },
    { store_id: 'arb-orl-001', city: 'Orlando',       state: 'FL', region: 'southeast'   },
    { store_id: 'arb-tam-001', city: 'Tampa',         state: 'FL', region: 'southeast'   },
    { store_id: 'arb-jax-001', city: 'Jacksonville',  state: 'FL', region: 'southeast'   },
    { store_id: 'arb-bir-001', city: 'Birmingham',    state: 'AL', region: 'southeast'   },
    { store_id: 'arb-lou-001', city: 'Louisville',    state: 'KY', region: 'southeast'   },
    { store_id: 'arb-csc-001', city: 'Columbia',      state: 'SC', region: 'southeast'   },
    // Midwest
    { store_id: 'arb-col-001', city: 'Columbus',      state: 'OH', region: 'midwest'     },
    { store_id: 'arb-col-002', city: 'Columbus',      state: 'OH', region: 'midwest'     },
    { store_id: 'arb-cin-001', city: 'Cincinnati',    state: 'OH', region: 'midwest'     },
    { store_id: 'arb-cle-001', city: 'Cleveland',     state: 'OH', region: 'midwest'     },
    { store_id: 'arb-ind-001', city: 'Indianapolis',  state: 'IN', region: 'midwest'     },
    { store_id: 'arb-ind-002', city: 'Indianapolis',  state: 'IN', region: 'midwest'     },
    { store_id: 'arb-det-001', city: 'Detroit',       state: 'MI', region: 'midwest'     },
    { store_id: 'arb-chi-001', city: 'Chicago',       state: 'IL', region: 'midwest'     },
    { store_id: 'arb-mil-001', city: 'Milwaukee',     state: 'WI', region: 'midwest'     },
    { store_id: 'arb-min-001', city: 'Minneapolis',   state: 'MN', region: 'midwest'     },
    { store_id: 'arb-stl-001', city: 'St. Louis',     state: 'MO', region: 'midwest'     },
    // South
    { store_id: 'arb-hou-001', city: 'Houston',       state: 'TX', region: 'south'       },
    { store_id: 'arb-hou-002', city: 'Houston',       state: 'TX', region: 'south'       },
    { store_id: 'arb-dal-001', city: 'Dallas',        state: 'TX', region: 'south'       },
    { store_id: 'arb-dal-002', city: 'Dallas',        state: 'TX', region: 'south'       },
    { store_id: 'arb-sat-001', city: 'San Antonio',   state: 'TX', region: 'south'       },
    { store_id: 'arb-mem-001', city: 'Memphis',       state: 'TN', region: 'south'       },
    { store_id: 'arb-okc-001', city: 'Oklahoma City', state: 'OK', region: 'south'       },
    // Mid-Atlantic
    { store_id: 'arb-phi-001', city: 'Philadelphia',  state: 'PA', region: 'mid-atlantic'},
    { store_id: 'arb-pit-001', city: 'Pittsburgh',    state: 'PA', region: 'mid-atlantic'},
    { store_id: 'arb-pit-002', city: 'Pittsburgh',    state: 'PA', region: 'mid-atlantic'},
    { store_id: 'arb-bal-001', city: 'Baltimore',     state: 'MD', region: 'mid-atlantic'},
    { store_id: 'arb-dca-001', city: 'Washington',    state: 'DC', region: 'mid-atlantic'},
    { store_id: 'arb-ric-001', city: 'Richmond',      state: 'VA', region: 'mid-atlantic'},
    { store_id: 'arb-wvi-001', city: 'Charleston',    state: 'WV', region: 'mid-atlantic'},
    // Northeast
    { store_id: 'arb-nyc-001', city: 'New York',      state: 'NY', region: 'northeast'   },
    { store_id: 'arb-buf-001', city: 'Buffalo',       state: 'NY', region: 'northeast'   },
    // West
    { store_id: 'arb-den-001', city: 'Denver',        state: 'CO', region: 'west'        },
    { store_id: 'arb-phx-001', city: 'Phoenix',       state: 'AZ', region: 'west'        },
  ],

  // ── Buffalo Wild Wings ───────────────────────────────────────────────────────
  // National with Midwest core; strong in college towns; growing coasts
  bww: [
    // Midwest
    { store_id: 'bww-chi-001', city: 'Chicago',       state: 'IL', region: 'midwest'     },
    { store_id: 'bww-chi-002', city: 'Chicago',       state: 'IL', region: 'midwest'     },
    { store_id: 'bww-col-001', city: 'Columbus',      state: 'OH', region: 'midwest'     },
    { store_id: 'bww-col-002', city: 'Columbus',      state: 'OH', region: 'midwest'     },
    { store_id: 'bww-cin-001', city: 'Cincinnati',    state: 'OH', region: 'midwest'     },
    { store_id: 'bww-cle-001', city: 'Cleveland',     state: 'OH', region: 'midwest'     },
    { store_id: 'bww-min-001', city: 'Minneapolis',   state: 'MN', region: 'midwest'     },
    { store_id: 'bww-min-002', city: 'Minneapolis',   state: 'MN', region: 'midwest'     },
    { store_id: 'bww-ind-001', city: 'Indianapolis',  state: 'IN', region: 'midwest'     },
    { store_id: 'bww-det-001', city: 'Detroit',       state: 'MI', region: 'midwest'     },
    { store_id: 'bww-grr-001', city: 'Grand Rapids',  state: 'MI', region: 'midwest'     },
    { store_id: 'bww-mil-001', city: 'Milwaukee',     state: 'WI', region: 'midwest'     },
    { store_id: 'bww-mad-001', city: 'Madison',       state: 'WI', region: 'midwest'     },
    { store_id: 'bww-stl-001', city: 'St. Louis',     state: 'MO', region: 'midwest'     },
    { store_id: 'bww-kcy-001', city: 'Kansas City',   state: 'MO', region: 'midwest'     },
    { store_id: 'bww-oma-001', city: 'Omaha',         state: 'NE', region: 'midwest'     },
    // Southeast
    { store_id: 'bww-atl-001', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'bww-atl-002', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'bww-clt-001', city: 'Charlotte',     state: 'NC', region: 'southeast'   },
    { store_id: 'bww-ral-001', city: 'Raleigh',       state: 'NC', region: 'southeast'   },
    { store_id: 'bww-orl-001', city: 'Orlando',       state: 'FL', region: 'southeast'   },
    { store_id: 'bww-tam-001', city: 'Tampa',         state: 'FL', region: 'southeast'   },
    { store_id: 'bww-jax-001', city: 'Jacksonville',  state: 'FL', region: 'southeast'   },
    { store_id: 'bww-nas-001', city: 'Nashville',     state: 'TN', region: 'southeast'   },
    { store_id: 'bww-lou-001', city: 'Louisville',    state: 'KY', region: 'southeast'   },
    // South
    { store_id: 'bww-dal-001', city: 'Dallas',        state: 'TX', region: 'south'       },
    { store_id: 'bww-dal-002', city: 'Dallas',        state: 'TX', region: 'south'       },
    { store_id: 'bww-hou-001', city: 'Houston',       state: 'TX', region: 'south'       },
    { store_id: 'bww-aus-001', city: 'Austin',        state: 'TX', region: 'south'       },
    { store_id: 'bww-sat-001', city: 'San Antonio',   state: 'TX', region: 'south'       },
    { store_id: 'bww-okc-001', city: 'Oklahoma City', state: 'OK', region: 'south'       },
    // Mid-Atlantic / Northeast
    { store_id: 'bww-phi-001', city: 'Philadelphia',  state: 'PA', region: 'mid-atlantic'},
    { store_id: 'bww-pit-001', city: 'Pittsburgh',    state: 'PA', region: 'mid-atlantic'},
    { store_id: 'bww-bal-001', city: 'Baltimore',     state: 'MD', region: 'mid-atlantic'},
    { store_id: 'bww-bos-001', city: 'Boston',        state: 'MA', region: 'northeast'   },
    { store_id: 'bww-nyc-001', city: 'New York',      state: 'NY', region: 'northeast'   },
    // West
    { store_id: 'bww-den-001', city: 'Denver',        state: 'CO', region: 'west'        },
    { store_id: 'bww-phx-001', city: 'Phoenix',       state: 'AZ', region: 'west'        },
    { store_id: 'bww-lvs-001', city: 'Las Vegas',     state: 'NV', region: 'west'        },
    { store_id: 'bww-sea-001', city: 'Seattle',       state: 'WA', region: 'west'        },
    { store_id: 'bww-lax-001', city: 'Los Angeles',   state: 'CA', region: 'west'        },
  ],

  // ── Sonic ────────────────────────────────────────────────────────────────────
  // Texas is the core — more Sonic stores in TX than any other state by far.
  // Deep South, Oklahoma, Southeast, Plains states. Very limited NE/West Coast.
  sonic: [
    // Texas (core — largest single-state market)
    { store_id: 'son-hou-001', city: 'Houston',       state: 'TX', region: 'south'       },
    { store_id: 'son-hou-002', city: 'Houston',       state: 'TX', region: 'south'       },
    { store_id: 'son-hou-003', city: 'Houston',       state: 'TX', region: 'south'       },
    { store_id: 'son-dal-001', city: 'Dallas',        state: 'TX', region: 'south'       },
    { store_id: 'son-dal-002', city: 'Dallas',        state: 'TX', region: 'south'       },
    { store_id: 'son-dal-003', city: 'Dallas',        state: 'TX', region: 'south'       },
    { store_id: 'son-sat-001', city: 'San Antonio',   state: 'TX', region: 'south'       },
    { store_id: 'son-sat-002', city: 'San Antonio',   state: 'TX', region: 'south'       },
    { store_id: 'son-aus-001', city: 'Austin',        state: 'TX', region: 'south'       },
    { store_id: 'son-aus-002', city: 'Austin',        state: 'TX', region: 'south'       },
    { store_id: 'son-ftw-001', city: 'Fort Worth',    state: 'TX', region: 'south'       },
    { store_id: 'son-lbb-001', city: 'Lubbock',       state: 'TX', region: 'south'       },
    { store_id: 'son-ama-001', city: 'Amarillo',      state: 'TX', region: 'south'       },
    { store_id: 'son-elp-001', city: 'El Paso',       state: 'TX', region: 'south'       },
    { store_id: 'son-corp-001',city: 'Corpus Christi',state: 'TX', region: 'south'       },
    { store_id: 'son-wac-001', city: 'Waco',          state: 'TX', region: 'south'       },
    // Oklahoma (2nd-largest market)
    { store_id: 'son-okc-001', city: 'Oklahoma City', state: 'OK', region: 'south'       },
    { store_id: 'son-okc-002', city: 'Oklahoma City', state: 'OK', region: 'south'       },
    { store_id: 'son-tul-001', city: 'Tulsa',         state: 'OK', region: 'south'       },
    { store_id: 'son-tul-002', city: 'Tulsa',         state: 'OK', region: 'south'       },
    { store_id: 'son-law-001', city: 'Lawton',        state: 'OK', region: 'south'       },
    // Deep South
    { store_id: 'son-jxn-001', city: 'Jackson',       state: 'MS', region: 'south'       },
    { store_id: 'son-btr-001', city: 'Baton Rouge',   state: 'LA', region: 'south'       },
    { store_id: 'son-nor-001', city: 'New Orleans',   state: 'LA', region: 'south'       },
    { store_id: 'son-lir-001', city: 'Little Rock',   state: 'AR', region: 'south'       },
    { store_id: 'son-shr-001', city: 'Shreveport',    state: 'LA', region: 'south'       },
    // Southeast
    { store_id: 'son-atl-001', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'son-atl-002', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'son-nas-001', city: 'Nashville',     state: 'TN', region: 'southeast'   },
    { store_id: 'son-nas-002', city: 'Nashville',     state: 'TN', region: 'southeast'   },
    { store_id: 'son-mem-001', city: 'Memphis',       state: 'TN', region: 'southeast'   },
    { store_id: 'son-bir-001', city: 'Birmingham',    state: 'AL', region: 'southeast'   },
    { store_id: 'son-hsv-001', city: 'Huntsville',    state: 'AL', region: 'southeast'   },
    { store_id: 'son-knx-001', city: 'Knoxville',     state: 'TN', region: 'southeast'   },
    { store_id: 'son-lou-001', city: 'Louisville',    state: 'KY', region: 'southeast'   },
    { store_id: 'son-jax-001', city: 'Jacksonville',  state: 'FL', region: 'southeast'   },
    { store_id: 'son-orl-001', city: 'Orlando',       state: 'FL', region: 'southeast'   },
    { store_id: 'son-clt-001', city: 'Charlotte',     state: 'NC', region: 'southeast'   },
    // Midwest / Plains
    { store_id: 'son-kcy-001', city: 'Kansas City',   state: 'MO', region: 'midwest'     },
    { store_id: 'son-stl-001', city: 'St. Louis',     state: 'MO', region: 'midwest'     },
    { store_id: 'son-wic-001', city: 'Wichita',       state: 'KS', region: 'midwest'     },
    { store_id: 'son-oma-001', city: 'Omaha',         state: 'NE', region: 'midwest'     },
    { store_id: 'son-spr-001', city: 'Springfield',   state: 'MO', region: 'midwest'     },
    // Southwest
    { store_id: 'son-phx-001', city: 'Phoenix',       state: 'AZ', region: 'southwest'   },
    { store_id: 'son-phx-002', city: 'Phoenix',       state: 'AZ', region: 'southwest'   },
    { store_id: 'son-abq-001', city: 'Albuquerque',   state: 'NM', region: 'southwest'   },
    { store_id: 'son-lvs-001', city: 'Las Vegas',     state: 'NV', region: 'southwest'   },
    { store_id: 'son-den-001', city: 'Denver',        state: 'CO', region: 'southwest'   },
    { store_id: 'son-tus-001', city: 'Tucson',        state: 'AZ', region: 'southwest'   },
  ],

  // ── Dunkin' ──────────────────────────────────────────────────────────────────
  // Northeast is the heartland — more Dunkin' per square mile than anywhere else.
  // Dominant Mid-Atlantic; rapidly expanding Southeast, Midwest; growing West.
  dunkin: [
    // New England (ultra-dense)
    { store_id: 'dun-bos-001', city: 'Boston',        state: 'MA', region: 'northeast'   },
    { store_id: 'dun-bos-002', city: 'Boston',        state: 'MA', region: 'northeast'   },
    { store_id: 'dun-bos-003', city: 'Boston',        state: 'MA', region: 'northeast'   },
    { store_id: 'dun-wor-001', city: 'Worcester',     state: 'MA', region: 'northeast'   },
    { store_id: 'dun-spr-001', city: 'Springfield',   state: 'MA', region: 'northeast'   },
    { store_id: 'dun-prv-001', city: 'Providence',    state: 'RI', region: 'northeast'   },
    { store_id: 'dun-prv-002', city: 'Providence',    state: 'RI', region: 'northeast'   },
    { store_id: 'dun-hfd-001', city: 'Hartford',      state: 'CT', region: 'northeast'   },
    { store_id: 'dun-nhv-001', city: 'New Haven',     state: 'CT', region: 'northeast'   },
    { store_id: 'dun-bdg-001', city: 'Bridgeport',    state: 'CT', region: 'northeast'   },
    { store_id: 'dun-man-001', city: 'Manchester',    state: 'NH', region: 'northeast'   },
    { store_id: 'dun-pwd-001', city: 'Portland',      state: 'ME', region: 'northeast'   },
    { store_id: 'dun-bvt-001', city: 'Burlington',    state: 'VT', region: 'northeast'   },
    // New York metro (highest density outside Boston)
    { store_id: 'dun-nyc-001', city: 'New York',      state: 'NY', region: 'northeast'   },
    { store_id: 'dun-nyc-002', city: 'New York',      state: 'NY', region: 'northeast'   },
    { store_id: 'dun-nyc-003', city: 'New York',      state: 'NY', region: 'northeast'   },
    { store_id: 'dun-nyc-004', city: 'New York',      state: 'NY', region: 'northeast'   },
    { store_id: 'dun-buf-001', city: 'Buffalo',       state: 'NY', region: 'northeast'   },
    { store_id: 'dun-alb-001', city: 'Albany',        state: 'NY', region: 'northeast'   },
    // New Jersey
    { store_id: 'dun-nwk-001', city: 'Newark',        state: 'NJ', region: 'mid-atlantic'},
    { store_id: 'dun-trn-001', city: 'Trenton',       state: 'NJ', region: 'mid-atlantic'},
    { store_id: 'dun-acj-001', city: 'Atlantic City', state: 'NJ', region: 'mid-atlantic'},
    // Mid-Atlantic
    { store_id: 'dun-phi-001', city: 'Philadelphia',  state: 'PA', region: 'mid-atlantic'},
    { store_id: 'dun-phi-002', city: 'Philadelphia',  state: 'PA', region: 'mid-atlantic'},
    { store_id: 'dun-pit-001', city: 'Pittsburgh',    state: 'PA', region: 'mid-atlantic'},
    { store_id: 'dun-bal-001', city: 'Baltimore',     state: 'MD', region: 'mid-atlantic'},
    { store_id: 'dun-bal-002', city: 'Baltimore',     state: 'MD', region: 'mid-atlantic'},
    { store_id: 'dun-dca-001', city: 'Washington',    state: 'DC', region: 'mid-atlantic'},
    { store_id: 'dun-dca-002', city: 'Washington',    state: 'DC', region: 'mid-atlantic'},
    { store_id: 'dun-wil-001', city: 'Wilmington',    state: 'DE', region: 'mid-atlantic'},
    { store_id: 'dun-ric-001', city: 'Richmond',      state: 'VA', region: 'mid-atlantic'},
    { store_id: 'dun-vab-001', city: 'Virginia Beach',state: 'VA', region: 'mid-atlantic'},
    // Southeast (rapidly expanding)
    { store_id: 'dun-mia-001', city: 'Miami',         state: 'FL', region: 'southeast'   },
    { store_id: 'dun-mia-002', city: 'Miami',         state: 'FL', region: 'southeast'   },
    { store_id: 'dun-tam-001', city: 'Tampa',         state: 'FL', region: 'southeast'   },
    { store_id: 'dun-orl-001', city: 'Orlando',       state: 'FL', region: 'southeast'   },
    { store_id: 'dun-jax-001', city: 'Jacksonville',  state: 'FL', region: 'southeast'   },
    { store_id: 'dun-atl-001', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'dun-atl-002', city: 'Atlanta',       state: 'GA', region: 'southeast'   },
    { store_id: 'dun-clt-001', city: 'Charlotte',     state: 'NC', region: 'southeast'   },
    { store_id: 'dun-ral-001', city: 'Raleigh',       state: 'NC', region: 'southeast'   },
    // Midwest
    { store_id: 'dun-chi-001', city: 'Chicago',       state: 'IL', region: 'midwest'     },
    { store_id: 'dun-chi-002', city: 'Chicago',       state: 'IL', region: 'midwest'     },
    { store_id: 'dun-det-001', city: 'Detroit',       state: 'MI', region: 'midwest'     },
    { store_id: 'dun-cle-001', city: 'Cleveland',     state: 'OH', region: 'midwest'     },
    { store_id: 'dun-col-001', city: 'Columbus',      state: 'OH', region: 'midwest'     },
    // South
    { store_id: 'dun-hou-001', city: 'Houston',       state: 'TX', region: 'south'       },
    { store_id: 'dun-dal-001', city: 'Dallas',        state: 'TX', region: 'south'       },
    // West (newer expansion markets)
    { store_id: 'dun-lax-001', city: 'Los Angeles',   state: 'CA', region: 'west'        },
    { store_id: 'dun-sfo-001', city: 'San Francisco', state: 'CA', region: 'west'        },
    { store_id: 'dun-den-001', city: 'Denver',        state: 'CO', region: 'west'        },
  ],

  // ── Baskin-Robbins ───────────────────────────────────────────────────────────
  // Truly national — one of the few brands with strong West Coast presence.
  // California alone has hundreds of locations (franchise-heavy).
  'baskin-robbins': [
    // West (strongest region outside franchises)
    { store_id: 'br-lax-001', city: 'Los Angeles',    state: 'CA', region: 'west'        },
    { store_id: 'br-lax-002', city: 'Los Angeles',    state: 'CA', region: 'west'        },
    { store_id: 'br-lax-003', city: 'Los Angeles',    state: 'CA', region: 'west'        },
    { store_id: 'br-sdg-001', city: 'San Diego',      state: 'CA', region: 'west'        },
    { store_id: 'br-sdg-002', city: 'San Diego',      state: 'CA', region: 'west'        },
    { store_id: 'br-sfo-001', city: 'San Francisco',  state: 'CA', region: 'west'        },
    { store_id: 'br-sac-001', city: 'Sacramento',     state: 'CA', region: 'west'        },
    { store_id: 'br-frs-001', city: 'Fresno',         state: 'CA', region: 'west'        },
    { store_id: 'br-sea-001', city: 'Seattle',        state: 'WA', region: 'west'        },
    { store_id: 'br-sea-002', city: 'Seattle',        state: 'WA', region: 'west'        },
    { store_id: 'br-por-001', city: 'Portland',       state: 'OR', region: 'west'        },
    { store_id: 'br-phx-001', city: 'Phoenix',        state: 'AZ', region: 'west'        },
    { store_id: 'br-phx-002', city: 'Phoenix',        state: 'AZ', region: 'west'        },
    { store_id: 'br-tus-001', city: 'Tucson',         state: 'AZ', region: 'west'        },
    { store_id: 'br-lvs-001', city: 'Las Vegas',      state: 'NV', region: 'west'        },
    { store_id: 'br-den-001', city: 'Denver',         state: 'CO', region: 'west'        },
    { store_id: 'br-slc-001', city: 'Salt Lake City', state: 'UT', region: 'west'        },
    // Northeast
    { store_id: 'br-nyc-001', city: 'New York',       state: 'NY', region: 'northeast'   },
    { store_id: 'br-nyc-002', city: 'New York',       state: 'NY', region: 'northeast'   },
    { store_id: 'br-bos-001', city: 'Boston',         state: 'MA', region: 'northeast'   },
    { store_id: 'br-hfd-001', city: 'Hartford',       state: 'CT', region: 'northeast'   },
    // Mid-Atlantic
    { store_id: 'br-phi-001', city: 'Philadelphia',   state: 'PA', region: 'mid-atlantic'},
    { store_id: 'br-bal-001', city: 'Baltimore',      state: 'MD', region: 'mid-atlantic'},
    { store_id: 'br-dca-001', city: 'Washington',     state: 'DC', region: 'mid-atlantic'},
    { store_id: 'br-ric-001', city: 'Richmond',       state: 'VA', region: 'mid-atlantic'},
    // Southeast
    { store_id: 'br-mia-001', city: 'Miami',          state: 'FL', region: 'southeast'   },
    { store_id: 'br-tam-001', city: 'Tampa',          state: 'FL', region: 'southeast'   },
    { store_id: 'br-orl-001', city: 'Orlando',        state: 'FL', region: 'southeast'   },
    { store_id: 'br-atl-001', city: 'Atlanta',        state: 'GA', region: 'southeast'   },
    { store_id: 'br-clt-001', city: 'Charlotte',      state: 'NC', region: 'southeast'   },
    { store_id: 'br-nas-001', city: 'Nashville',      state: 'TN', region: 'southeast'   },
    // Midwest
    { store_id: 'br-chi-001', city: 'Chicago',        state: 'IL', region: 'midwest'     },
    { store_id: 'br-chi-002', city: 'Chicago',        state: 'IL', region: 'midwest'     },
    { store_id: 'br-det-001', city: 'Detroit',        state: 'MI', region: 'midwest'     },
    { store_id: 'br-ind-001', city: 'Indianapolis',   state: 'IN', region: 'midwest'     },
    { store_id: 'br-col-001', city: 'Columbus',       state: 'OH', region: 'midwest'     },
    { store_id: 'br-min-001', city: 'Minneapolis',    state: 'MN', region: 'midwest'     },
    { store_id: 'br-stl-001', city: 'St. Louis',      state: 'MO', region: 'midwest'     },
    // South
    { store_id: 'br-hou-001', city: 'Houston',        state: 'TX', region: 'south'       },
    { store_id: 'br-dal-001', city: 'Dallas',         state: 'TX', region: 'south'       },
    { store_id: 'br-sat-001', city: 'San Antonio',    state: 'TX', region: 'south'       },
    { store_id: 'br-nor-001', city: 'New Orleans',    state: 'LA', region: 'south'       },
  ],

  // ── Jimmy John's ─────────────────────────────────────────────────────────────
  // Founded in Champaign IL — Midwest is the core and most dense region.
  // Strong college-town presence. Expanding South/Southeast; limited coasts.
  'jimmy-johns': [
    // Midwest core (densest region)
    { store_id: 'jj-chi-001', city: 'Chicago',        state: 'IL', region: 'midwest'     },
    { store_id: 'jj-chi-002', city: 'Chicago',        state: 'IL', region: 'midwest'     },
    { store_id: 'jj-chi-003', city: 'Chicago',        state: 'IL', region: 'midwest'     },
    { store_id: 'jj-chm-001', city: 'Champaign',      state: 'IL', region: 'midwest'     },
    { store_id: 'jj-per-001', city: 'Peoria',         state: 'IL', region: 'midwest'     },
    { store_id: 'jj-ind-001', city: 'Indianapolis',   state: 'IN', region: 'midwest'     },
    { store_id: 'jj-ind-002', city: 'Indianapolis',   state: 'IN', region: 'midwest'     },
    { store_id: 'jj-ftw-001', city: 'Fort Wayne',     state: 'IN', region: 'midwest'     },
    { store_id: 'jj-col-001', city: 'Columbus',       state: 'OH', region: 'midwest'     },
    { store_id: 'jj-col-002', city: 'Columbus',       state: 'OH', region: 'midwest'     },
    { store_id: 'jj-cin-001', city: 'Cincinnati',     state: 'OH', region: 'midwest'     },
    { store_id: 'jj-cle-001', city: 'Cleveland',      state: 'OH', region: 'midwest'     },
    { store_id: 'jj-tol-001', city: 'Toledo',         state: 'OH', region: 'midwest'     },
    { store_id: 'jj-det-001', city: 'Detroit',        state: 'MI', region: 'midwest'     },
    { store_id: 'jj-grr-001', city: 'Grand Rapids',   state: 'MI', region: 'midwest'     },
    { store_id: 'jj-min-001', city: 'Minneapolis',    state: 'MN', region: 'midwest'     },
    { store_id: 'jj-min-002', city: 'Minneapolis',    state: 'MN', region: 'midwest'     },
    { store_id: 'jj-mil-001', city: 'Milwaukee',      state: 'WI', region: 'midwest'     },
    { store_id: 'jj-mad-001', city: 'Madison',        state: 'WI', region: 'midwest'     },
    { store_id: 'jj-stl-001', city: 'St. Louis',      state: 'MO', region: 'midwest'     },
    { store_id: 'jj-kcy-001', city: 'Kansas City',    state: 'MO', region: 'midwest'     },
    { store_id: 'jj-spr-001', city: 'Springfield',    state: 'MO', region: 'midwest'     },
    { store_id: 'jj-oma-001', city: 'Omaha',          state: 'NE', region: 'midwest'     },
    { store_id: 'jj-dsm-001', city: 'Des Moines',     state: 'IA', region: 'midwest'     },
    { store_id: 'jj-wic-001', city: 'Wichita',        state: 'KS', region: 'midwest'     },
    // South
    { store_id: 'jj-aus-001', city: 'Austin',         state: 'TX', region: 'south'       },
    { store_id: 'jj-dal-001', city: 'Dallas',         state: 'TX', region: 'south'       },
    { store_id: 'jj-hou-001', city: 'Houston',        state: 'TX', region: 'south'       },
    { store_id: 'jj-sat-001', city: 'San Antonio',    state: 'TX', region: 'south'       },
    { store_id: 'jj-nas-001', city: 'Nashville',      state: 'TN', region: 'south'       },
    { store_id: 'jj-mem-001', city: 'Memphis',        state: 'TN', region: 'south'       },
    { store_id: 'jj-lxk-001', city: 'Lexington',      state: 'KY', region: 'south'       },
    { store_id: 'jj-lou-001', city: 'Louisville',     state: 'KY', region: 'south'       },
    // Southeast
    { store_id: 'jj-atl-001', city: 'Atlanta',        state: 'GA', region: 'southeast'   },
    { store_id: 'jj-atl-002', city: 'Atlanta',        state: 'GA', region: 'southeast'   },
    { store_id: 'jj-clt-001', city: 'Charlotte',      state: 'NC', region: 'southeast'   },
    { store_id: 'jj-ral-001', city: 'Raleigh',        state: 'NC', region: 'southeast'   },
    { store_id: 'jj-tam-001', city: 'Tampa',          state: 'FL', region: 'southeast'   },
    { store_id: 'jj-jax-001', city: 'Jacksonville',   state: 'FL', region: 'southeast'   },
    { store_id: 'jj-bir-001', city: 'Birmingham',     state: 'AL', region: 'southeast'   },
    // Mid-Atlantic / Northeast
    { store_id: 'jj-phi-001', city: 'Philadelphia',   state: 'PA', region: 'mid-atlantic'},
    { store_id: 'jj-pit-001', city: 'Pittsburgh',     state: 'PA', region: 'mid-atlantic'},
    { store_id: 'jj-bal-001', city: 'Baltimore',      state: 'MD', region: 'mid-atlantic'},
    { store_id: 'jj-dca-001', city: 'Washington',     state: 'DC', region: 'mid-atlantic'},
    { store_id: 'jj-ric-001', city: 'Richmond',       state: 'VA', region: 'mid-atlantic'},
    // West
    { store_id: 'jj-den-001', city: 'Denver',         state: 'CO', region: 'west'        },
    { store_id: 'jj-phx-001', city: 'Phoenix',        state: 'AZ', region: 'west'        },
    { store_id: 'jj-lvs-001', city: 'Las Vegas',      state: 'NV', region: 'west'        },
    { store_id: 'jj-slc-001', city: 'Salt Lake City', state: 'UT', region: 'west'        },
    { store_id: 'jj-sea-001', city: 'Seattle',        state: 'WA', region: 'west'        },
  ],
};
