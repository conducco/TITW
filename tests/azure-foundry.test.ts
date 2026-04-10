import { describe, it, expect } from 'vitest'
import { buildAzureFoundryClientConfig } from '../src/providers/azureFoundry.js'

describe('buildAzureFoundryClientConfig', () => {
  it('returns baseURL equal to the provided endpoint', () => {
    const config = buildAzureFoundryClientConfig({
      endpoint: 'https://my-resource.services.ai.azure.com/models',
      apiKey: 'test-key',
    })
    expect(config.baseURL).toBe('https://my-resource.services.ai.azure.com/models')
  })

  it('strips a trailing slash from endpoint', () => {
    const config = buildAzureFoundryClientConfig({
      endpoint: 'https://my-resource.services.ai.azure.com/models/',
      apiKey: 'test-key',
    })
    expect(config.baseURL).toBe('https://my-resource.services.ai.azure.com/models')
  })

  it('sets api-key header to the provided apiKey', () => {
    const config = buildAzureFoundryClientConfig({
      endpoint: 'https://my-resource.services.ai.azure.com/models',
      apiKey: 'azure-key-abc',
    })
    expect(config.defaultHeaders['api-key']).toBe('azure-key-abc')
  })

  it('sets apiKey field to the provided apiKey', () => {
    const config = buildAzureFoundryClientConfig({
      endpoint: 'https://my-resource.services.ai.azure.com/models',
      apiKey: 'azure-key-abc',
    })
    expect(config.apiKey).toBe('azure-key-abc')
  })

  it('returns a plain object with exactly three fields', () => {
    const config = buildAzureFoundryClientConfig({
      endpoint: 'https://my-resource.services.ai.azure.com/models',
      apiKey: 'k',
    })
    const keys = Object.keys(config).sort()
    expect(keys).toEqual(['apiKey', 'baseURL', 'defaultHeaders'])
  })
})
