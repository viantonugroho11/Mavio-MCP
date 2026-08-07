import nextra from 'nextra'

const withNextra = nextra({
  latex: false,
  defaultShowCopyCode: true,
  search: { codeblocks: false }
})

export default withNextra({
  reactStrictMode: true,
  // Docs site is fully static; safe to export if you prefer `next export`.
  images: { unoptimized: true }
})
