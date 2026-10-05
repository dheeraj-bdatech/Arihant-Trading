export interface ProductSpecItem {
  id: string;
  name: string;
  category: 
    | 'Security Screening Equipments'
    | 'Protective & Tactical Solutions'
    | 'EOD, Explosive & Specialised Detection'
    | 'Environmental & Workplace Safety'
    | 'Intelligence & Communication Solutions'
    | 'Emergency, Rescue & Field Support';
  code: string;
  make: string;
  specRef: string;
  isMhaQr: boolean;
  image: string;
  description: string;
  features: string[];
  keySpecs: { label: string; value: string }[];
  status: 'Field Ready' | 'Operational' | 'In Transit' | 'Demo Active';
  readiness: number; // percentage
  deploymentsCount: number;
  batteryLife?: string;
  weight?: string;
  ipRating?: string;
  model3DType: 'robot' | 'scanner' | 'detector' | 'shield' | 'spectrometer' | 'sensor' | 'vehicle' | 'station';
}

export const BROCHURE_CATEGORIES = [
  'All Solutions',
  'Security Screening Equipments',
  'Protective & Tactical Solutions',
  'EOD, Explosive & Specialised Detection',
  'Environmental & Workplace Safety',
  'Intelligence & Communication Solutions',
  'Emergency, Rescue & Field Support'
] as const;

