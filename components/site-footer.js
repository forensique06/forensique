import Link from 'next/link'

export default function SiteFooter() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="container mx-auto px-4 py-10 grid gap-8 md:grid-cols-4 text-sm">
        <div>
          <div className="flex items-center">
            <img
              src="/brand/logos.png"
              alt="Forensique"
              className="h-11 w-auto max-w-[150px] object-contain"
            />
          </div>

          <p className="text-muted-foreground mt-2 text-xs">
            The CBT platform built only for UGC NET/JRF Forensic Science Paper II aspirants.
          </p>
        </div>

        <FooterColumn
          title="Product"
          links={[
            { href: '/pricing', label: 'Pricing' },
            { href: '/notes', label: 'Notes' },
            { href: '/custom-test', label: 'Custom test builder' },
            { href: '/analytics', label: 'Analytics' },
          ]}
        />

        <FooterColumn
          title="Company"
          links={[
            { href: '/about', label: 'About' },
            { href: '/faq', label: 'FAQ' },
            { href: '/contact', label: 'Contact' },
          ]}
        />

        <FooterColumn
          title="Legal"
          links={[
            { href: '/terms', label: 'Terms of Service' },
            { href: '/privacy', label: 'Privacy Policy' },
            { href: '/refund', label: 'Refund & Cancellation' },
          ]}
        />
      </div>

      <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Forensique. All rights reserved.
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }) {
  return (
    <div>
      <div className="font-semibold text-xs uppercase text-muted-foreground mb-2">
        {title}
      </div>

      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="hover:text-foreground text-muted-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}