export interface AzureFoundryOptions {
  /**
   * The endpoint URL copied from the Azure AI Foundry portal ("Target URI").
   * Example: https://my-resource.services.ai.azure.com/models
   * The Anthropic SDK appends /v1/messages to this base URL.
   */
  endpoint: string
  /**
   * The Azure AI API key ("Project API Key") from the Foundry portal.
   * Azure requires this as an `api-key` header, not `x-api-key`.
   */
  apiKey: string
}

export interface AzureFoundryClientConfig {
  baseURL: string
  apiKey: string
  defaultHeaders: { 'api-key': string }
}

/**
 * Returns the Anthropic SDK constructor config for an Azure AI Foundry endpoint.
 *
 * Azure AI Foundry expects an `api-key` header, but the Anthropic SDK sends
 * `x-api-key` by default — causing a 401. This function returns a config object
 * that overrides the header correctly.
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk'
 * import { buildAzureFoundryClientConfig } from '@conducco/titw'
 *
 * const client = new Anthropic(buildAzureFoundryClientConfig({
 *   endpoint: process.env.AZURE_AI_ENDPOINT!,
 *   apiKey:   process.env.AZURE_AI_API_KEY!,
 * }))
 * ```
 */
export function buildAzureFoundryClientConfig(
  options: AzureFoundryOptions,
): AzureFoundryClientConfig {
  const baseURL = options.endpoint.replace(/\/+$/, '')
  return {
    baseURL,
    apiKey: options.apiKey,   // SDK requires a non-empty value; Azure ignores it (api-key header takes precedence)
    defaultHeaders: { 'api-key': options.apiKey },
  }
}
