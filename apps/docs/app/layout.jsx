import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Banner, Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  title: {
    default: 'Mavio-MCP',
    template: '%s – Mavio-MCP'
  },
  description:
    'Mavio-MCP — the all-in-one developer toolkit for the Model Context Protocol. Import OpenAPI, SQL, GraphQL, and MCP servers and republish them as one authenticated MCP endpoint.',
  applicationName: 'Mavio-MCP Docs',
  metadataBase: new URL('https://mavio-docs.vercel.app')
}

const banner = (
  <Banner storageKey="mavio-1-2-0">
    Mavio-MCP v1.2.0 — per-principal upstream OAuth vault + Vault Transit KEK is out.
  </Banner>
)

const navbar = (
  <Navbar
    logo={<b>Mavio-MCP</b>}
    projectLink="https://github.com/viantonugroho11/Mavio-MCP"
  />
)

const footer = (
  <Footer>
    Apache 2.0 © {new Date().getFullYear()} Mavio-MCP · Only MCP.
  </Footer>
)

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head color={{ hue: 265, saturation: 90 }} />
      <body>
        <Layout
          banner={banner}
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/viantonugroho11/Mavio-MCP/tree/main/apps/docs"
          sidebar={{ defaultMenuCollapseLevel: 1, toggleButton: true }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
