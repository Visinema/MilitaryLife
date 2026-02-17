import type { GameSnapshot } from '@mls/shared/game-types';
import { DIVISION_REFERENCE_PROFILES } from '@mls/shared/division-registry';

export interface PlayerAssignmentDisplay {
  division: string;
  unit: string;
  position: string;
  divisionLabel: string;
  unitLabel: string;
  positionLabel: string;
  hasDivisionPlacement: boolean;
}

export function resolvePlayerAssignment(snapshot?: Pick<GameSnapshot, 'playerDivision' | 'playerPosition'> | null): PlayerAssignmentDisplay {
  const rawDivision = String(snapshot?.playerDivision ?? '').trim();
  const rawPosition = String(snapshot?.playerPosition ?? '').trim();

  const division = rawDivision || 'Nondivisi';
  const position = rawPosition || 'No Position';
  const nonDivision = division.toLowerCase() === 'nondivisi';

  if (nonDivision) {
    return {
      division,
      unit: 'Belum bergabung divisi/korps',
      position,
      divisionLabel: 'Nondivisi',
      unitLabel: 'Belum bergabung divisi/korps',
      positionLabel: 'Belum ada jabatan',
      hasDivisionPlacement: false
    };
  }

  const profile = DIVISION_REFERENCE_PROFILES.find((item) => item.name.toLowerCase() === division.toLowerCase());
  const normalizedPosition = position.toLowerCase();
  const positionIndex = profile?.positions.findIndex((item) => item.toLowerCase() === normalizedPosition) ?? -1;
  const defaultUnit = profile?.units[0] ?? 'Satuan penempatan awal';
  const mappedUnit = positionIndex >= 0 ? (profile?.units[positionIndex] ?? defaultUnit) : defaultUnit;

  return {
    division,
    unit: position.toLowerCase() === 'no position' ? 'Menunggu penempatan satuan' : mappedUnit,
    position,
    divisionLabel: division,
    unitLabel: position.toLowerCase() === 'no position' ? 'Menunggu penempatan satuan' : mappedUnit,
    positionLabel: position.toLowerCase() === 'no position' ? 'Belum ada jabatan' : position,
    hasDivisionPlacement: true
  };
}
