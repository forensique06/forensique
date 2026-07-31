import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Card, CardContent } from '@/components/ui/card'
import { Mail, MessageSquare, Bug } from 'lucide-react'

export const metadata = { title: 'Contact — Forensique' }

export default function ContactPage() {
  return (<><SiteHeader/>
    <main className="container mx-auto px-4 py-12 max-w-2xl">
      <h1 className="text-4xl font-bold">Contact</h1>
      <p className="text-muted-foreground mt-2">We read every email. Response within 2 business days.</p>

      <div className="grid gap-4 mt-8">
        <Card><CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-primary mt-0.5"/>
            <div>
              <div className="font-semibold">General &amp; billing</div>
              <div className="text-sm text-muted-foreground mt-0.5"><a href="mailto:support@forensique.in" className="underline">support@forensique.in</a></div>
              <p className="text-xs text-muted-foreground mt-1">Refund requests, subscription issues, general questions.</p>
            </div>
          </div>
        </CardContent></Card>

        <Card><CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Bug className="h-5 w-5 text-primary mt-0.5"/>
            <div>
              <div className="font-semibold">Question error / answer-key dispute</div>
              <div className="text-sm text-muted-foreground mt-0.5"><a href="mailto:content@forensique.in" className="underline">content@forensique.in</a></div>
              <p className="text-xs text-muted-foreground mt-1">Include the question code (visible above the question text on the review screen).</p>
            </div>
          </div>
        </CardContent></Card>

        <Card><CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <MessageSquare className="h-5 w-5 text-primary mt-0.5"/>
            <div>
              <div className="font-semibold">Privacy / data requests</div>
              <div className="text-sm text-muted-foreground mt-0.5"><a href="mailto:privacy@forensique.in" className="underline">privacy@forensique.in</a></div>
              <p className="text-xs text-muted-foreground mt-1">Data export, account deletion, other privacy rights covered in our Privacy Policy.</p>
            </div>
          </div>
        </CardContent></Card>
      </div>
    </main><SiteFooter/></>)
}
