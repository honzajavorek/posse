# POSSE Firefox Extension

POSSE ("Publish on your Own Site, Syndicate Elsewhere") is a minimal Firefox browser extension that helps me share my publications to places behind specific walled gardens.

## Features

- One-click capture of the current honzajavorek.cz blog post URL and title
- Automatically opens the Discord channel at `https://discord.com/channels/769966886598737931/1075091413454303272`
- Finds the Discord message composer and stages the URL for you (does **not** send the message)
- Opens LinkedIn's article editor at `https://www.linkedin.com/article/new/`, pre-fills the title input, and inserts the article body HTML (including images)
- Converts blog admonitions (`role="alert"` or `role="status"`) into LinkedIn-friendly blockquotes during paste
- Flattens figure captions by stripping links so photographer credits remain visible in LinkedIn
- Detects the blog’s cover image (matching `og:image`), uploads it to LinkedIn’s cover slot, and removes it from the pasted body
- Lightweight, runs locally without any external dependencies

## Project Structure

```
background.js       # Background logic handling the browser action and tab coordination
discord-inject.js   # Content script injected into Discord to fill the message composer
linkedin-inject.js  # Content script injected into LinkedIn to populate the article title and body
scrape-article.js   # One-off script executed on honzajavorek.cz/blog pages to capture title/body markup
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

1. Browse to any `https://honzajavorek.cz/blog/…` article you want to syndicate.
2. Click the POSSE extension icon.
3. A new tab opens with the specified Discord channel. Once the page finishes loading, the message box is populated with your blog post URL—review and press Enter (or click Send) when ready.
4. A LinkedIn article editor tab opens (in the background) with the headline field pre-filled and the body populated using the blog post content. Switch to it when you're ready to continue drafting or editing.

## Local Development with `web-ext`

If you iterate on the code frequently, Mozilla's [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) CLI can auto-reload the extension as you save changes.

### 1. Install `web-ext`

```bash
npm install --global web-ext
```

### 2. Run the extension with live reloading

From the project root:

```bash
web-ext run --target=firefox-desktop --firefox="$(ls -1 /Applications/Firefox.app/Contents/MacOS/firefox)"
```

`web-ext` launches a dedicated Firefox profile, installs the extension, and watches this directory. Each time you edit a file, it automatically reloads the extension—no need to revisit `about:debugging`.

### 3. Stop the session

Press `Ctrl+C` in the terminal to shut down the `web-ext` runner. Firefox closes along with it, leaving your main profile untouched.

## Notes & Limitations

- The extension relies on Discord's current DOM structure (the message composer must expose a `[role="textbox"]` element). If Discord updates their interface, the selector may need adjustment.
- LinkedIn's article editor is targeted via the `#article-editor-headline__textarea` selector. If LinkedIn renames or restructures the title field, update `linkedin-inject.js` accordingly.
- Article scraping is hard-wired to the DOM structure of honzajavorek.cz blog posts. Trying to run the extension elsewhere will show an alert and abort the workflow.
- Admonition blocks on the blog (e.g., role-based alerts) are rewritten to plain blockquotes so LinkedIn renders them consistently, and a separate „Odebírání“ blockquote is inserted beneath the lead paragraph to encourage subscriptions before the existing „Čísla“ notice.
- Figure captions retain their text but drop hyperlinks to match LinkedIn’s caption support.
- The first in-article image must match the page’s `og:image`; otherwise the workflow aborts so the LinkedIn cover can stay in sync with the blog.
- No data is persisted; everything happens in-memory on each click.
- The extension is configured for the specific Discord channel mentioned above. Update `TARGET_DISCORD_URL` in `background.js` to point elsewhere if desired.

## Customization Tips

- Update the `browser_action.default_title` in `manifest.json` if you'd like a different tooltip.
- Consider adding icons under an `icons/` directory and referencing them from the manifest for a personalized toolbar button.
- Tweak `TARGET_DISCORD_URL` or `TARGET_LINKEDIN_URL` in `background.js` to point the extension at different destinations.
- Rewrite the DOM hooks in `scrape-article.js` if you want to adapt the extension to a different site structure.
- You can adjust polling intervals or attempt counts in `discord-inject.js` if the message composer loads slowly on your system.

Happy syndicating!
