INSERT INTO events (code, country, branch, rank_min, rank_max, base_weight, cooldown_days, title, description, options)
VALUES
(
  'US_ARMY_DISCIPLINE_CHECK',
  'US',
  'US_ARMY',
  0,
  6,
  4,
  25,
  'Discipline Inspection',
  'Your unit commander announces an unplanned discipline inspection before weekend leave.',
  '[
    {"id":"A","label":"Volunteer to lead prep","effects":{"money":600,"morale":-3,"health":0,"promotionPoints":4}},
    {"id":"B","label":"Do standard compliance","effects":{"money":300,"morale":0,"health":0,"promotionPoints":2}},
    {"id":"C","label":"Push back on timeline","effects":{"money":0,"morale":-5,"health":0,"promotionPoints":-2}}
  ]'::jsonb
),
(
  'US_ARMY_FIELD_MED',
  'US',
  'US_ARMY',
  1,
  6,
  3,
  30,
  'Field Medical Drill',
  'A live field drill opens a temporary leadership slot for med-evac coordination.',
  '[
    {"id":"A","label":"Take the lead","effects":{"money":800,"morale":2,"health":-2,"promotionPoints":5}},
    {"id":"B","label":"Support logistics","effects":{"money":450,"morale":1,"health":0,"promotionPoints":3}},
    {"id":"C","label":"Sit out due fatigue","effects":{"money":0,"morale":-2,"health":2,"promotionPoints":0}}
  ]'::jsonb
),
(
  'US_NAVY_ENGINE_ALERT',
  'US',
  'US_NAVY',
  0,
  6,
  4,
  22,
  'Engine Room Alert',
  'A systems alert triggers emergency maintenance during off-shift hours.',
  '[
    {"id":"A","label":"Take emergency shift","effects":{"money":700,"morale":-2,"health":-1,"promotionPoints":4}},
    {"id":"B","label":"Assist scheduled crew","effects":{"money":420,"morale":0,"health":0,"promotionPoints":2}},
    {"id":"C","label":"Request exemption","effects":{"money":0,"morale":-3,"health":1,"promotionPoints":-1}}
  ]'::jsonb
),
(
  'US_NAVY_PORT_SECURITY',
  'US',
  'US_NAVY',
  2,
  6,
  3,
  28,
  'Port Security Rotation',
  'A high-traffic port requires extra watch rotations for three nights.',
  '[
    {"id":"A","label":"Take extra watch","effects":{"money":900,"morale":-3,"health":-1,"promotionPoints":5}},
    {"id":"B","label":"Take normal assignment","effects":{"money":500,"morale":0,"health":0,"promotionPoints":3}},
    {"id":"C","label":"Swap out last minute","effects":{"money":150,"morale":-2,"health":0,"promotionPoints":0}}
  ]'::jsonb
),
(
  'ID_AD_BORDER_PATROL',
  'ID',
  'ID_TNI_AD',
  0,
  6,
  5,
  20,
  'Border Patrol Rotation',
  'Your platoon receives a sudden assignment to reinforce a remote border checkpoint.',
  '[
    {"id":"A","label":"Lead the patrol unit","effects":{"money":420,"morale":1,"health":-2,"promotionPoints":5}},
    {"id":"B","label":"Take standard role","effects":{"money":260,"morale":0,"health":-1,"promotionPoints":3}},
    {"id":"C","label":"Request reserve duty","effects":{"money":80,"morale":-2,"health":1,"promotionPoints":0}}
  ]'::jsonb
),
(
  'ID_AD_CIVIL_SUPPORT',
  'ID',
  'ID_TNI_AD',
  1,
  6,
  3,
  24,
  'Civil Support Mission',
  'Local authorities request military assistance for flood response logistics.',
  '[
    {"id":"A","label":"Coordinate volunteers","effects":{"money":340,"morale":2,"health":-1,"promotionPoints":4}},
    {"id":"B","label":"Handle supply lanes","effects":{"money":230,"morale":1,"health":0,"promotionPoints":2}},
    {"id":"C","label":"Stay in base reserve","effects":{"money":120,"morale":-1,"health":1,"promotionPoints":0}}
  ]'::jsonb
),
(
  'ID_AL_HARBOR_INSPECTION',
  'ID',
  'ID_TNI_AL',
  0,
  6,
  4,
  21,
  'Harbor Inspection Surge',
  'An unexpected harbor inspection requires extra naval personnel overnight.',
  '[
    {"id":"A","label":"Take inspection lead","effects":{"money":390,"morale":0,"health":-1,"promotionPoints":4}},
    {"id":"B","label":"Assist technical checks","effects":{"money":260,"morale":1,"health":0,"promotionPoints":3}},
    {"id":"C","label":"Stay with routine shift","effects":{"money":130,"morale":0,"health":1,"promotionPoints":1}}
  ]'::jsonb
),
(
  'ID_AL_COAST_GUARD_SYNC',
  'ID',
  'ID_TNI_AL',
  2,
  6,
  3,
  27,
  'Coast Guard Joint Drill',
  'A joint drill opens temporary slots for coordination and vessel command support.',
  '[
    {"id":"A","label":"Take coordination role","effects":{"money":470,"morale":1,"health":-2,"promotionPoints":5}},
    {"id":"B","label":"Support operations desk","effects":{"money":300,"morale":1,"health":0,"promotionPoints":3}},
    {"id":"C","label":"Decline due readiness gap","effects":{"money":0,"morale":-2,"health":0,"promotionPoints":-1}}
  ]'::jsonb
),
(
  'US_ARMY_SUPPLY_SHORT',
  'US',
  'US_ARMY',
  0,
  6,
  2,
  18,
  'Supply Chain Shortage',
  'Critical supplies are delayed and your squad must reprioritize operational readiness.',
  '[
    {"id":"A","label":"Work overtime to recover","effects":{"money":650,"morale":-2,"health":-1,"promotionPoints":4}},
    {"id":"B","label":"Follow normal queue","effects":{"money":280,"morale":0,"health":0,"promotionPoints":2}},
    {"id":"C","label":"Escalate aggressively","effects":{"money":100,"morale":-3,"health":0,"promotionPoints":1}}
  ]'::jsonb
),
(
  'US_NAVY_CREW_RESHUFFLE',
  'US',
  'US_NAVY',
  0,
  6,
  2,
  19,
  'Crew Reshuffle',
  'Your vessel receives a short-notice crew reshuffle before a patrol cycle.',
  '[
    {"id":"A","label":"Take extra responsibility","effects":{"money":620,"morale":-1,"health":-1,"promotionPoints":4}},
    {"id":"B","label":"Keep current duties","effects":{"money":290,"morale":1,"health":0,"promotionPoints":2}},
    {"id":"C","label":"Request transfer","effects":{"money":0,"morale":-2,"health":0,"promotionPoints":-1}}
  ]'::jsonb
),
(
  'ID_AD_TRAINING_AUDIT',
  'ID',
  'ID_TNI_AD',
  0,
  6,
  2,
  17,
  'Training Audit',
  'Regional command launches a surprise training compliance audit.',
  '[
    {"id":"A","label":"Lead remediation team","effects":{"money":360,"morale":0,"health":-1,"promotionPoints":4}},
    {"id":"B","label":"Handle own unit only","effects":{"money":220,"morale":1,"health":0,"promotionPoints":2}},
    {"id":"C","label":"Minimal response","effects":{"money":0,"morale":-2,"health":0,"promotionPoints":-1}}
  ]'::jsonb
),
(
  'ID_AL_NAV_AID_MAINT',
  'ID',
  'ID_TNI_AL',
  0,
  6,
  2,
  20,
  'Navigation Aid Maintenance',
  'Offshore navigation aids need urgent maintenance before heavy weather arrives.',
  '[
    {"id":"A","label":"Join offshore repair crew","effects":{"money":410,"morale":0,"health":-2,"promotionPoints":4}},
    {"id":"B","label":"Manage dockside prep","effects":{"money":250,"morale":1,"health":0,"promotionPoints":2}},
    {"id":"C","label":"Delay until next cycle","effects":{"money":0,"morale":-3,"health":0,"promotionPoints":-2}}
  ]'::jsonb
)
ON CONFLICT (code) DO NOTHING;
