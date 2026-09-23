/**
 * Host-owned publication boundary for bytes that must become a durable
 * Senera resource before they are shown to a model, frontend, or channel.
 *
 * Producers deliberately do not choose the resource URI. The publisher owns
 * identity, storage, integrity metadata, and retention policy.
 */
export interface AgentResourcePublishInput {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mime: string;
  readonly signal?: AbortSignal;
}

export interface AgentResourcePublishBase64Input {
  readonly base64: string;
  readonly name: string;
  readonly mime: string;
  readonly signal?: AbortSignal;
}

export interface AgentPublishedResource {
  readonly resourceUri: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly sha256?: string;
}

export interface AgentResourcePublisher {
  publishBytes(input: AgentResourcePublishInput): Promise<AgentPublishedResource>;
  /** Optional streaming path for provider payloads that are already Base64 encoded. */
  publishBase64?(input: AgentResourcePublishBase64Input): Promise<AgentPublishedResource>;
}
