import type { ProviderStreams } from "@earendil-works/pi-ai";
import {
  stream as streamAnthropic,
  streamSimple as streamSimpleAnthropic,
} from "@earendil-works/pi-ai/api/anthropic-messages";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import {
  stream as streamOpenAiCompletions,
  streamSimple as streamSimpleOpenAiCompletions,
} from "@earendil-works/pi-ai/api/openai-completions";
import {
  stream as streamOpenAiResponses,
  streamSimple as streamSimpleOpenAiResponses,
} from "@earendil-works/pi-ai/api/openai-responses";
import type { AgentNativeToolApi } from "./AgentModelEndpointContract.js";

/** Vendor protocol adapters shared by native tools and BAML planning. */
export type AgentNativeToolApiStreams = Readonly<Record<AgentNativeToolApi, ProviderStreams>>;

// The google SDK drags in google-auth-library/gaxios (~2MB retained source);
// the lazy variant defers that cost until a google endpoint actually streams.
const googleGenerativeAiStreams = googleGenerativeAIApi();

export const AgentNativeToolApiStreams: AgentNativeToolApiStreams = {
  "openai-responses": { stream: streamOpenAiResponses, streamSimple: streamSimpleOpenAiResponses },
  "openai-completions": { stream: streamOpenAiCompletions, streamSimple: streamSimpleOpenAiCompletions },
  "anthropic-messages": { stream: streamAnthropic, streamSimple: streamSimpleAnthropic },
  "google-generative-ai": {
    stream: googleGenerativeAiStreams.stream,
    streamSimple: googleGenerativeAiStreams.streamSimple,
  },
};
