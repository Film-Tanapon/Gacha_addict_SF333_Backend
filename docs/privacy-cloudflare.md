# Public contact pages behind Cloudflare

`/privacy` and `/account-deletion` send `Cache-Control: no-store, no-transform`.
Visible contact links and the deletion request button are also wrapped in
`<!--email_off-->...<!--/email_off-->`. These are documented Cloudflare opt-outs
from Email Address Obfuscation, so the pages do not need a decode script to expose
their contact email or restore their `mailto:` links.

The existing Content-Security-Policy stays unchanged. No scripts, JavaScript
permissions or Cloudflare dashboard changes are added. Other backend/admin/API
routes do not receive this page-specific cache policy.

Cloudflare documentation:
https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/

Deploy the backend before checking the public URLs. On the server, after updating
the code, rebuild/restart the API using the normal deployment procedure, e.g.
`docker compose up -d --build api`. This code change needs no migration or new env.

After deployment, check both public URLs through Cloudflare:

- HTTP 200, `Cache-Control` contains both `no-store` and `no-transform`.
- The contact email displays as the configured support address, not an email
  protection placeholder.
- Contact links and the deletion button have `mailto:` URLs pointing to support.
  The deletion button retains the Thai subject and request template.
- The CSP is unchanged; the pages work without JavaScript or an app login.

The HTTP regression test checks these origin response contracts and the email
request target. Actual edge behavior still needs verification after deployment;
local tests do not send email or change the production Cloudflare configuration.
