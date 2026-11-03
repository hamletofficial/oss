# Hamlet AI Gateway

The Cloudflare Worker gateway for Hamlet's opt-in AI drafting tools. The website now provides embedded assistants in the deal pipeline and Live Properties pages, plus a structured standalone assistant at `/app/hamlet/ai-assistant.html`.

## Runtime configuration

- Worker: `hamlet-ai-gateway-staging`
- Entry point: `src/index.js`
- Firebase project: `wale-491805`
- Provider: OpenAI Responses API (`https://api.openai.com/v1/responses`)
- Model fallback: `gpt-5.2-chat-latest`; the Cloudflare `AI_MODEL` variable can override it.
- Secret: `OPENAI_API_KEY`, configured in Cloudflare and never committed to this repository.

## Security and data handling

- Requires a Firebase Authentication ID token in `Authorization: Bearer <token>`.
- Verifies token signature, issuer and audience for Firebase project `wale-491805`.
- Allows browser origin `https://www.hamlet-ai.co.uk`.
- Accepts only `deal_copilot` and `listing_assistant` tasks and bounds message/context length and output tokens.
- Sends `store: false` to the Responses API. The gateway does not read or write Firestore, publish listings, create reminders, send messages or alter pipeline stages.
- Provider response bodies and prompts are not logged. Client-facing upstream errors are generic; limited status/response metadata is logged for diagnostics.
- Users should submit only the minimum information they are authorised to share. Output is draft material and must be checked before use.

## Local checks and deployment

From this directory:

```powershell
npm install
npm run check
npx wrangler secret list --name hamlet-ai-gateway-staging
```

Set the API secret in Cloudflare (the value is entered at the prompt; never add it to source control):

```powershell
npx wrangler secret put OPENAI_API_KEY --name hamlet-ai-gateway-staging
```

Preview or deploy only after confirming the target Worker and runtime model:

```powershell
npx wrangler deploy --dry-run
npx wrangler deploy
```

The Worker remains a staging deployment. Do not point production features to a production gateway until the model, access restrictions, rate limits and error handling have been reviewed.

## Request format

```json
{
  "task": "deal_copilot",
  "message": "Summarise the open risks and suggest the next three actions.",
  "context": "Only the deal notes this member is authorised to access."
}
```

The OpenAI API key must remain server-side. Pass only the signed-in user's Firebase ID token from the browser.
