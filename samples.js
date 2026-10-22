/*! WaterNet example networks. */
(function (root) {
  'use strict';

  const DIURNAL = [0.62, 0.55, 0.52, 0.50, 0.55, 0.68, 0.85, 1.05, 1.18, 1.15, 1.05, 0.98, 0.95, 0.92, 0.90, 0.95, 1.10, 1.25, 1.30, 1.18, 1.00, 0.85, 0.75, 0.68];

  function riverside() {
    return {
      format: 'waternet',
      version: 1,
      name: 'Riverside Park',
      units: 'SI',
      options: { duration: 24, hydraulicStep: 1, demandMultiplier: 1, patternStep: 1, defaultPattern: '1' },
      patterns: { '1': DIURNAL.slice() },
      nodes: [
        { id: 'R1', type: 'reservoir', x: -390, y: 260, elevation: 0, head: 25 },
        { id: 'T1', type: 'tank', x: -130, y: 205, elevation: 45, level: 10, minLevel: 0, maxLevel: 15, diameter: 20 },
        { id: 'J1', type: 'junction', x: -20, y: 160, elevation: 35, demand: 4, pattern: '1' },
        { id: 'J2', type: 'junction', x: 60, y: 195, elevation: 32, demand: 3, pattern: '1' },
        { id: 'J3', type: 'junction', x: 140, y: 165, elevation: 30, demand: 5, pattern: '1' },
        { id: 'J4', type: 'junction', x: -20, y: 80, elevation: 22, demand: 6, pattern: '1' },
        { id: 'J5', type: 'junction', x: 60, y: 105, elevation: 20, demand: 5, pattern: '1' },
        { id: 'J6', type: 'junction', x: 140, y: 90, elevation: 18, demand: 7, pattern: '1' },
        { id: 'J7', type: 'junction', x: 225, y: 130, elevation: 28, demand: 4, pattern: '1' },
        { id: 'J8', type: 'junction', x: 225, y: 50, elevation: 16, demand: 6, pattern: '1' },
        { id: 'J9', type: 'junction', x: 305, y: 95, elevation: 24, demand: 3, pattern: '1' },
        { id: 'J10', type: 'junction', x: 305, y: 20, elevation: 14, demand: 4, pattern: '1' }
      ],
      links: [
        { id: 'PU1', type: 'pump', from: 'R1', to: 'T1', shutoffHead: 45, maxFlow: 50, speed: 1, status: 'OPEN' },
        { id: 'P1', type: 'pipe', from: 'T1', to: 'J1', length: 300, diameter: 400, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P2', type: 'pipe', from: 'J1', to: 'J2', length: 180, diameter: 250, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P3', type: 'pipe', from: 'J2', to: 'J3', length: 180, diameter: 250, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P4', type: 'pipe', from: 'J1', to: 'J4', length: 160, diameter: 300, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P5', type: 'pipe', from: 'J4', to: 'J5', length: 180, diameter: 250, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P6', type: 'pipe', from: 'J5', to: 'J6', length: 180, diameter: 250, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P7', type: 'pipe', from: 'J2', to: 'J5', length: 200, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P8', type: 'pipe', from: 'J3', to: 'J6', length: 220, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P9', type: 'pipe', from: 'J6', to: 'J7', length: 180, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P10', type: 'pipe', from: 'J7', to: 'J8', length: 160, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P11', type: 'pipe', from: 'J7', to: 'J9', length: 160, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P12', type: 'pipe', from: 'J9', to: 'J10', length: 160, diameter: 150, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P13', type: 'pipe', from: 'J3', to: 'J7', length: 200, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P14', type: 'pipe', from: 'J4', to: 'J8', length: 260, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' }
      ]
    };
  }

  function grid() {
    const nodes = [
      { id: 'R1', type: 'reservoir', x: -230, y: 130, elevation: 0, head: 72 }
    ];
    const links = [];
    const elev = [[16, 13, 11], [20, 17, 15], [26, 23, 21]];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const id = 'J' + (row * 3 + col + 1);
        nodes.push({
          id: id,
          type: 'junction',
          x: col * 140,
          y: (2 - row) * 120,
          elevation: elev[row][col],
          demand: 3 + ((row + col) % 3),
          pattern: '1'
        });
      }
    }
    links.push({ id: 'P0', type: 'pipe', from: 'R1', to: 'J1', length: 380, diameter: 350, roughness: 125, minorLoss: 0, status: 'OPEN' });
    let n = 1;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const id = 'J' + (row * 3 + col + 1);
        if (col < 2) links.push({ id: 'P' + (n++), type: 'pipe', from: id, to: 'J' + (row * 3 + col + 2), length: 140, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' });
        if (row < 2) links.push({ id: 'P' + (n++), type: 'pipe', from: id, to: 'J' + ((row + 1) * 3 + col + 1), length: 120, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' });
      }
    }
    // A diagonal loop for redundancy.
    links.push({ id: 'P' + (n++), type: 'pipe', from: 'J2', to: 'J6', length: 190, diameter: 150, roughness: 120, minorLoss: 0, status: 'OPEN' });
    return {
      format: 'waternet',
      version: 1,
      name: 'Grid District',
      units: 'SI',
      options: { duration: 24, hydraulicStep: 1, demandMultiplier: 1, patternStep: 1, defaultPattern: '1' },
      patterns: { '1': DIURNAL.slice() },
      nodes: nodes,
      links: links
    };
  }

  function booster() {
    return {
      format: 'waternet',
      version: 1,
      name: 'Booster Station',
      units: 'SI',
      options: { duration: 12, hydraulicStep: 1, demandMultiplier: 1, patternStep: 1 },
      patterns: {},
      nodes: [
        { id: 'R1', type: 'reservoir', x: -320, y: 120, elevation: 0, head: 12 },
        { id: 'J1', type: 'junction', x: -180, y: 120, elevation: 18, demand: 2 },
        { id: 'J2', type: 'junction', x: -40, y: 170, elevation: 48, demand: 8 },
        { id: 'J3', type: 'junction', x: -40, y: 70, elevation: 46, demand: 7 },
        { id: 'J4', type: 'junction', x: 100, y: 190, elevation: 44, demand: 6 },
        { id: 'J5', type: 'junction', x: 100, y: 50, elevation: 42, demand: 6 },
        { id: 'J6', type: 'junction', x: 230, y: 120, elevation: 40, demand: 9 }
      ],
      links: [
        { id: 'PU1', type: 'pump', from: 'R1', to: 'J1', shutoffHead: 80, maxFlow: 70, speed: 1, status: 'OPEN' },
        { id: 'P1', type: 'pipe', from: 'J1', to: 'J2', length: 320, diameter: 250, roughness: 115, minorLoss: 0, status: 'OPEN' },
        { id: 'P2', type: 'pipe', from: 'J1', to: 'J3', length: 320, diameter: 250, roughness: 115, minorLoss: 0, status: 'OPEN' },
        { id: 'P3', type: 'pipe', from: 'J2', to: 'J4', length: 180, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P4', type: 'pipe', from: 'J3', to: 'J5', length: 180, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P5', type: 'pipe', from: 'J4', to: 'J6', length: 200, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P6', type: 'pipe', from: 'J5', to: 'J6', length: 200, diameter: 200, roughness: 120, minorLoss: 0, status: 'OPEN' },
        { id: 'P7', type: 'pipe', from: 'J2', to: 'J3', length: 110, diameter: 150, roughness: 120, minorLoss: 0, status: 'OPEN' }
      ]
    };
  }

  function blank() {
    return {
      format: 'waternet',
      version: 1,
      name: 'Untitled network',
      units: 'SI',
      options: { duration: 0, hydraulicStep: 1, demandMultiplier: 1, patternStep: 1 },
      patterns: {},
      nodes: [],
      links: []
    };
  }

  const list = [
    { id: 'riverside', name: 'Riverside Park', description: 'Pumped storage + looped distribution · 12 nodes', make: riverside },
    { id: 'grid', name: 'Grid District', description: 'Gravity-fed looped grid · 10 nodes', make: grid },
    { id: 'booster', name: 'Booster Station', description: 'Pump-fed branches · 7 nodes', make: booster },
    { id: 'blank', name: 'Blank Network', description: 'Start from scratch', make: blank }
  ];

  root.WaterNetSamples = {
    list: list,
    get: function (id) {
      const item = list.find(function (s) { return s.id === id; });
      return item ? item.make() : riverside();
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
