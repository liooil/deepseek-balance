# deepseek-balance

Show your DeepSeek account balance in the VS Code status bar.

## Features

- Displays the current DeepSeek balance in the status bar.
- Lets you configure the API key securely through VS Code secrets storage.
- Provides a guided command to choose API key source and optionally update the key.
- Supports periodic refresh with the `deepseekBalance.refreshIntervalMinutes` setting.

## Guided Setup

- Run command `DeepSeek Balance: Setup API Key (Guided)` from Command Palette.
- Or right-click the DeepSeek status bar item and choose the guided setup command.
- The wizard asks for source first (`claudeConfig` / `config` / `secretKey`), then asks API key input.
- Leave API key input blank to keep existing value for the selected source.

## Extension Settings

This extension contributes the following setting:

- `deepseekBalance.apiKeySource`: API key source selector. Options: `claudeConfig` / `config` / `secretKey`. Default: `claudeConfig`.
- `deepseekBalance.apiKey`: API key used when `deepseekBalance.apiKeySource` is `config`.
- `deepseekBalance.refreshIntervalMinutes`: Refresh interval in minutes. Default: `10`.

## Automated Publishing

This repository includes a GitHub Actions workflow that can publish the extension to the VS Code Marketplace.

### Required GitHub secrets

Create these repository secrets before publishing:

- `VSCE_PAT`: Personal Access Token created in the Visual Studio Marketplace publisher portal.
- `VSCE_PUBLISHER`: Your Marketplace publisher ID.

### Publish flow

The workflow file is `.github/workflows/publish.yml`.

- Push a tag like `v0.0.2` to publish automatically.
- Or run the workflow manually from the GitHub Actions page.
- The workflow builds the extension, packages a `.vsix`, publishes it to the Marketplace, and attaches the package to a GitHub Release when triggered by a tag.

### Versioning rule

When publishing from a git tag, the tag version must match the `version` field in `package.json`.

## Local packaging

You can package or publish locally with:

```bash
bun run package:vsix
bun run publish:vsce
```
