import * as vscode from "vscode";

const SECRET_KEY = "deepseek.apiKey";

let statusItem: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext) {
  statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  statusItem.command = "deepseek-balance.refresh";
  statusItem.text = "$(sync~spin) DeepSeek";
  statusItem.tooltip = "Click to refresh DeepSeek balance";
  statusItem.show();

  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-balance.refresh", async () => {
      await refreshBalance(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-balance.setApiKey", async () => {
      const apiKey = await vscode.window.showInputBox({
        title: "DeepSeek API Key",
        prompt: "Enter your DeepSeek API key",
        password: true,
        ignoreFocusOut: true
      });

      if (!apiKey) return;

      await context.secrets.store(SECRET_KEY, apiKey);
      await refreshBalance(context);
    })
  );

  await refreshBalance(context);
  setupTimer(context);
}

async function refreshBalance(context: vscode.ExtensionContext) {
  const apiKey = await context.secrets.get(SECRET_KEY);

  if (!apiKey) {
    statusItem.text = "$(key) DeepSeek: Set Key";
    statusItem.tooltip = "Click command: DeepSeek Balance: Set API Key";
    statusItem.command = "deepseek-balance.setApiKey";
    return;
  }

  statusItem.command = "deepseek-balance.refresh";
  statusItem.text = "$(sync~spin) DeepSeek";

  try {
    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as {
      is_available: boolean;
      balance_infos: Array<{
        currency: string;
        total_balance: string;
        granted_balance: string;
        topped_up_balance: string;
      }>;
    };

    const primary =
      data.balance_infos.find(x => x.currency === "USD") ??
      data.balance_infos.find(x => x.currency === "CNY") ??
      data.balance_infos[0];

    if (!primary) {
      statusItem.text = "$(warning) DeepSeek: N/A";
      statusItem.tooltip = "No balance info returned";
      return;
    }

    statusItem.text = `$(credit-card) DeepSeek: ${primary.total_balance} ${primary.currency}`;
    statusItem.tooltip =
      `Available: ${data.is_available}\n` +
      `Total: ${primary.total_balance} ${primary.currency}\n` +
      `Granted: ${primary.granted_balance}\n` +
      `Topped up: ${primary.topped_up_balance}\n\n` +
      `Click to refresh`;
  } catch (err) {
    statusItem.text = "$(error) DeepSeek";
    statusItem.tooltip = `Failed to fetch balance: ${String(err)}`;
  }
}

function setupTimer(context: vscode.ExtensionContext) {
  const minutes = vscode.workspace
    .getConfiguration("deepseekBalance")
    .get<number>("refreshIntervalMinutes", 10);

  timer = setInterval(() => refreshBalance(context), minutes * 60 * 1000);
}

export function deactivate() {
  if (timer) clearInterval(timer);
}

function getDeepSeekTokenFromClaudeCodeSettings(): string | undefined {
  const config = vscode.workspace.getConfiguration("claudeCode");

  const env = config.get<Record<string, string>>("environmentVariables");

  if (!env) {
    return undefined;
  }

  const baseUrl = env["ANTHROPIC_BASE_URL"];
  const token = env["ANTHROPIC_AUTH_TOKEN"];

  const isDeepSeek =
    baseUrl?.includes("api.deepseek.com") ||
    token?.startsWith("sk-");

  if (!isDeepSeek || !token) {
    return undefined;
  }

  return token;
}