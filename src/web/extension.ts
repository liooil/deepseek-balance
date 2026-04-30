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
    vscode.StatusBarAlignment.Right,
    100
  );

  statusItem.command = "deepseekBalance.refresh";
  statusItem.text = "$(credit-card) DeepSeek";
  statusItem.tooltip = "DeepSeek balance";
  statusItem.show();

  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseekBalance.refresh", async () => {
      await refreshBalance();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseekBalance.openSettings", async () => {
      const source = getApiKeySource();
      const query = source === "claudeConfig"
        ? "claudeCode.environmentVariables"
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

  return "No DeepSeek API key found.\n\nExpected:\nclaudeCode.environmentVariables.ANTHROPIC_AUTH_TOKEN";
}

async function refreshBalance() {
  const apiKey = await getDeepSeekApiKey();

  if (!apiKey) {
    statusItem.text = "$(key) DeepSeek: No Key";
    statusItem.command = "deepseekBalance.openSettings";
    statusItem.tooltip = getNoKeyTooltip();
    return;
  }

  statusItem.command = "deepseekBalance.refresh";
  statusItem.text = "$(sync~spin) DeepSeek";
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
      statusItem.text = "$(warning) DeepSeek: N/A";
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

    statusItem.text = `${icon} DeepSeek: ${balance.total_balance} ${balance.currency}`;

    statusItem.tooltip =
      `DeepSeek Balance\n\n` +
      `Available: ${data.is_available ? "Yes" : "No"}\n` +
      `Total: ${balance.total_balance} ${balance.currency}\n` +
      `Granted: ${balance.granted_balance} ${balance.currency}\n` +
      `Topped up: ${balance.topped_up_balance} ${balance.currency}\n\n` +
      `Click to refresh.`;
  } catch (error) {
    statusItem.text = "$(error) DeepSeek";
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