import process from "node:process";
import { z } from "zod";
import {
  AgentDockerEngineRuntime,
  resolveAgentDockerEngineSandboxProvider,
} from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntime.js";
import { AgentSandboxWorkerServer } from "../Source/AgentSystem/Sandbox/Worker/AgentSandboxWorkerServer.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import {
  createAgentDockerEngineClient,
  resolveAgentDockerEngineEndpoint,
} from "../Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineEndpoint.js";

const WorkerEnvironmentSchema = z
  .object({
    SENERA_SANDBOX_WORKER_ENDPOINT: z.string().trim().min(1),
    SENERA_SANDBOX_WORKSPACE_KIND: z.enum(["bind", "volume"]),
    SENERA_SANDBOX_WORKSPACE_SOURCE: z.string().trim().min(1),
    SENERA_SANDBOX_WORKSPACE_GUEST_ROOT: z.string().trim().min(1),
    SENERA_SANDBOX_COPY_SOURCE_ROOTS: z.string().transform((value, context) => {
      try {
        return z.array(z.string().trim().min(1)).min(1).parse(JSON.parse(value));
      } catch (error) {
        context.addIssue({ code: "custom", message: `Invalid copy source roots JSON: ${errorMessage(error)}` });
        return z.NEVER;
      }
    }),
    SENERA_DOCKER_ENGINE_ENDPOINT: z.string().trim().min(1).optional(),
    SENERA_DOCKER_GVISOR_RUNTIME: z.string().trim().min(1).optional(),
    SENERA_DOCKER_SANDBOX_PROVIDER: z.enum(["auto", "gvisor", "docker-engine"]).default("auto"),
    SENERA_DOCKER_SANDBOX_IMAGE: z.string().trim().min(1),
    SENERA_DOCKER_SANDBOX_PULL_POLICY: z.enum(["always", "if-missing", "never"]),
    SENERA_SANDBOX_WORKER_ENDPOINT_MODE: z
      .string()
      .regex(/^0[0-7]{3}$/u)
      .optional(),
  })
  .passthrough();

await main();

async function main(): Promise<void> {
  const environment = WorkerEnvironmentSchema.parse(process.env);
  const engineEndpoint = resolveAgentDockerEngineEndpoint({
    configuredEndpoint: environment.SENERA_DOCKER_ENGINE_ENDPOINT,
  });
  const docker = createAgentDockerEngineClient(engineEndpoint);
  const workspace =
    environment.SENERA_SANDBOX_WORKSPACE_KIND === "bind"
      ? {
          kind: "bind" as const,
          sourcePath: environment.SENERA_SANDBOX_WORKSPACE_SOURCE,
          guestRoot: environment.SENERA_SANDBOX_WORKSPACE_GUEST_ROOT,
        }
      : {
          kind: "volume" as const,
          volumeName: environment.SENERA_SANDBOX_WORKSPACE_SOURCE,
          guestRoot: environment.SENERA_SANDBOX_WORKSPACE_GUEST_ROOT,
        };
  const resolution = await resolveAgentDockerEngineSandboxProvider({
    docker,
    preference: environment.SENERA_DOCKER_SANDBOX_PROVIDER,
  });
  const server = new AgentSandboxWorkerServer({
    socketPath: environment.SENERA_SANDBOX_WORKER_ENDPOINT,
    runtime: new AgentDockerEngineRuntime({
      docker,
      workspace,
      copySourceRoots: environment.SENERA_SANDBOX_COPY_SOURCE_ROOTS,
      provider: resolution.provider,
      ...(resolution.provider === "gvisor" && environment.SENERA_DOCKER_GVISOR_RUNTIME
        ? { runtimeName: environment.SENERA_DOCKER_GVISOR_RUNTIME }
        : {}),
      imageReference: environment.SENERA_DOCKER_SANDBOX_IMAGE,
      pullPolicy: environment.SENERA_DOCKER_SANDBOX_PULL_POLICY,
    }),
    socketMode: parseSocketMode(environment.SENERA_SANDBOX_WORKER_ENDPOINT_MODE),
  });
  await server.start();
  process.stdout.write(
    `${JSON.stringify({
      kind: "senera.sandbox.worker.started",
      endpoint: environment.SENERA_SANDBOX_WORKER_ENDPOINT,
      engineEndpoint,
      workspaceKind: workspace.kind,
      sandboxProvider: resolution.provider,
      runtimeImage: environment.SENERA_DOCKER_SANDBOX_IMAGE,
      registeredRuntimes: resolution.registeredRuntimes,
    })}\n`,
  );
  const close = async (): Promise<void> => {
    await server.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

function parseSocketMode(value: string | undefined): number | undefined {
  return value ? Number.parseInt(value, 8) : undefined;
}
