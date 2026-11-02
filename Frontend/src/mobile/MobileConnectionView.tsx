import { type FormEvent } from "react";
import { AppIcon, Button, FormField, FormHint, FormLabel, Input, LogoLockup, SecretInput, Spinner } from "../shared/ui";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { MobileConnection } from "./nativeSession";

export interface MobileConnectionViewProps {
  serverUrl: string;
  deviceName: string;
  loginName: string;
  password: string;
  busy: boolean;
  restoring?: boolean;
  waiting: boolean;
  error: string;
  connections: MobileConnection[];
  onField: (field: "serverUrl" | "deviceName" | "loginName" | "password", value: string) => void;
  onLogin: () => void;
  onScan: () => void;
  onCancel: () => void;
  onConnect: (connection: MobileConnection) => void;
  onForget: (connection: MobileConnection) => void;
  onBackgroundSettings?: () => void;
}

export function MobileConnectionView(props: MobileConnectionViewProps): JSX.Element {
  if (props.restoring) {
    return (
      <main className="mobile-connection-shell flex min-h-dvh items-center justify-center bg-surface-canvas px-6 text-content-primary">
        <div className="flex flex-col items-center gap-6">
          <LogoLockup />
          <div role="status" className="flex items-center gap-3 text-sm text-content-secondary">
            <Spinner size="sm" />
            {frontendMessage("mobile.restoringConnection")}
          </div>
          <Button variant="ghost" onClick={props.onCancel}>
            {frontendMessage("mobile.cancel")}
          </Button>
        </div>
      </main>
    );
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    props.onLogin();
  };
  return (
    <main className="mobile-connection-shell min-h-dvh bg-surface-canvas px-6 text-content-primary">
      <div className="mx-auto w-full max-w-sm py-10">
        <LogoLockup className="mb-9 justify-start" />
        <h1 className="text-2xl font-semibold tracking-tight">{frontendMessage("mobile.title")}</h1>
        <p className="mb-8 mt-2 text-sm leading-6 text-content-secondary">{frontendMessage("mobile.description")}</p>
        <Button
          className="h-11 w-full"
          disabled={props.busy || !props.deviceName.trim()}
          loading={props.busy && !props.waiting}
          onClick={props.onScan}
        >
          <AppIcon icon="camera" size={18} />
          {frontendMessage("mobile.scanLogin")}
        </Button>
        <p className="mb-6 mt-3 text-xs leading-5 text-content-muted">{frontendMessage("mobile.scanDescription")}</p>
        <details className="border-t border-line-subtle pt-4">
          <summary className="cursor-pointer text-sm text-content-secondary">
            {frontendMessage("mobile.usePassword")}
          </summary>
          <form onSubmit={submit} className="mt-5 space-y-5">
            <FormField>
              <FormLabel>{frontendMessage("mobile.serverAddress")}</FormLabel>
              <Input
                id="mobile-server"
                aria-label={frontendMessage("mobile.serverAddress")}
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                value={props.serverUrl}
                onChange={(event) => props.onField("serverUrl", event.target.value)}
                placeholder="https://"
                disabled={props.busy}
              />
              <FormHint>{frontendMessage("mobile.serverAddressHint")}</FormHint>
            </FormField>
            <FormField>
              <FormLabel>{frontendMessage("mobile.deviceName")}</FormLabel>
              <Input
                id="mobile-device"
                aria-label={frontendMessage("mobile.deviceName")}
                value={props.deviceName}
                onChange={(event) => props.onField("deviceName", event.target.value)}
                maxLength={80}
                disabled={props.busy}
                required
              />
            </FormField>
            <FormField>
              <FormLabel>{frontendMessage("auth.loginName")}</FormLabel>
              <Input
                id="mobile-account"
                aria-label={frontendMessage("auth.loginName")}
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={props.loginName}
                onChange={(event) => props.onField("loginName", event.target.value)}
                disabled={props.busy}
                required
              />
            </FormField>
            <FormField>
              <FormLabel>{frontendMessage("auth.password")}</FormLabel>
              <SecretInput
                size="md"
                name="password"
                autoComplete="current-password"
                value={props.password}
                onChange={(value) => props.onField("password", value)}
                ariaLabel={frontendMessage("auth.password")}
                disabled={props.busy}
                required
              />
            </FormField>
            <Button type="submit" className="h-11 w-full" loading={props.busy && !props.waiting} disabled={props.busy}>
              {frontendMessage("mobile.passwordLogin")}
            </Button>
          </form>
        </details>
        {props.waiting ? (
          <div role="status" className="mt-4 flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm">
            <Spinner size="xs" />
            <span className="flex-1">{frontendMessage("mobile.waitingApproval")}</span>
            <Button variant="ghost" onClick={props.onCancel}>
              {frontendMessage("mobile.cancel")}
            </Button>
          </div>
        ) : props.busy ? (
          <Button variant="ghost" className="mt-3 w-full" onClick={props.onCancel}>
            {frontendMessage("mobile.cancel")}
          </Button>
        ) : null}
        {props.error ? (
          <p role="alert" className="mt-4 text-sm leading-6 text-brick-600">
            {props.error}
          </p>
        ) : null}
        {props.connections.length ? (
          <section className="mt-10">
            <h2 className="mb-2 text-xs font-medium text-content-muted">{frontendMessage("mobile.savedComputers")}</h2>
            {props.connections.map((connection) => (
              <div key={connection.serverUrl} className="flex items-center gap-2 border-b border-line-subtle py-2">
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onConnect(connection)}
                  className="min-h-12 min-w-0 flex-1 rounded-lg px-2 text-left hover:bg-surface-hover"
                >
                  <span className="block truncate text-sm font-medium">{connection.name}</span>
                  <span className="block truncate text-xs text-content-muted">{connection.serverUrl}</span>
                </button>
                <Button variant="ghost" disabled={props.busy} onClick={() => props.onForget(connection)}>
                  {frontendMessage("mobile.forget")}
                </Button>
              </div>
            ))}
          </section>
        ) : null}
        {props.onBackgroundSettings ? (
          <Button variant="ghost" className="mt-8" onClick={props.onBackgroundSettings}>
            <AppIcon icon="settings" size={16} />
            {frontendMessage("mobile.backgroundSettings")}
          </Button>
        ) : null}
      </div>
    </main>
  );
}
