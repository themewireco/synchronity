# Privacy Policy

_Last updated: 2026-06-08_

Synchronity ("we", "us"), operated by Themewire, provides commerce infrastructure that lets AI assistants shop on a buyer's behalf across connected stores. This policy explains what the Synchronity MCP server and gateway collect and how it is used.

## Data we collect

- **Tool requests**: the parameters you (via your AI assistant) send to Synchronity tools — e.g. search queries, product IDs, cart contents, shipping address, and order details.
- **Authentication data**: agent identity tokens and delegated approval tokens used to authorize actions.
- **Operational metadata**: timestamps, store/site identifiers, and request logs used for rate limiting, auditing, and debugging.

We do **not** collect the contents of your AI conversations. The MCP server only sees the specific arguments passed to a tool call.

## How we use it

- To fulfil commerce actions you request (search, cart, checkout, order tracking).
- To route requests to the correct connected store and return normalized results.
- To enforce rate limits, maintain an audit trail, and secure the service.

## Third parties

To complete an action, request data is shared only with:

- **Connected merchant storefronts** (e.g. WooCommerce) — to fulfil the specific action you requested on that store.
- **Payment processors** (e.g. Paystack) — to process payments you authorize.

We do not sell your data, and we do not use it to train AI models.

## Storage & retention

Data is stored on infrastructure operated by Themewire and its hosting providers. Operational logs and audit records are retained only as long as needed for security, debugging, and legal compliance, then deleted.

## Your choices

Sensitive actions (checkout, payment) require explicit buyer approval before they run. You can stop using the connector at any time by removing it from your AI client; doing so ends new data collection.

## Contact

Questions or requests regarding your data: **hello@themewire.co**
