import * as vscode from "vscode";

let statusItem: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval> | undefined;
let extensionContext: vscode.ExtensionContext;

type ClaudeCodeEnvironmentVariables = Array<{
  name: string;
  value: string;
}>;

type DeepSeekBalanceResponse = {
  is_available: boolean;
  balance_infos: Array<{
    currency: string;
    total_balance: string;
    granted_balance: string;
    topped_up_balance: string;
  }>;
};

type ApiKeySource = "claudeConfig" | "config" | "secretKey";

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  statusItem = vscode.window.createStatusBarItem(
    "deepseekBalance.statusItem",
    vscode.StatusBarAlignment.Right,
    100
  );
  statusItem.name = "DeepSeek Balance";

  statusItem.command = "deepseekBalance.refresh";
  statusItem.text = "$(credit-card)";
  statusItem.tooltip = "DeepSeek balance";
  statusItem.show();

  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseekBalance.refresh", async () => {
      await refreshBalance();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-balance.refresh", async () => {
      await refreshBalance();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-balance.setApiKey", async () => {
      await runApiKeySetupWizard();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-balance.openSettings", async () => {
      const source = getApiKeySource();
      const query = source === "claudeConfig"
        ? "claudeConfig.environmentVariables"
        : "deepseekBalance.apiKeySource";

      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        query
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("claudeCode.environmentVariables") ||
        event.affectsConfiguration("deepseekBalance.apiKeySource") ||
        event.affectsConfiguration("deepseekBalance.apiKey") ||
        event.affectsConfiguration("deepseekBalance.refreshIntervalMinutes") ||
        event.affectsConfiguration("deepseekBalance.lowBalanceThreshold")
      ) {
        setupTimer();
        void refreshBalance();
      }
    })
  );

  setupTimer();
  void refreshBalance();
}

function getClaudeCodeEnv(): ClaudeCodeEnvironmentVariables {
  return (
    vscode.workspace
      .getConfiguration("claudeCode")
      .get<ClaudeCodeEnvironmentVariables>("environmentVariables") ?? []
  );
}

function getApiKeySource(): ApiKeySource {
  const source = vscode.workspace
    .getConfiguration("deepseekBalance")
    .get<string>("apiKeySource", "claudeConfig");

  if (source === "config" || source === "secretKey") {
    return source;
  }

  return "claudeConfig";
}

function getDeepSeekApiKeyFromClaudeConfig(): string | undefined {
  const envs = getClaudeCodeEnv();

  const baseUrl = envs.find((env) => env.name === "ANTHROPIC_BASE_URL")?.value;
  const token = envs.find((env) => env.name === "ANTHROPIC_AUTH_TOKEN")?.value;

  if (!token) return undefined;

  const looksLikeDeepSeek =
    baseUrl?.includes("api.deepseek.com") ||
    baseUrl?.includes("deepseek") ||
    token.startsWith("sk-");

  return looksLikeDeepSeek ? token : undefined;
}

function getDeepSeekApiKeyFromConfig(): string | undefined {
  const key = vscode.workspace
    .getConfiguration("deepseekBalance")
    .get<string>("apiKey", "")
    .trim();

  return key || undefined;
}

async function getDeepSeekApiKeyFromSecretKey(): Promise<string | undefined> {
  const key = (await extensionContext.secrets.get("SECRET_KEY"))?.trim();
  return key || undefined;
}

async function getDeepSeekApiKey(): Promise<string | undefined> {
  const source = getApiKeySource();

  if (source === "config") {
    return getDeepSeekApiKeyFromConfig();
  }

  if (source === "secretKey") {
    return getDeepSeekApiKeyFromSecretKey();
  }

  return getDeepSeekApiKeyFromClaudeConfig();
}

function getNoKeyTooltip(): string {
  const source = getApiKeySource();

  if (source === "config") {
    return "No DeepSeek API key found.\n\nExpected:\ndeepseekBalance.apiKey";
  }

  if (source === "secretKey") {
    return "No DeepSeek API key found.\n\nExpected secret key:\nSECRET_KEY";
  }

  return "No DeepSeek API key found.\n\nExpected:\nclaudeCode.environmentVariables[name=ANTHROPIC_AUTH_TOKEN]";
}

async function setClaudeConfigApiKey(apiKey: string): Promise<void> {
  const claudeConfig = vscode.workspace.getConfiguration("claudeCode");
  const envs = [
    ...(claudeConfig.get<ClaudeCodeEnvironmentVariables>("environmentVariables") ?? [])
  ];

  const targetName = "ANTHROPIC_AUTH_TOKEN";
  const targetIndex = envs.findIndex((env) => env.name === targetName);

  if (targetIndex >= 0) {
    envs[targetIndex] = { ...envs[targetIndex], value: apiKey };
  } else {
    envs.push({ name: targetName, value: apiKey });
  }

  await claudeConfig.update(
    "environmentVariables",
    envs,
    vscode.ConfigurationTarget.Global
  );
}

