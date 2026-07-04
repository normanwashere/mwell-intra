// Shim → @intra/ui: the design-system primitives were extracted to the shared
// package (Step 1a). Ported source files that import `@/components/ui` keep
// resolving here. @intra/ui is a superset (it also exports Icon/Button/Input).
export * from '@intra/ui';
