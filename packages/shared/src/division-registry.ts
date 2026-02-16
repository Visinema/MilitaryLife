export interface RegisteredDivision {
  id: string;
  name: string;
  type: 'DIVISI' | 'SATUAN_TUGAS' | 'KORPS';
}

export interface DivisionReferenceProfile extends RegisteredDivision {
  subdivisions: string[];
  units: string[];
  positions: string[];
}

export const DIVISION_REFERENCE_PROFILES: DivisionReferenceProfile[] = [
  {
    id: 'special-forces',
    name: 'Special Operations Division',
    type: 'SATUAN_TUGAS',
    subdivisions: ['Rapid Breach Unit', 'Deep Recon Corps', 'Special Tactics Cell'],
    units: ['Silent Insertion Team', 'Recon Strike Team', 'Night Breach Group'],
    positions: ['Task Group Commander', 'XO Special Operations', 'Intel Lead']
  },
  {
    id: 'military-police-division',
    name: 'Military Police HQ',
    type: 'DIVISI',
    subdivisions: ['Base Law Enforcement Unit', 'Security Escort Corps', 'Detention Control'],
    units: ['Route Security Team', 'Field Investigation Team', 'Custody Patrol Group'],
    positions: ['Provost Marshal', 'Deputy Marshal', 'Legal Ops Officer']
  },
  {
    id: 'armored-division',
    name: 'Armored Command',
    type: 'DIVISI',
    subdivisions: ['Tank Battalion Alpha', 'Mechanized Support Corps', 'Heavy Armor Wing'],
    units: ['MBT Squadron', 'Recovery Crew Team', 'Armor Spearhead Unit'],
    positions: ['Division Commander', 'Ops Chief', 'Armor Logistics Lead']
  },
  {
    id: 'air-defense-division',
    name: 'Air Defense HQ',
    type: 'DIVISI',
    subdivisions: ['Missile Intercept Unit', 'Counter-UAV Corps', 'Radar Watch Group'],
    units: ['SAM Battery Team', 'EW Intercept Team', 'Radar Mesh Unit'],
    positions: ['Air Defense Commander', 'Radar Director', 'EW Lead']
  },
  {
    id: 'engineering-command',
    name: 'Engineer Command HQ',
    type: 'DIVISI',
    subdivisions: ['Combat Engineer Unit', 'EOD Response Corps', 'Mobility Support Wing'],
    units: ['Bridge Builder Team', 'Route Clearance Team', 'Fortification Crew'],
    positions: ['Chief Engineer', 'EOD Chief', 'Mobility Officer']
  },
  {
    id: 'medical-support-division',
    name: 'Medical Command HQ',
    type: 'DIVISI',
    subdivisions: ['Combat Medical Unit', 'Medical Evac Corps', 'Preventive Medicine Wing'],
    units: ['Triage Team', 'MEDEVAC Crew', 'Field Hospital Unit'],
    positions: ['Medical Director', 'Trauma Lead', 'Evac Coordinator']
  },
  {
    id: 'signal-cyber-corps',
    name: 'Signal Cyber HQ',
    type: 'KORPS',
    subdivisions: ['Network Defense Unit', 'Offensive Security Corps', 'Tactical Comms Wing'],
    units: ['SOC Team', 'Encryption Node Team', 'Signal Relay Unit'],
    positions: ['Cyber Director', 'Signal Commander', 'Threat Analyst']
  },
  {
    id: 'military-judge-corps',
    name: 'Military Court Division',
    type: 'KORPS',
    subdivisions: ['Court Clerk Unit', 'Military Law Corps', 'Tribunal Review Board'],
    units: ['Evidence Archive Team', 'Legal Review Team', 'Disciplinary Panel Unit'],
    positions: ['Judge Chair', 'Case Reviewer', 'Defense Liaison']
  }
];

export const REGISTERED_DIVISIONS: RegisteredDivision[] = DIVISION_REFERENCE_PROFILES.map(({ id, name, type }) => ({ id, name, type }));