export const BROCHURE_PRODUCTS: ProductSpecItem[] = [
  {
    id: 'atc-ugv-84',
    name: 'Unmanned Ground Vehicle (UGV / EOD Bomb Disposal Robot)',
    category: 'EOD, Explosive & Specialised Detection',
    code: '#ATC-UGV-84610',
    make: 'Arihant Robotics',
    specRef: 'MHA-QR-UGV-EOD',
    isMhaQr: true,
    image: '/products/unmanned_ground_vehicle_ugv.png',
    description: 'Remotely operated all-terrain robotic vehicle designed for safe standoff inspection, reconnaissance, and manipulation of high-risk explosive and hazardous CBRN threats.',
    features: [
      'Remote-Controlled Standoff Operation',
      'High-Risk Area EOD & Bomb Disposal',
      '6-DOF Robotic Manipulator Arm with 15kg Lift',
      'Integrated Multi-Spectrum Night/Day Camera Feed',
      'All-Terrain Continuous Track Drive System',
      'Hazardous Object Disruption & Gripper'
    ],
    keySpecs: [
      { label: 'Control Range', value: '1,200 m (RF) / 5 km (Relay)' },
      { label: 'Manipulator DOF', value: '6-Axis Articulated' },
      { label: 'Endurance', value: '6.5 Hours Continuous' },
      { label: 'Payload Capacity', value: '45 kg Max Chassis' },
      { label: 'Protection Rating', value: 'IP67 Submersible / CBRN Decon' },
      { label: 'Speed', value: 'Up to 12 km/h' }
    ],
    status: 'Operational',
    readiness: 98,
    deploymentsCount: 142,
    batteryLife: '6.5 Hours',
    weight: '38.5 kg',
    ipRating: 'IP67',
    model3DType: 'robot'
  },
  {
    id: 'atc-fbs-301',
    name: 'X-Ray Based Full Body Scanner System',
    category: 'Security Screening Equipments',
    code: '#ATC-FBS-84110',
    make: 'Arihant / Rapiscan',
    specRef: 'MHA-QR-FBS-2026',
    isMhaQr: true,
    image: '/products/full_body_scanner.png',
    description: 'Ultra-high-throughput walk-through screening portal designed for fast, non-contact detection of metallic, ceramic, liquid, and concealed contraband threats inside individuals.',
    features: [
      'Fast & Non-Contact Walk-Through Scan (3.5s)',
      'Advanced 3D Multi-Perspective Detection Technology',
      'Automatic Threat Localization & Privacy-Compliant Avatar',
      'Full MHA QR & AERB Radiation Certified (<0.1 µSv/scan)',
      'Integrated High-Resolution Display & Operator Console'
    ],
    keySpecs: [
      { label: 'Throughput', value: '300-400 Persons / Hour' },
      { label: 'Dose per Scan', value: '< 0.1 µSv (AERB Compliant)' },
      { label: 'Target Types', value: 'Metals, Non-metals, Liquids, Explosives' },
      { label: 'Privacy Mode', value: 'Generic Mannequin Avatar' },
      { label: 'Integration', value: 'BOS Cloud & CCTV Sync' }
    ],
    status: 'Field Ready',
    readiness: 99,
    deploymentsCount: 68,
    weight: '480 kg',
    ipRating: 'IP54',
    model3DType: 'scanner'
  },
  {
    id: 'atc-nij4-sh',
    name: 'NIJ Level 4 Shield & Carry System',
    category: 'Protective & Tactical Solutions',
    code: '#ATC-NIJ4-9901',
    make: 'Arihant Tactical',
    specRef: 'NIJ-0108.01-IV',
    isMhaQr: true,
    image: '/products/nij4_shield_system.png',
    description: 'High-level ballistic assault protection system featuring an ultra-mobile trolley carry rig, high-transmittance ballistic glass viewport, and multi-hit AP projectile stoppage.',
    features: [
      'Certified NIJ Level IV Multi-Hit Ballistic Protection',
      'Mobile Rapid-Deployment Carry Rig with Heavy-Duty Castors',
      'Wide-View High-Clarity Ballistic Viewport',
      'Tactical Strobe / LED Illumination Module Slot',
      'Quick-Detach Harness for Dynamic Tactical Entries'
    ],
    keySpecs: [
      { label: 'Threat Level', value: 'NIJ IV (7.62x54mmR AP / 30-06 AP)' },
      { label: 'Shield Area', value: '1200 x 600 mm' },
      { label: 'Viewport Size', value: '250 x 100 mm Ballistic Glass' },
      { label: 'Chassis', value: 'High-Strength Light Alloy Trolley' }
    ],
    status: 'Field Ready',
    readiness: 96,
    deploymentsCount: 310,
    weight: '24.5 kg (Shield) + 12 kg (Rig)',
    model3DType: 'shield'
  },
  {
    id: 'atc-serstech-14',
    name: 'Serstech Raman Spectroscopy Chemical & Narcotics Detector',
    category: 'EOD, Explosive & Specialised Detection',
    code: '#ATC-SRT-14022',
    make: 'Serstech / Arihant',
    specRef: 'ATC-SRT-RAMAN',
    isMhaQr: true,
    image: '/products/serstech_raman_detector.png',
    description: 'Handheld 785nm Raman spectrometer for instant, non-contact identification of unknown chemical powders, liquids, narcotics, warfare agents, and improvised explosive precursors.',
    features: [
      'Rapid Identification in Under 7 Seconds',
      'Extensive Onboard Threat Library of 14,000+ Substances',
      'Advanced Autofocus Through Glass & Translucent Bottles',
      'Rugged IP67 Water/Dust Proof & MIL-STD-810H Drop Tested',
      'Zero Consumables & Zero Regular Calibration Required'
    ],
    keySpecs: [
      { label: 'Laser Wavelength', value: '785 nm Solid State' },
      { label: 'Identification Time', value: '3 to 10 Seconds' },
      { label: 'Library Size', value: '14,000+ Explosives, Narcotics, CWAs' },
      { label: 'Connectivity', value: 'WiFi, 4G, Bluetooth, USB-C' }
    ],
    status: 'Operational',
    readiness: 97,
    deploymentsCount: 89,
    batteryLife: '8 Hours (Hot-Swap)',
    weight: '650 g',
    ipRating: 'IP67',
    model3DType: 'spectrometer'
  },
  {
    id: 'atc-dsmd-03',
    name: 'Deep Search Mine Detector (DSMD)',
    category: 'EOD, Explosive & Specialised Detection',
    code: '#ATC-DSM-03091',
    make: 'Vallon / Arihant',
    specRef: 'MHA-QR-DSMD-V3',
    isMhaQr: true,
    image: '/products/deep_search_mine_detector.png',
    description: 'High-performance pulse-induction deep-search mine locator optimized for pinpointing plastic and minimum-metal anti-personnel/anti-tank mines across heavily mineralized soils.',
    features: [
      'Deep Search Penetration up to 3.5 Metres',
      'Superior Low-Metal and Plastic Mine Target Localization',
      'Automatic Ground Soil Compensation & Interference Filter',
      'Acoustic Pitch & High-Visibility LED Bar Graph Alert',
      'Submersible Search Head (Subsea & Riverbank Operations)'
    ],
    keySpecs: [
      { label: 'Operating Principle', value: 'Pulse Induction Dynamic' },
      { label: 'Max Detection Depth', value: 'Up to 3.5 m (Large Ferrous)' },
      { label: 'Search Head', value: 'Oval Telescopic Waterproof' },
      { label: 'Battery Runtime', value: '25 Hours Alkaline / Li-Ion' }
    ],
    status: 'In Transit',
    readiness: 94,
    deploymentsCount: 205,
    batteryLife: '25 Hours',
    weight: '2.3 kg',
    ipRating: 'IP68',
    model3DType: 'detector'
  },
  {
    id: 'atc-dfmd-mz',
    name: 'Multi-Zone Door Frame Metal Detector (DFMD)',
    category: 'Protective & Tactical Solutions',
    code: '#ATC-DFMD-3301',
    make: 'Arihant / Garrett',
    specRef: 'MHA-QR-DFMD-MZ',
    isMhaQr: true,
    image: '/products/dfmd_walkthrough.png',
    description: 'Enterprise 33-detection zone walk-through archway portal providing pin-point vertical and horizontal localization of concealed weapons, knives, and micro-contraband.',
    features: [
      '33 Distinct Pinpoint Detection Zones (Left, Center, Right)',
      'Multi-Zone LED Pillar Displays on Both Door Columns',
      'Uniform Detection Sensitivity from Head to Toe',
      'High Traffic Flow Throughput (60+ Pedestrians / Min)',
      'Immune to External Electrical Interference'
    ],
    keySpecs: [
      { label: 'Zones', value: '33 Detection Zones' },
      { label: 'Throughput', value: 'Up to 60 Persons / Minute' },
      { label: 'Sensitivity Levels', value: '200 Adjustable Steps' },
      { label: 'Alarms', value: 'Zone LED Columns + Audible Tone' }
    ],
    status: 'Operational',
    readiness: 100,
    deploymentsCount: 520,
    weight: '62 kg',
    ipRating: 'IP55',
    model3DType: 'scanner'
  },
  {
    id: 'atc-rtvs-02',
    name: 'Hand-Held / Wireless Real Time Viewing System (RTVS)',
    category: 'Security Screening Equipments',
    code: '#ATC-RTVS-2041',
    make: 'Arihant / Zistos',
    specRef: 'MHA-QR-RTVS-V2',
    isMhaQr: true,
    image: '/products/real_time_viewing_rtvs.png',
    description: 'Ultra-thin digital flat-panel X-ray inspection system engineered for rapid inspection of suspect parcels, vehicle doors, fuel tanks, and abandoned luggage.',
    features: [
      'Sub-Millimetre High-Resolution Real-Time Digital Imaging',
      'Ultra-Thin Lightweight Imager Panel (12 mm)',
      'Direct Wireless Video Transmission to Rugged Tablet',
      'Non-Destructive Immediate Substance Density Analysis',
      'Dual-Energy Organic vs Inorganic Color Stripping'
    ],
    keySpecs: [
      { label: 'Image Resolution', value: '40 lp/cm (16-bit Grey)' },
      { label: 'Imager Active Area', value: '300 x 250 mm' },
      { label: 'Wireless Range', value: '250 m Standoff' },
      { label: 'Penetration', value: '25 mm Steel Equivalent' }
    ],
    status: 'Demo Active',
    readiness: 95,
    deploymentsCount: 114,
    batteryLife: '5 Hours',
    weight: '3.8 kg Total Kit',
    model3DType: 'spectrometer'
  },
  {
    id: 'atc-hhmd-nms30',
    name: 'NMS30 Hand-Held Metal Detector',
    category: 'Security Screening Equipments',
    code: '#ATC-NMS-3004',
    make: 'Arihant Security',
    specRef: 'MHA-QR-HHMD-NMS30',
    isMhaQr: true,
    image: '/products/nms30_hhmd.png',
    description: 'Rugged high-sensitivity hand scanner with wide detection surface, three-level sensitivity selection, and automatic interference frequency shifting.',
    features: [
      'Wide Scanning Surface for Rapid Body Sweeps',
      '3-Level Switchable Sensitivity (Standard, High, Ultra)',
      'Triple Alert Mode: Sound, Vibration, and Multi-LED Bar',
      'Frequency Shift to Prevent Adjacent Scanner Crosstalk',
      '40+ Hours Battery Life on Single Charge'
    ],
    keySpecs: [
      { label: 'Detection Sensitivity', value: 'Pin to Pistol Precision' },
      { label: 'Battery Life', value: '40+ Hours Continuous' },
      { label: 'Protection', value: 'IP67 Waterproof / Drop Tested' },
      { label: 'Charging', value: 'Drop-in Charging Dock' }
    ],
    status: 'Field Ready',
    readiness: 99,
    deploymentsCount: 1450,
    batteryLife: '40+ Hours',
    weight: '410 g',
    ipRating: 'IP67',
    model3DType: 'detector'
  },
  {
    id: 'atc-ift-40',
    name: 'Rapid Inflatable Field Command Tent & Medical Shelter',
    category: 'Emergency, Rescue & Field Support',
    code: '#ATC-IFT-4001',
    make: 'Arihant Rescue',
    specRef: 'NDRF-SPEC-TENT-40',
    isMhaQr: true,
    image: '/products/inflatable_tent.png',
    description: 'High-pressure air-beam deployable tactical shelter erected in under 4 minutes. All-weather heavy-duty PVC structure for forward surgical stations and tactical headquarters.',
    features: [
      'High-Pressure Air-Beam Frame (Inflates in < 4 Min)',
      'Zero Metal Framework / Compact Packed Volume',
      'Modular Interlocking Passages for Camp Expansion',
      'Fire-Retardant, UV-Resistant & 100 km/h Wind Tested',
      'Integrated HVAC Ports, Cable Sleeves & Lighting Rigging'
    ],
    keySpecs: [
      { label: 'Usable Floor Area', value: '40 m² (Optional 60 m²)' },
      { label: 'Deployment Time', value: '3.5 Minutes with Electric Blower' },
      { label: 'Wind Resistance', value: 'Up to 100 km/h with Anchors' },
      { label: 'Fabric Material', value: 'Heavy Duty 1100 dTex PVC' }
    ],
    status: 'Operational',
    readiness: 98,
    deploymentsCount: 82,
    weight: '78 kg',
    model3DType: 'station'
  },
  {
    id: 'atc-nljd-25',
    name: 'Non-Linear Junction Evaluator (NLJD)',
    category: 'EOD, Explosive & Specialised Detection',
    code: '#ATC-NLJ-07011',
    make: 'Arihant Surveillance',
    specRef: 'MHA-QR-NLJD-2025',
    isMhaQr: true,
    image: '/products/non_linear_junction_evaluator.png',
    description: 'Counter-surveillance inspection system detecting semiconductor junctions in electronic listening bugs, hidden cameras, and radio detonators, even when powered off.',
    features: [
      'Detects Semiconductor Silicon Diodes in Active & Inactive Devices',
      'Selective 2nd and 3rd Harmonic Signal Discrimination',
      'Distinguishes True Electronics from False Corrosive Metals',
      'Directional Articulated Antenna with Color LCD Display',
      'Ergonomic Carbon-Fibre Telescopic Wand'
    ],
    keySpecs: [
      { label: 'Transmit Frequency', value: '2.4 GHz Band' },
      { label: 'Harmonic Detection', value: '2nd (Semiconductor) & 3rd (Corrosive)' },
      { label: 'Sensitivity', value: '-140 dBm' },
      { label: 'Telescopic Reach', value: 'Extends up to 1.8 m' }
    ],
    status: 'Field Ready',
    readiness: 97,
    deploymentsCount: 76,
    batteryLife: '4.5 Hours',
    weight: '1.4 kg',
    model3DType: 'detector'
  },
  {
    id: 'atc-cim-prison',
    name: 'Correctional Cellular Intelligence & RF Firewall Platform',
    category: 'Intelligence & Communication Solutions',
    code: '#ATC-CIM-1002',
    make: 'Arihant Cyber & Intel',
    specRef: 'MHA-QR-CIM-PRISON',
    isMhaQr: true,
    image: '/products/cellular_intelligence_monitoring.png',
    description: 'Autonomous IMSI catcher and non-jamming cellular firewall detecting, localizing, and intercepting unauthorized 2G/3G/4G/5G mobile phones within high-security prisons.',
    features: [
      'Comprehensive 2G, 3G, 4G & 5G Cellular Detection',
      'Ultra-Precise Indoor 3D Localization of Contraband Phones',
      'Directional RF Virtual Firewall Without Disrupting Public Nets',
      'Automated Forensic IMSI/IMEI Logging & Alarm Triggers',
      'Centralised Web-Based Command Dashboard'
    ],
    keySpecs: [
      { label: 'Supported Standards', value: 'GSM, CDMA, UMTS, LTE, 5G-NR' },
      { label: 'Localization Accuracy', value: '< 2 Metres (Cell Block Precision)' },
      { label: 'Detection Speed', value: 'Instantaneous (< 1 Second)' },
      { label: 'Coverage', value: 'Multi-Sensor Array Scalable to 500k m²' }
    ],
    status: 'Operational',
    readiness: 100,
    deploymentsCount: 34,
    model3DType: 'station'
  },
  {
    id: 'atc-morcha-25',
    name: 'BP Morcha (Ballistic Protection Portable Post)',
    category: 'Protective & Tactical Solutions',
    code: '#ATC-BPM-2501',
    make: 'Arihant Defence',
    specRef: 'MHA-QR-BPM-2025',
    isMhaQr: true,
    image: '/products/bp_morcha.png',
    description: 'Armoured mobile defensive post providing 360-degree ballistic shelter and sniper-resistant observation ports for sentries at critical forward installations.',
    features: [
      'Multi-Hit Level IV Ballistic Steel & Ceramic Armour Panels',
      'Integrated Sliding Firing Ports & Bulletproof Glass Louvers',
      'Rapid Assembly On-Site in Under 15 Minutes with Pin Latches',
      'Heavy-Duty Roof Camouflage & Overhead Drone Fragment Deflector'
    ],
    keySpecs: [
      { label: 'Protection Rating', value: 'NIJ IV / STANAG 4569 Level 2' },
      { label: 'Occupancy', value: '2 Armed Sentries' },
      { label: 'Observation Ports', value: '4 Side Ports with 75mm Glass' },
      { label: 'Footprint', value: '1.5 m x 1.5 m Base' }
    ],
    status: 'Field Ready',
    readiness: 98,
    deploymentsCount: 165,
    weight: '320 kg Modular',
    model3DType: 'station'
  }
];

export const BROCHURE_STATS = {
  yearsInBusiness: '20+',
  projectsExecuted: '100+',
  activeCustomers: '100+',
  globalPartners: '25+',
  totalDeployments: 38450,
  onTimeReadiness: '98.6%',
  headquarters: '11 Vaibhav Apartment, Budh Marg, Patna, Bihar – 800001',
  delhiHub: 'Flat no: 06, Plot 17-19, Extended Lal Dora, Bharthal, New Delhi – 110077',
  kolkataHub: '4 ADI, Banastalla Lane, 5th Floor, Kolkata – 700007'
};
