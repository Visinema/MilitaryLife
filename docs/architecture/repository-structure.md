# Repository Structure Reorganization Plan (Applied)

## Goals
- Separate domain/business logic from framework/runtime concerns.
- Group related code by feature/domain for maintainability.
- Keep naming conventions consistent (`kebab-case` files, `PascalCase` React components, `camelCase` symbols).
- Improve discoverability for new contributors.

## Before (high-level)
```text
apps/
  api/
    src/
      modules/
      plugins/
      utils/
      db/
  web/
    app/
    components/
    lib/
    store/
packages/
  shared/
```

## After (high-level)
```text
apps/
  api/
    src/
      modules/
      plugins/
      utils/
      db/
  web/
    app/
    features/
      dashboard/
        components/
        store/
      game/
        lib/
        store/
    components/         # shared/presentational + compatibility exports
    lib/                # shared infra + compatibility exports
    store/              # compatibility exports
packages/
  shared/

docs/
  architecture/
    repository-structure.md
```

## Major changes and justification
1. **Dashboard domain extraction**
   - Moved dashboard-specific UI and interaction logic from global `components/` into `features/dashboard/components/`.
   - Why: keeps route-specific complexity isolated and easier to navigate.

2. **Game domain extraction**
   - Moved game state store and game-specific computation utilities into `features/game/{store,lib}/`.
   - Why: business logic (time conversion, assignment resolution, world synthesis) now lives near game domain state.

3. **Compatibility layer retained**
   - Kept thin re-export files in legacy paths (`components/`, `lib/`, `store/`) to avoid wide-breaking import churn.
   - Why: safe migration path and reduced refactor risk; teams can incrementally adopt feature-based imports.

4. **Naming standardization**
   - Enforced `kebab-case` file naming in moved files and domain directories.
   - Maintained `PascalCase` for React components and `camelCase` for functions/variables.

5. **Discoverability enhancement**
   - Added this architecture document with before/after trees and rationale.
   - Why: new contributors can immediately understand module boundaries and migration intent.

## Migration guidance
- New dashboard code should be added under `apps/web/features/dashboard/*`.
- New game simulation/state logic should be added under `apps/web/features/game/*`.
- Shared, cross-feature components remain in `apps/web/components/*`.
- Legacy imports can continue to work temporarily via compatibility exports, but prefer feature paths for new code.
