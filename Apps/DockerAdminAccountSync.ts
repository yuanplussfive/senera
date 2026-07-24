import {
  AgentLocalAdminAccountStore,
  type AgentLocalAdminAccountSynchronization,
} from "../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";

export const DockerAdminAccountEnvironment = {
  LoginName: "SENERA_ADMIN_LOGIN_NAME",
  DisplayName: "SENERA_ADMIN_DISPLAY_NAME",
  Password: "SENERA_ADMIN_PASSWORD",
} as const;

export interface DockerAdminAccountSyncOptions {
  accountFile: string;
  environment?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

/** Synchronizes the persisted administrator with the Compose declaration. */
export async function synchronizeDockerAdminAccount(
  options: DockerAdminAccountSyncOptions,
): Promise<AgentLocalAdminAccountSynchronization> {
  const environment = options.environment ?? process.env;
  const result = await new AgentLocalAdminAccountStore(options.accountFile).synchronize({
    loginName: requireEnvironmentValue(environment, DockerAdminAccountEnvironment.LoginName),
    displayName: requireEnvironmentValue(environment, DockerAdminAccountEnvironment.DisplayName),
    password: requireEnvironmentValue(environment, DockerAdminAccountEnvironment.Password),
  });
  options.log?.(`Administrator account ${result.kind}: ${result.account.loginName}`);
  return result;
}

function requireEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Docker administrator synchronization requires ${name}.`);
  }
  return value;
}
