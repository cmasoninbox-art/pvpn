# Pornhub Local Iframe (Development Only)

This minimal Chrome/Edge Manifest V3 extension attempts to let a page on `http://localhost:3000` embed `https://www.pornhub.com/` in an iframe. It removes the `X-Frame-Options` and `Content-Security-Policy` response headers from Pornhub iframe-document responses.

The extension has no background script, content script, storage access, or access to other sites. Its host permission and static rule are limited to `https://www.pornhub.com/*`, and the rule applies only when the request is an iframe (`sub_frame`).

## Load unpacked in Chrome

1. Extract the ZIP, if you downloaded the packaged version.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `pornhub-local-iframe` folder—the folder containing `manifest.json`.
6. Reload your local development page.

## Load unpacked in Microsoft Edge

1. Extract the ZIP, if needed.
2. Open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `pornhub-local-iframe` folder.
6. Reload your local development page.

## Test iframe

Serve a page from `http://localhost:3000` containing:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local iframe test</title>
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

Open the local page in the same browser profile where the extension is installed. Use the browser developer tools Network and Console panels to inspect failures.

## Limitations

- This is a best-effort development workaround, not a guarantee that the site will render or function in an iframe.
- Redirects to another hostname or regional domain are outside the extension's permission and will remain protected.
- Framing can still fail because of redirects, JavaScript frame-busting, cookies, authentication, bot protection, browser privacy controls, extension conflicts, or other site behavior.
- Removing a response `Content-Security-Policy` also removes protections unrelated to framing for that iframe response.
- The extension affects only the browser profile in which it is installed. It does not make embedding work for other users or in production.
- Browser or website changes may stop this technique from working.
- Some pages or media may be subject to terms, copyright, age restrictions, or local law. This extension does not grant permission to reuse content.

## Security warning

Use this extension only in a dedicated local-development browser profile, and disable or remove it when testing is finished. Removing `X-Frame-Options` and `Content-Security-Policy` weakens security controls chosen by the site and may expose framed content to clickjacking or other risks. Do not distribute this as a production workaround, broaden its site access casually, or use it to bypass access controls.

## Remove it

Return to `chrome://extensions` or `edge://extensions`, then disable or remove **Pornhub Local Iframe (Development Only)**.
