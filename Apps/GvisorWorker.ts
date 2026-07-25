import process from "node:process";
import Docker from "dockerode";
import { z } from "zod";
import {
  AgentGvisorDockerEngineRuntime,
  resolveAgentDockerEngineSandboxProvider,
} from "../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorDockerRuntime.js";
import { AgentGvisorWorkerServer } from "../Source/AgentSystem/Sandbox/Gvisor/AgentGvisorWorkerServer.js";

const WorkerEnvironmentSchema = z
  .object({
    SENERA_GVISOR_WORKER_SOCKET: z.string().trim().min(1),
    SENERA_GVISOR_WORKSPACE_KIND: z.enum(["bind", "volume"]),
    SENERA_GVISOR_WORKSPACE_SOURCE: z.string().trim().min(1),
    SENERA_GVISOR_COPY_SOURCE_ROOTS: z.string().transform((value, context) => {
      try {
        return z.array(z.string().trim().min(1)).min(1).parse(JSON.parse(value));
      } catch (error) {
        context.addIssue({ code: "custom", message: `Invalid copy source roots JSON: ${errorMessage(error)}` });
        return z.NEVER;
      }
    }),
    SENERA_DOCKER_ENGINE_SOCKET: z.string().trim().min(1).optional(),
    SENERA_GVISOR_RUNTIME_NAME: z.string().trim().min(1).optional(),
    SENERA_DOCKER_SANDBOX_PROVIDER: z.enum(["auto", "gvisor", "docker-engine"]).default("auto"),
    SENERA_DOCKER_SANDBOX_IMAGE: z.string().trim().min(1),
    SENERA_GVISOR_WORKER_SOCKET_MODE: z
      .string()
      .regex(/^0[0-7]{3}$/u)
      .optional(),
  })
  .passthrough();

await main();

async function main(): Promise<void> {
  const environment = WorkerEnvironmentSchema.parse(process.env);
  const docker = environment.SENERA_DOCKER_ENGINE_SOCKET
    ? new Docker({ socketPath: environment.SENERA_DOCKER_ENGINE_SOCKET })
    : new Docker();
  const workspace =
    environment.SENERA_GVISOR_WORKSPACE_KIND === "bind"
      ? { kind: "bind" as const, sourcePath: environment.SENERA_GVISOR_WORKSPACE_SOURCE }
      : { kind: "volume" as const, volumeName: environment.SENERA_GVISOR_WORKSPACE_SOURCE };
  const resolution = await resolveAgentDockerEngineSandboxProvider({
    docker,
    preference: environment.SENERA_DOCKER_SANDBOX_PROVIDER,
  });
  const server = new AgentGvisorWorkerServer({
    socketPath: environment.SENERA_GVISOR_WORKER_SOCKET,
    runtime: new AgentGvisorDockerEngineRuntime({
      docker,
      workspace,
      copySourceRoots: environment.SENERA_GVISOR_COPY_SOURCE_ROOTS,
      provider: resolution.provider,
      ...(resolution.provider === "gvisor" && environment.SENERA_GVISOR_RUNTIME_NAME
        ? { runtimeName: environment.SENERA_GVISOR_RUNTIME_NAME }
        : {}),
      imageReference: environment.SENERA_DOCKER_SANDBOX_IMAGE,
    }),
    socketMode: parseSocketMode(environment.SENERA_GVISOR_WORKER_SOCKET_MODE),
  });
  await server.start();
  process.stdout.write(
    `${JSON.stringify({
      kind: "senera.gvisor.worker.started",
      socketPath: environment.SENERA_GVISOR_WORKER_SOCKET,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
