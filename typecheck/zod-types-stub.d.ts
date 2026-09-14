// Stand-in for zod's type declarations during `yarn typecheck` only.
//
// NOTE: now redundant. The repo moved to TypeScript 5.9 (required by
// @tanstack/react-table v9, which ships the same syntax), and `tsc` against
// the real zod declarations is clean. The mapping is kept only so the guard
// below stays documented; it can be deleted along with the `paths` entry in
// tsconfig.typecheck.json.
//
// zod 4 ships .d.cts files using TypeScript 5 syntax (const type parameters)
// that TypeScript 4.7 could not even parse. Nothing in src/ imports
// zod - it enters the program only through the `ai` package's declaration
// files - but the parse errors make `tsc --noEmit` skip semantic checking of
// the ENTIRE program, silently reporting zero src errors on any input. The
// typecheck tsconfig maps every zod specifier here instead; the `ai` .d.ts
// files that reference zod are themselves skipLibCheck'd, so an `any` stub is
// sufficient and src stays fully checked. The rollup build keeps the real
// resolution (rollup-plugin-typescript2 checks per-file and is not affected).
declare const zodTypesStub: any;
export = zodTypesStub;
