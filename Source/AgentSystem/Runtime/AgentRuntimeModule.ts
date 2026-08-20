import type { AgentRuntimeServices } from "./AgentRuntimeServices.js";

export type AgentRuntimeServiceName = keyof AgentRuntimeServices;

export interface AgentRuntimeModuleContext {
  services: AgentRuntimeServices;
}

export interface AgentRuntimeServiceContribution<
  ServiceName extends AgentRuntimeServiceName = AgentRuntimeServiceName,
> {
  service: ServiceName;
  create(context: AgentRuntimeModuleContext): AgentRuntimeServices[ServiceName];
}

export interface AgentRuntimeModule {
  id: string;
  services?(context: AgentRuntimeModuleContext): readonly AgentRuntimeServiceContribution[];
}

export class AgentRuntimeModuleComposer {
  compose(baseServices: AgentRuntimeServices, modules: readonly AgentRuntimeModule[]): AgentRuntimeServices {
    const services: AgentRuntimeServices = { ...baseServices };

    for (const runtimeModule of modules) {
      for (const contribution of runtimeModule.services?.(createModuleContext(services)) ?? []) {
        assignServiceContribution(services, contribution);
      }
    }

    return services;
  }
}

function assignServiceContribution<ServiceName extends AgentRuntimeServiceName>(
  services: AgentRuntimeServices,
  contribution: AgentRuntimeServiceContribution<ServiceName>,
): void {
  services[contribution.service] = contribution.create(createModuleContext(services));
}

function createModuleContext(services: AgentRuntimeServices): AgentRuntimeModuleContext {
  return {
    services: { ...services },
  };
}
