export interface RegisteredDivision {
  id: string;
  name: string;
  type: 'DIVISI' | 'SATUAN_TUGAS' | 'KORPS';
}

export const REGISTERED_DIVISIONS: RegisteredDivision[] = [
  { id: 'special-forces', name: 'Special Operations Division', type: 'SATUAN_TUGAS' },
  { id: 'military-police-division', name: 'Military Police HQ', type: 'DIVISI' },
  { id: 'armored-division', name: 'Armored Command', type: 'DIVISI' },
  { id: 'air-defense-division', name: 'Air Defense HQ', type: 'DIVISI' },
  { id: 'engineering-command', name: 'Engineer Command HQ', type: 'DIVISI' },
  { id: 'medical-support-division', name: 'Medical Command HQ', type: 'DIVISI' },
  { id: 'signal-cyber-corps', name: 'Signal Cyber HQ', type: 'KORPS' },
  { id: 'military-judge-corps', name: 'Military Court Division', type: 'KORPS' }
];
