# Pornhub Local Iframe — Firefox (Development Only)

This Firefox Manifest V3 extension attempts to let a page on `http://localhost:3000` embed `https://www.pornhub.com/` in an iframe. It removes the `X-Frame-Options` and `Content-Security-Policy` response headers from iframe-document responses served by that exact hostname.

The extension has no background script, content script, storage access, or access to other sites. Its host permission is limited to `https://www.pornhub.com/*`, and its rule applies only to iframe (`sub_frame`) requests.

## Load temporarily in Firefox

1. Extract `pornhub-local-iframe-firefox.zip`.
2. In Firefox, open `about:debugging`.
3. Select **This Firefox**.
4. Click **Load Temporary Add-on…**.
5. Choose `manifest.json` from the extracted `pornhub-local-iframe-firefox` folder.
6. Accept the requested site permission if Firefox prompts for it.
7. Reload the page on `http://localhost:3000`.

Firefox removes temporary add-ons when the browser restarts. Normal Firefox release builds generally require extensions to be signed for permanent installation; the supplied ZIP is a source/development package, not a signed store add-on.

## Test iframe

Serve a page from `http://localhost:3000` containing:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Firefox iframe test</title>
  </head>
  <body>
    <iframe
      src="https://www.pornhub.com/"
      title="Iframe test"
      width="1200"
      height="800"
      referrerpolicy="no-referrer"
    ></iframe>
  </body>
</html>
```

Open the local page in the same Firefox profile where the temporary add-on is loaded. Firefox's Web Developer Tools Console and Network panels can help identify any remaining failure.

## Limitations

- This is a best-effort local-development workaround; it does not guarantee that the site will render or work inside an iframe.
- Redirects to another hostname or regional domain are outside the extension's permission and remain protected.
- Framing can still fail because of redirects, JavaScript frame-busting, cookies, authentication, tracking protection, bot protection, extension conflicts, or other site behavior.
- Removing a response `Content-Security-Policy` also removes protections unrelated to framing for that iframe response.
- The change affects only the Firefox profile where the add-on is loaded. It does not make production embedding work for visitors.
- Website or Firefox changes may stop this technique from working.
- Content may be subject to terms, copyright, age restrictions, or local law. This extension does not grant permission to reuse it.

## Security warning

Use this only in a dedicated local-development Firefox profile. Remove the temporary add-on when testing is finished. Removing `X-Frame-Options` and `Content-Security-Policy` weakens security controls chosen by the site and may expose framed content to clickjacking or other risks. Do not broaden its site access casually or use it to bypass authentication or access controls.

## Remove it

Open `about:debugging`, select **This Firefox**, find **Pornhub Local Iframe (Firefox, Development Only)**, and click **Remove**. It is also removed automatically when Firefox closes.
