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

## Run Locally in Your Firefox Profile

These steps load the extension inside your everyday Firefox profile without relying on extra tooling. Because Mozilla requires signed add-ons for permanent installation, this approach uses Firefox's temporary add-on loader—perfect for quick spot checks, but it needs to be repeated after each browser restart.

1. Clone or download this repository somewhere on your machine.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick the `manifest.json` file located in the project directory.
4. Firefox immediately installs the extension into your current profile. Pin its icon from the toolbar overflow menu if you want it visible.
5. Keep Firefox running while you work. If you restart the browser, revisit `about:debugging#/runtime/this-firefox` and load the add-on again, or follow the permanent installation steps below.

## Permanent Installation (Signed Add-on)

To keep the extension installed across browser restarts, Firefox requires a signed `.xpi`. Mozilla offers automated signing for self-hosted extensions via AMO's “unlisted” channel. High-level workflow:

1. Create a Firefox Add-on Developer account at [https://addons.mozilla.org](https://addons.mozilla.org) (free).
2. Install the [`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) CLI locally if you don't already have it:
	```bash
	npm install --global web-ext
	```
3. From the project root, request an unlisted signature. The command bundles the extension, uploads it to AMO, and returns a signed `.xpi`:
	```bash
	web-ext sign --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET" --channel unlisted
	```
	Create API credentials on AMO under **Tools > Manage API Keys**, then export them as environment variables before running the command.
4. After the signing completes, download the generated `.xpi` from the output link (or from `./web-ext-artifacts/`).
5. In Firefox, open the downloaded `.xpi`. Approve the installation prompt. The extension now persists like any other add-on, and you can distribute the signed file privately.
6. Whenever you change the code, rerun `web-ext sign` to produce an updated signed package before reinstalling.

## Notes & Limitations

- The extension relies on Discord's current DOM structure (the message composer must expose a `[role="textbox"]` element). If Discord updates their interface, the selector may need adjustment.
- LinkedIn's article editor is targeted via the `#article-editor-headline__textarea` selector. If LinkedIn renames or restructures the title field, update `linkedin-inject.js` accordingly.
- Article scraping is hard-wired to the DOM structure of honzajavorek.cz blog posts. Trying to run the extension elsewhere will show an alert and abort the workflow.
- Admonition blocks on the blog (e.g., role-based alerts) are rewritten to plain blockquotes so LinkedIn renders them consistently, and a separate „Odebírání“ blockquote is inserted beneath the lead paragraph to encourage subscriptions before the existing „Čísla“ notice.
- Figure captions retain their text but drop hyperlinks to match LinkedIn’s caption support.
- The first in-article image must match the page’s `og:image`; otherwise the workflow aborts so the LinkedIn cover can stay in sync with the blog.
- No data is persisted; everything happens in-memory on each click.
- The extension is configured for the specific Discord channel mentioned above. Update `TARGET_DISCORD_URL` in `background.js` to point elsewhere if desired.

Happy syndicating!