async function setApiKeyToSelectedSource(
  source: ApiKeySource,
  apiKey: string
): Promise<void> {
  const deepseekConfig = vscode.workspace.getConfiguration("deepseekBalance");

  if (source === "claudeConfig") {
    await setClaudeConfigApiKey(apiKey);
    return;
  }

  if (source === "config") {
    await deepseekConfig.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
    return;
  }

  await extensionContext.secrets.store("SECRET_KEY", apiKey);
}

async function runApiKeySetupWizard(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "From claudeConfig",
        description: "claudeCode.environmentVariables[name=ANTHROPIC_AUTH_TOKEN]",
        source: "claudeConfig" as ApiKeySource
      },
      {
        label: "From config",
        description: "deepseekBalance.apiKey",
        source: "config" as ApiKeySource
      },
      {
        label: "From SECRET_KEY",
        description: "SecretStorage key: SECRET_KEY",
        source: "secretKey" as ApiKeySource
      }
    ],
    {
      title: "DeepSeek API Key Source",
      placeHolder: "Choose where to read API key"
    }
  );

  if (!picked) {
    return;
  }

  const deepseekConfig = vscode.workspace.getConfiguration("deepseekBalance");
  await deepseekConfig.update(
    "apiKeySource",
    picked.source,
    vscode.ConfigurationTarget.Global
  );

  const apiKeyInput = await vscode.window.showInputBox({
    title: "DeepSeek API Key",
    prompt: "Enter API key for selected source (leave blank to keep)",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "sk-..."
  });

  if (apiKeyInput === undefined) {
    await refreshBalance();
    return;
  }

  const nextApiKey = apiKeyInput.trim();
  if (nextApiKey) {
    await setApiKeyToSelectedSource(picked.source, nextApiKey);
  }

  await refreshBalance();

  const savedHint = nextApiKey ? "API key updated." : "Kept existing API key.";
  void vscode.window.showInformationMessage(
    `DeepSeek source set to ${picked.source}. ${savedHint}`
  );
}

async function refreshBalance() {
  const apiKey = await getDeepSeekApiKey();

  if (!apiKey) {
    statusItem.text = "$(key) No Key";
    statusItem.command = "deepseekBalance.openSettings";
    statusItem.tooltip = getNoKeyTooltip();
    return;
  }

  statusItem.command = "deepseekBalance.refresh";
  statusItem.text = "$(sync~spin)";
  statusItem.tooltip = "Refreshing DeepSeek balance...";

  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as DeepSeekBalanceResponse;

    const balance =
      data.balance_infos.find((item) => item.currency === "USD") ??
      data.balance_infos.find((item) => item.currency === "CNY") ??
      data.balance_infos[0];

    if (!balance) {
      statusItem.text = "$(warning) N/A";
      statusItem.tooltip = "DeepSeek returned no balance info.";
      return;
    }

    const total = Number(balance.total_balance);
    const threshold = vscode.workspace
      .getConfiguration("deepseekBalance")
      .get<number>("lowBalanceThreshold", 1);

    const icon = Number.isFinite(total) && total <= threshold
      ? "$(warning)"
      : "$(credit-card)";

    const currencySymbol = balance.currency === "USD" ? "$" : "¥";
  statusItem.text = `${icon} ${currencySymbol}${balance.total_balance}`;

    statusItem.tooltip =
      `DeepSeek Balance\n\n` +
      `Available: ${data.is_available ? "Yes" : "No"}\n` +
      `Total: ${balance.total_balance} ${balance.currency}\n` +
      `Granted: ${balance.granted_balance} ${balance.currency}\n` +
      `Topped up: ${balance.topped_up_balance} ${balance.currency}\n\n` +
      `Click to refresh.`;
  } catch (error) {
    statusItem.text = "$(error)";
    statusItem.tooltip =
      `Failed to fetch DeepSeek balance.\n\n` +
      `${String(error)}\n\n` +
      `If this is running in vscode.dev/github.dev, it may be blocked by CORS.`;
  }
}

function setupTimer() {
  if (timer) {
    clearInterval(timer);
  }

  const minutes = vscode.workspace
    .getConfiguration("deepseekBalance")
    .get<number>("refreshIntervalMinutes", 10);

  timer = setInterval(() => {
    void refreshBalance();
  }, Math.max(1, minutes) * 60 * 1000);
}

export function deactivate() {
  if (timer) {
    clearInterval(timer);
  }

  statusItem?.dispose();
}