// Shim: the warehouse entity types are the SELF-CONTAINED source of truth inside
// @intra/data-kit (spec §12 step 2). Re-export them so ported source files that
// import `@/domain/types` keep resolving without a second copy.
export * from '@intra/data-kit';
