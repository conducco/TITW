# Using Azure AI Foundry as an LLM Provider

Azure AI Foundry (the 2025/2026 evolution of Azure AI Studio) lets you deploy Anthropic Claude models as serverless APIs — pay-per-token with no GPU VMs to manage. This guide shows how to configure a titw runner to use one.

Because titw never calls LLMs directly, the entire integration lives in your `AgentRunner`. The framework, team config, and orchestration are unchanged.

---

## Step 1 — Deploy a Claude model in Azure AI Foundry

1. Go to [portal.azure.ai](https://portal.azure.ai) and open your project.
2. Navigate to **Model Catalog** in the left menu.
3. Search for **Anthropic** or **Claude**. Select your model (Claude 3.5 Sonnet is a good default — check the catalog for the latest available versions in your region).
4. Click **Deploy** → choose **Serverless API** (also labeled "Global Standard" for Claude models).
5. Set a **Deployment Name** — this name becomes the model ID in your API calls (e.g. `my-claude-sonnet`).
6. Click **Deploy** and wait a few seconds.

---

## Step 2 — Copy your credentials

Once the deployment is active:

1. Open the deployment's **Details** tab.
2. Copy the **Target URI** — looks like `https://[resource].services.ai.azure.com/models`.
3. Copy the **API Key** (Project API Key).

Set these as environment variables:

```bash
AZURE_AI_ENDPOINT=https://my-resource.services.ai.azure.com/models
AZURE_AI_API_KEY=your-azure-api-key
```

> **Do not use your Anthropic API key here.** Azure uses its own key separate from Anthropic's.

---

## Step 3 — Configure the runner

### Why `buildAzureFoundryClientConfig` is needed

The Anthropic SDK sends `x-api-key: <key>` for authentication. Azure AI Foundry expects `api-key: <key>`. Without the override, every request returns 401. `buildAzureFoundryClientConfig` handles this automatically.

### Update `src/runner.ts`

Replace the Anthropic client instantiation:

```ts
// Before (native Anthropic)
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()

// After (Azure AI Foundry)
import Anthropic from '@anthropic-ai/sdk'
import { buildAzureFoundryClientConfig } from '@conducco/titw'

const client = new Anthropic(buildAzureFoundryClientConfig({
  endpoint: process.env.AZURE_AI_ENDPOINT!,
  apiKey:   process.env.AZURE_AI_API_KEY!,
}))
```

Everything else in the runner — `TOOLS`, the message loop, tool dispatch, retry logic — is **unchanged**.

---

## Step 4 — Set the model in TeamConfig

In your `src/team.ts`, set `defaultModel` (or per-agent `model`) to the **Deployment Name** you chose in Step 1:

```ts
export const team: TeamConfig = {
  name: 'research-team',
  leadAgentName: 'lead',
  defaultModel: 'my-claude-sonnet',   // ← your Foundry deployment name, not the model identifier
  members: [...]
}
```

The deployment name is passed through `params.model` to your `client.messages.create({ model: params.model, ... })` call unchanged.

---

## Step 5 — Run

```bash
AZURE_AI_ENDPOINT=https://... AZURE_AI_API_KEY=... npx tsx src/main.ts
```

---

## Environment variables reference

| Variable | Value |
|----------|-------|
| `AZURE_AI_ENDPOINT` | Target URI from Foundry portal (no trailing slash needed) |
| `AZURE_AI_API_KEY` | Project API Key from Foundry portal |

---

## Common issues

**401 Unauthorized**
The SDK is sending the wrong auth header. Confirm you are using `buildAzureFoundryClientConfig` and not constructing `new Anthropic()` directly. The `api-key` header must be set.

**404 Not Found**
The `baseURL` doesn't match Azure's expected path. Copy the Target URI exactly from the portal. Do not append `/messages` or `/v1` manually — the SDK handles path construction.

**Model not found / deployment not found**
`params.model` (from `TeamConfig.defaultModel`) must exactly match your **Deployment Name** in Foundry — not the underlying model identifier (e.g. `my-claude-sonnet`, not `claude-3-5-sonnet-20241022`).

**Model not available in catalog**
Not all Claude versions are listed in every Azure region. Check the current catalog in your Foundry project. Claude 3.5 Sonnet is broadly available; newer models may have limited regional availability.

---

## Using with Azure Container Apps deployment

If you are deploying titw to Azure Container Apps (see `docs/deployment-azure-container-apps.md`), store both environment variables in Key Vault and inject them into the Container Apps Job as secrets — same pattern as `ANTHROPIC_API_KEY` in that guide.
