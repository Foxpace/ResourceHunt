# Resource Hunt

Resource Hunt is a TypeScript simulator where bots compete on seeded grid maps. They collect, steal, and bank resources while contesting depots and navigating hazards. The highest banked score wins. Browser matches and headless benchmarks use the same engine.

## Coding standards

- Use names that explain the action or value. Reuse helpers for repeated behavior and keep public interfaces stable.
- Limit functions to 30 lines, including declarations and blank lines, and three parameters. These limits include callbacks and constructors. Group related inputs into named types. The parameter limit also applies to function types and interfaces.
- Keep control-flow nesting to two levels, including at module scope. An `else if` stays at the same level.
- Keep `if` conditions on one line. Use at most three descriptive local booleans in compound `if` conditions, ternaries, and collection predicates. Keep simple guards direct.
- Use blank lines to separate steps. Keep boolean definitions close to where they are used.
- Keep each test to 20 lines, including comments and blank lines. Test one behavior per case using `// Given`, `// When`, and `// Then`. Use shared fixtures and assertion helpers where they clarify the test.

Run `yarn structure:check` for the structure rules or `yarn run check` for formatting, structure, types, and tests.
