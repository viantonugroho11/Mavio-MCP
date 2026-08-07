import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs'

const themeComponents = getThemeComponents()

// Nextra 4 requires a root-level `useMDXComponents` export. Merge the docs
// theme's components with any page-level overrides.
export function useMDXComponents(components) {
  return {
    ...themeComponents,
    ...components
  }
}
