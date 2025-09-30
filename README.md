# POSSE Firefox Extension

POSSE ("Publish on your Own Site, Syndicate Elsewhere") is a minimal Firefox browser extension that helps you share links from your blog to a specific Discord channel with a single click. It opens the Discord channel in a new tab and pre-populates the message composer with the URL of the page you were viewing.

## Features

- One-click capture of the current tab's URL
- Automatically opens the Discord channel at `https://discord.com/channels/769966886598737931/1075091413454303272`
- Finds the message composer and stages the URL for you (does **not** send the message)
- Lightweight, runs locally without any external dependencies

## Project Structure

```
background.js       # Background logic handling the browser action and tab coordination
discord-inject.js   # Content script injected into Discord to fill the message composer
manifest.json       # WebExtension manifest targeting Firefox
README.md           # Project documentation
```

## Installation (Temporary Add-on in Firefox)

1. Open Firefox.
2. Navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Choose the `manifest.json` file from this project directory.

The extension icon (default puzzle-piece) will appear in your toolbar. Pin it if needed so it's always visible.

## Usage

1. Browse to any blog post or page you want to syndicate.
2. Click the POSSE extension icon.
3. A new tab opens with the specified Discord channel.
4. Once the page finishes loading, the message box will be populated with your blog post URL. Review and press Enter (or click Send) when ready.

## Notes & Limitations

- The extension relies on Discord's current DOM structure (the message composer must expose a `[role="textbox"]` element). If Discord updates their interface, the selector may need adjustment.
- No data is persisted; everything happens in-memory on each click.
- The extension is configured for the specific Discord channel mentioned above. Update `TARGET_DISCORD_URL` in `background.js` to point elsewhere if desired.

## Customization Tips

- Update the `browser_action.default_title` in `manifest.json` if you'd like a different tooltip.
- Consider adding icons under an `icons/` directory and referencing them from the manifest for a personalized toolbar button.
- You can adjust polling intervals or attempt counts in `discord-inject.js` if the message composer loads slowly on your system.

Happy syndicating!
