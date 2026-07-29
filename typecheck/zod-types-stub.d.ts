// Stand-in for zod's type declarations during `yarn typecheck` only.
//
// zod 4 ships .d.cts files using TypeScript 5 syntax (const type parameters)
// that the repo's TypeScript 4.7 cannot even parse. Nothing in src/ imports
// zod - it enters the program only through the `ai` package's declaration
// files - but the parse errors make `tsc --noEmit` skip semantic checking of
// the ENTIRE program, silently reporting zero src errors on any input. The
// typecheck tsconfig maps every zod specifier here instead; the `ai` .d.ts
// files that reference zod are themselves skipLibCheck'd, so an `any` stub is
// sufficient and src stays fully checked. The rollup build keeps the real
// resolution (rollup-plugin-typescript2 checks per-file and is not affected).
declare const zodTypesStub: any;
export = zodTypesStub;
