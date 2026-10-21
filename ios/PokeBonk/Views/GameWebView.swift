import SwiftUI
import WebKit

struct GameWebView: UIViewRepresentable {
    private let gameUrl = URL(string: "https://pokebonk.com")!

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true

        // User script for mobile viewport styling and audio/gamepad enhancement
        let scriptSource = """
        (function() {
            // Unlock audio on iOS
            function unlockAudio() {
                if (window.AudioContext || window.webkitAudioContext) {
                    const ctx = window.__pbAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
                    window.__pbAudioCtx = ctx;
                    if (ctx.state === 'suspended') {
                        ctx.resume();
                    }
                }
            }
            window.addEventListener('touchstart', unlockAudio, { passive: true, once: true });
            window.addEventListener('gamepadconnected', unlockAudio, { passive: true, once: true });

            // Ensure proper viewport scale and disable rubber-banding touch moves outside canvas
            const meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
            document.head.appendChild(meta);

            // Stick sensitivity & controller layout persistence
            const STORAGE_KEY = 'pb_swap_abxy';
            const SENSITIVITY_KEY = 'pb_stick_sensitivity';

            window.pokeBonkIOS = {
                toggleLayout: function() {
                    const next = localStorage.getItem(STORAGE_KEY) !== 'true';
                    localStorage.setItem(STORAGE_KEY, String(next));
                    return next;
                },
                setSensitivity: function(val) {
                    const clamped = Math.max(0.2, Math.min(3.0, parseFloat(val) || 1.0));
                    localStorage.setItem(SENSITIVITY_KEY, String(clamped));
                    return clamped;
                },
                getSensitivity: function() {
                    return parseFloat(localStorage.getItem(SENSITIVITY_KEY) || '1.0');
                }
            };
        })();
        """

        let userScript = WKUserScript(
            source: scriptSource,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(userScript)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.backgroundColor = .black
        webView.isOpaque = true
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        // Mobile Safari user-agent to ensure pokebonk serves the responsive mobile view
        let mobileSafariUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        webView.customUserAgent = mobileSafariUA

        let request = URLRequest(url: gameUrl, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30.0)
        webView.load(request)

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: GameWebView

        init(_ parent: GameWebView) {
            self.parent = parent
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            let host = (url.host ?? "").lowercased()
            let internalHosts = ["pokebonk.com", "solais.cloud"]

            if internalHosts.isEmpty || internalHosts.contains(where: { host.contains($0) }) {
                decisionHandler(.allow)
                return
            }

            // Open external links (Discord, GitHub, external auth) in system Safari
            if ["http", "https"].contains(url.scheme?.lowercased()) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // Handle target="_blank" links
            if let url = navigationAction.request.url {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return nil
        }
    }
}
